"""Single-owner local acquisition, explicit baseline, and shared session telemetry."""
import asyncio
from collections import deque
from contextlib import asynccontextmanager
import math
import os
from pathlib import Path
import time
import uuid
import numpy as np
from brainflow.board_shim import BoardShim, BoardIds, BrainFlowInputParams
import shutil
import tempfile
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from pydantic import BaseModel, Field
from typing import Literal, Optional
from serial.tools import list_ports
from backend.signal import Calibration, analyze, DEFAULT_MAX_PTP_UV
from backend.recordings import resolve_recording, inspect_recording, TIMESTAMP
from backend.simulated import SimulatedBoard
from backend.experiments import ExperimentManager, Conflict, Forbidden
from backend import ssvep as ssvep_decoder
from backend.continuity import CounterTracker, timestamp_problem

RECORDINGS = Path(os.environ.get('BCI_RECORDINGS_DIR', str(Path.home() / 'Documents/OpenBCI_GUI/Recordings'))).resolve()
CYTON = BoardIds.CYTON_BOARD.value
RATE = BoardShim.get_sampling_rate(CYTON)
CHANNELS = BoardShim.get_eeg_channels(CYTON)
# Operator-adjustable peak-to-peak acceptance ceiling (µV) for each channel's 2-second window.
GATE_RANGE_UV = (100.0, 5000.0)

class Service:
    def __init__(self):
        self.board = None
        self.source = 'live'
        self.enabled = False
        self.started_at = 0
        self.error = None
        self.sequence = 0
        self.lock = asyncio.Lock()
        self.session_id = None
        self.experiments = ExperimentManager(RATE, len(CHANNELS))
        # An operator setting: kept across sessions and disconnects.
        self.gate_uv = DEFAULT_MAX_PTP_UV
        self.reset_data()

    def reset_data(self):
        self.total = 0
        self.last_packet = 0
        self.buffer = np.empty((len(CHANNELS), 0))
        self.timestamps = np.empty(0)
        self.cal = Calibration()
        self.calibrating = False
        self.cal_error = None
        self.baseline_start_sample = None
        self.baseline_end_sample = None
        self.baseline_gate_uv = None
        self.pending = np.empty((len(CHANNELS),0))
        self.pending_ts = np.empty(0)
        self.rejected = 0
        self.last_rejection = None
        self.value = None
        self.quality = 'poor'
        self.channel_details = []
        self.history = deque(maxlen=240)
        self.arrivals = deque()
        self.recording = None
        self.file_data = None
        self.verified_samples = 0
        self.mismatched_samples = 0
        self.timestamp_gaps = 0
        self.last_source_timestamp = None
        self.counter = CounterTracker()
        self.last_counter = None

    def stop(self, reason='Input stopped or disconnected'):
        # Any experiment bound to this acquisition ends; its partial recording is kept.
        self.experiments.interrupt(reason)
        try:
            if self.board: self.board.release_session()
        except Exception as exc:
            self.error = f'Board cleanup failed: {exc}'
        finally:
            self.board = None
            self.enabled = False
            self.quality = 'poor'
            self.cal = Calibration()
            self.calibrating = False
            self.value = None
            self.buffer = np.empty((len(CHANNELS), 0))
            self.timestamps = np.empty(0)
            self.pending = np.empty((len(CHANNELS),0))
            self.pending_ts = np.empty(0)

    def connect(self, request):
        self.stop('Input source changed or reconnected')
        self.source = request.source
        self.error = None
        self.session_id = str(uuid.uuid4())
        self.reset_data()
        if request.source == 'synthetic':
            self.quality = 'good'
            self.enabled = True
            self.started_at = time.monotonic()
            return
        params = BrainFlowInputParams()
        board_id = None
        if request.source == 'simulated_eeg':
            pass
        elif request.source == 'replay':
            path = resolve_recording(RECORDINGS, request.recording)
            self.file_data, self.recording = inspect_recording(path)
            params.file = str(path)
            params.master_board = CYTON
            board_id = BoardIds.PLAYBACK_FILE_BOARD.value
        elif request.source == 'live':
            if request.serial_port not in [p.device for p in list_ports.comports()]:
                raise ValueError('Serial port is unavailable. Plug in the USB dongle and refresh ports.')
            params.serial_port = request.serial_port
            params.timeout = 5
            board_id = CYTON
        if request.source == 'simulated_eeg':
            board = SimulatedBoard()
            board.start_stream()
            self.board = board
            self.enabled = True
            self.started_at = time.monotonic()
            return
        board = BoardShim(board_id, params)
        try:
            board.prepare_session()
            board.start_stream()
            self.board = board
            self.enabled = True
            self.started_at = time.monotonic()
        except Exception:
            if board.is_prepared(): board.release_session()
            raise

    def begin_calibration(self):
        if not self.receiving():
            raise ValueError('Cannot calibrate without incoming EEG samples.')
        # A new comparison reference changes the session's meaning for any running experiment.
        self.experiments.interrupt('Baseline recalibration started')
        self.cal = Calibration()
        self.calibrating = True
        self.cal_error = None
        self.rejected = 0
        self.last_rejection = None
        self.pending = np.empty((len(CHANNELS),0))
        self.pending_ts = np.empty(0)
        self.baseline_start_sample = self.total
        self.baseline_end_sample = None
        self.baseline_gate_uv = self.gate_uv

    def set_gate(self, max_ptp_uv):
        """Move the peak-to-peak acceptance gate for live features and future baselines."""
        if self.calibrating:
            raise ValueError('Cannot change the acceptance gate while a baseline is being collected.')
        low, high = GATE_RANGE_UV
        if not (math.isfinite(max_ptp_uv) and low <= max_ptp_uv <= high):
            raise ValueError(f'Acceptance gate must be between {low:g} and {high:g} µV.')
        self.gate_uv = float(max_ptp_uv)
        # Re-judge the current window now so channels reflect the gate before more samples arrive.
        if self.buffer.shape[1]: self.update_feature()

    def continuity_problem(self, end, ts):
        """Why the samples ending at absolute index end (timestamps ts) are not continuous, or None."""
        if self.source == 'live':
            problem = self.counter.problem(end-len(ts), end)
            if problem: return problem
        return timestamp_problem(ts, RATE)

    def update_feature(self):
        self.value, self.channel_details = analyze(self.buffer,RATE,self.gate_uv)
        if len(self.timestamps) >= RATE*2 and self.continuity_problem(self.total, self.timestamps[-RATE*2:]):
            self.value = None
        self.quality = 'good' if self.value is not None else 'poor'

    def ingest(self, data):
        """Consume every sample once. Kept independent of the SDK for regression tests."""
        if not data.shape[1]: return
        now = time.monotonic()
        outage = bool(self.last_packet and now-self.last_packet > 2)
        if outage:
            # Never join opposite sides of an outage into an apparently continuous window.
            self.buffer = np.empty((len(CHANNELS),0))
            self.timestamps = np.empty(0)
            self.pending = np.empty((len(CHANNELS),0))
            self.pending_ts = np.empty(0)
        if data.shape[0] != 24 or not np.isfinite(data[TIMESTAMP]).all():
            raise ValueError('Invalid Cyton sample shape or timestamp.')
        count = data.shape[1]
        start = self.total
        eeg = data[CHANNELS]
        ts = data[TIMESTAMP]
        if self.source == 'replay' and self.file_data is not None:
            expected = self.file_data[start:start+count]
            if len(expected) != count:
                raise ValueError('Replay delivered more samples than the source file.')
            matches = np.isclose(eeg.T, expected[:, CHANNELS], atol=1e-5, rtol=0).all(axis=1)
            self.verified_samples += int(matches.sum())
            self.mismatched_samples += int((~matches).sum())
            if not matches.all():
                raise ValueError('Replay EEG differs from the source file; playback halted.')
            # Original timestamps are used for source position and gap detection,
            # independently of BrainFlow's generated playback timestamps.
            ts = expected[:, TIMESTAMP]
        previous_ts = np.r_[self.last_source_timestamp, ts] if self.last_source_timestamp is not None else ts
        self.timestamp_gaps += int((np.diff(previous_ts) > .1).sum())
        # Absolute indices of samples that are discontinuous from their predecessor.
        ts_offset = 0 if self.last_source_timestamp is not None else 1
        steps = np.diff(previous_ts)
        batch_breaks = [int(start + j + ts_offset) for j in np.flatnonzero((steps > .1) | (steps < 0))]
        if outage: batch_breaks.append(start)
        self.last_source_timestamp = float(ts[-1])
        if self.source == 'live':
            # Tracked by absolute sample position, so breaks across SDK reads are
            # also excluded from spectral windows. Normal 255 -> 0 wrap is continuous.
            self.counter.feed(start, data[0])
            # Experiments retain strict raw-counter discontinuities independently
            # of the game's noise-tolerant counter tracker.
            counters = data[0].astype(int)
            seq = np.r_[self.last_counter, counters] if self.last_counter is not None else counters
            offset = 0 if self.last_counter is not None else 1
            batch_breaks.extend(int(start + j + offset) for j in np.flatnonzero(np.diff(seq) % 256 != 1))
            self.last_counter = int(counters[-1])
        # Full-rate fan-out remains independent of the game acceptance gate.
        self.experiments.on_samples(start, eeg, ts, data[0], sorted(set(batch_breaks)), time.time())
        self.total += count
        self.last_packet = now
        self.arrivals.append((now, count))
        while self.arrivals and self.arrivals[0][0] < now-5: self.arrivals.popleft()
        self.buffer = np.concatenate((self.buffer,eeg),axis=1)[:, -RATE*10:]
        self.timestamps = np.r_[self.timestamps,ts][-RATE*10:]
        self.update_feature()
        self.history.append(dict(sample=self.total, value=self.value))
        if self.calibrating:
            self.pending = np.concatenate((self.pending,eeg),axis=1)
            self.pending_ts = np.r_[self.pending_ts,ts]
            while self.pending.shape[1] >= RATE*2 and self.calibrating:
                window = self.pending[:,:RATE*2]
                window_ts = self.pending_ts[:RATE*2]
                self.pending = self.pending[:,RATE*2:]
                self.pending_ts = self.pending_ts[RATE*2:]
                value, details = analyze(window,RATE,self.gate_uv)
                problem = self.continuity_problem(self.total-self.pending.shape[1], window_ts)
                if problem:
                    value = None
                    reason = f'{problem} in baseline window'
                else:
                    reason = '; '.join(f"CH{c['channel']}: {c['reason']}" for c in details if not c['included'])
                if value is None:
                    self.rejected += 1
                    self.last_rejection = reason
                else:
                    try: self.cal.collect(value)
                    except ValueError as exc:
                        self.cal_error = str(exc)
                        self.calibrating = False
                    if self.cal.center is not None:
                        self.calibrating = False
                        self.baseline_end_sample = self.total-self.pending.shape[1]
            if not self.calibrating:
                self.pending = np.empty((len(CHANNELS),0))
                self.pending_ts = np.empty(0)
        # Keep only counter events that could affect a future rolling/pending window.
        self.counter.prune(min(self.total-RATE*2, self.total-self.pending.shape[1]))
        if self.value is not None and self.cal.center is not None:
            self.cal.map(self.value)

    def tick(self):
        self.sequence += 1
        if not self.enabled:
            self.quality = 'poor'
            return
        if self.source == 'synthetic':
            self.quality = 'good'
            self.history.append(dict(sample=round((time.monotonic()-self.started_at)*RATE), value=self.synthetic_score()))
            return
        if not self.board:
            self.quality = 'poor'
            self.experiments.check(False)
            return
        self.ingest(self.board.get_board_data())
        self.experiments.check(self.receiving(), self.at_end())
        if not self.receiving(): self.quality = 'poor'
        if self.source == 'live' and not self.last_packet and time.monotonic()-self.started_at >= 5:
            self.error = 'No live Cyton samples received within 5 seconds. Check board power, USB dongle, radio link, and close the OpenBCI GUI session.'
            self.stop()

    def at_end(self):
        return self.recording is not None and self.total >= self.recording['samples']

    def receiving(self):
        return bool(self.enabled and self.board is not None and self.last_packet
                    and time.monotonic()-self.last_packet <= 2 and not self.at_end())

    def state(self):
        if self.error: return 'error'
        if not self.enabled: return 'disconnected'
        if self.source == 'synthetic': return 'simulation'
        if self.at_end(): return 'recording_complete'
        if not self.last_packet: return 'waiting_for_samples'
        return 'receiving' if self.receiving() else 'stalled'

    def effective_quality(self):
        return self.quality if (self.receiving() or (self.enabled and self.source=='synthetic')) else 'poor'

    def synthetic_score(self):
        return .5 + .4*math.sin(time.monotonic()*.4)

    def status(self):
        now = time.monotonic()
        delivered = sum(n for t,n in self.arrivals if t >= now-5)
        span = min(5, now-self.started_at)
        rec = {k:v for k,v in self.recording.items() if k != 'overview'} if self.recording else None
        position_ts = None
        if self.file_data is not None and self.total:
            position_ts = float(self.file_data[min(self.total,len(self.file_data))-1,TIMESTAMP]-self.file_data[0,TIMESTAMP])
        samples = self.buffer[:,::5]
        # Bound chart payload; timestamps/indices are retained for graph alignment.
        waves = [[None if not np.isfinite(v) else float(v) for v in row] for row in samples]
        return dict(session_id=self.session_id, source=self.source, connected=self.receiving(),
                    session_open=self.board is not None, receiving_samples=self.receiving(),
                    live_verified=self.source=='live' and self.receiving(), state=self.state(),
                    sample_rate_hz=RATE, measured_rate_hz=round(delivered/span,1) if span>=1 else None,
                    samples_received=self.total, packet_age_ms=round((now-self.last_packet)*1000) if self.last_packet else None,
                    calibration_seconds=len(self.cal.values)*2, calibrated=self.enabled and (self.cal.center is not None or self.source=='synthetic'),
                    calibrating=self.calibrating, calibration_error=self.cal_error, accepted_windows=len(self.cal.values),
                    rejected_windows=self.rejected, last_rejection=self.last_rejection,
                    baseline_center=self.cal.center, baseline_scale=self.cal.scale,
                    baseline_start_sample=self.baseline_start_sample, baseline_end_sample=self.baseline_end_sample,
                    gate_max_ptp_uv=self.gate_uv, baseline_gate_uv=self.baseline_gate_uv,
                    relative_alpha=self.value, quality=self.effective_quality(), error=self.error,
                    channels=self.channel_details, channel_std_uv=[c['std_uv'] for c in self.channel_details],
                    waveform=waves, waveform_start_sample=max(0,self.total-self.buffer.shape[1]), waveform_stride=5,
                    feature_history=list(self.history), recording=rec, recorded_position_seconds=position_ts,
                    verified_samples=self.verified_samples, mismatched_samples=self.mismatched_samples,
                    timestamp_gaps=self.timestamp_gaps, counter_lost=self.counter.lost,
                    counter_corrupt=self.counter.corrupt, counter_breaks=self.counter.breaks,
                    experiment=self.experiments.telemetry(),
                    simulation=dict(gaze_hz=self.board.gaze_hz, gaze_side=self.board.gaze_side)
                    if isinstance(self.board, SimulatedBoard) else None)

    def frame(self):
        return dict(version=1, sequence=self.sequence, session_id=self.session_id,
                    timestamp_ms=int(time.time()*1000), source=self.source,
                    score=self.synthetic_score() if self.source=='synthetic' else self.cal.score,
                    quality=self.effective_quality(), calibrated=self.enabled and (self.source=='synthetic' or self.cal.center is not None))

service = Service()
async def worker():
    while True:
        async with service.lock:
            try: await asyncio.to_thread(service.tick)
            except Exception as exc:
                service.error = str(exc)
                await asyncio.to_thread(service.stop)
        await asyncio.sleep(.25)

@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(worker())
    yield
    task.cancel()
    try: await task
    except asyncio.CancelledError: pass
    service.stop()

app = FastAPI(title='Brain Balance input service', lifespan=lifespan)
app.add_middleware(CORSMiddleware,allow_origins=['http://127.0.0.1:5173','http://localhost:5173'],allow_methods=['GET','POST'],allow_headers=['Content-Type'])
class ConnectRequest(BaseModel):
    source: Literal['synthetic','replay','live','simulated_eeg']
    recording: str = ''
    serial_port: str = ''
class GateRequest(BaseModel):
    max_ptp_uv: float = Field(ge=GATE_RANGE_UV[0], le=GATE_RANGE_UV[1])

@app.get('/health')
def health(): return {'status':'ok','source':service.source,'protocol_version':1}
@app.get('/api/status')
async def status():
    async with service.lock: return service.status()
@app.get('/api/options')
def options():
    return dict(recordings=[str(p.relative_to(RECORDINGS)) for p in sorted(RECORDINGS.glob('**/BrainFlow-RAW*.csv'))],ports=[dict(device=p.device,description=p.description) for p in list_ports.comports()])
@app.get('/api/recording')
def recording(name: str):
    try: return inspect_recording(resolve_recording(RECORDINGS,name))[1]
    except (ValueError,OSError) as exc: raise HTTPException(400,str(exc))
@app.post('/api/connect')
async def connect(request: ConnectRequest):
    async with service.lock:
        try: await asyncio.to_thread(service.connect,request)
        except Exception as exc:
            service.error=str(exc)
            raise HTTPException(400,service.error)
        return service.status()
@app.post('/api/disconnect')
async def disconnect():
    async with service.lock:
        await asyncio.to_thread(service.stop)
        return service.status()
@app.post('/api/calibrate')
async def calibrate():
    async with service.lock:
        try: service.begin_calibration()
        except ValueError as exc: raise HTTPException(409,str(exc))
        return service.status()
@app.post('/api/gate')
async def gate(request: GateRequest):
    async with service.lock:
        try: service.set_gate(request.max_ptp_uv)
        except ValueError as exc: raise HTTPException(409,str(exc))
        return service.status()
@app.websocket('/ws/input')
async def stream(socket: WebSocket):
    await socket.accept()
    try:
        while True:
            async with service.lock:
                frame=service.frame()
                frame['telemetry']=service.status()
            await socket.send_json(frame)
            await asyncio.sleep(.25)
    except (WebSocketDisconnect,RuntimeError): return


# ---------------------------------------------------------------- experiments
Electrode = Field(default='', max_length=12, pattern=r'^[A-Za-z0-9_-]*$')

class ClockSync(BaseModel):
    offset_ms: float = Field(ge=-1e7, le=1e7)
    rtt_ms: float = Field(ge=0, le=1000)
    samples: int = Field(default=0, ge=0, le=100)

class BilateralSettings(BaseModel):
    interval_ms: int = Field(ge=500, le=2000)
    fixation_pre_s: int = Field(ge=10, le=60)
    alternating_s: int = Field(ge=10, le=60)
    fixation_post_s: int = Field(ge=10, le=60)
    instruction: Literal['follow', 'fixate']
    condition_order: str = Field(default='', max_length=80)

class DisplayTiming(BaseModel):
    passed: bool
    profile_hz: Literal[60, 120]
    measured_hz: float = Field(gt=0, le=500)
    median_interval_ms: float = Field(gt=0, le=100)
    long_interval_fraction: float = Field(ge=0, le=1)
    max_interval_ms: float = Field(ge=0, le=10000)
    preflight_seconds: float = Field(ge=5, le=60)
    frames: int = Field(ge=1, le=100000)
    criteria: dict

class SsvepSettings(BaseModel):
    frequencies_hz: list[float] = Field(min_length=3, max_length=3)
    frames_per_cycle: list[int] = Field(min_length=3, max_length=3)
    channels: list[int] = Field(min_length=2, max_length=8)
    stimulation_s: float = Field(ge=3, le=6)
    cue_s: float = Field(ge=0.5, le=3)
    rest_s: float = Field(ge=1, le=5)
    luminance_mean: float = Field(ge=0.2, le=0.8)
    luminance_amplitude: float = Field(ge=0.05, le=0.45)
    seed: int = Field(ge=0, le=2**31)
    display: DisplayTiming

class StartRequest(BaseModel):
    kind: Literal['bilateral', 'ssvep']
    participant: str = Field(default='', max_length=32, pattern=r'^[A-Za-z0-9_-]*$')
    electrodes: list[str] = Field(min_length=8, max_length=8)
    reference: str = Field(default='', max_length=24)
    clock: ClockSync
    bilateral: Optional[BilateralSettings] = None
    ssvep: Optional[SsvepSettings] = None

class TokenRequest(BaseModel):
    token: str = Field(max_length=64)

class EventsRequest(TokenRequest):
    events: list[dict] = Field(max_length=200)

class FramesRequest(TokenRequest):
    trial_id: str = Field(max_length=64)
    profile_hz: int
    frames: list[list[float]] = Field(max_length=4000)

class StopRequest(TokenRequest):
    reason: str = Field(default='Stopped by operator', max_length=200)
    completed: bool = False

class SimulationRequest(BaseModel):
    gaze_hz: Optional[float] = Field(default=None, ge=1, le=60)
    gaze_side: Optional[Literal['left', 'right']] = None


def validate_start(req: StartRequest):
    for e in req.electrodes:
        if len(e) > 12 or not all(ch.isalnum() or ch in '_-' for ch in e):
            raise ValueError('Electrode names must be short letters/numbers (e.g. O1, Oz, PO7).')
    if req.kind == 'bilateral':
        if not req.bilateral: raise ValueError('Bilateral settings missing')
        return
    s = req.ssvep
    if not s: raise ValueError('SSVEP settings missing')
    if not s.display.passed:
        raise ValueError('Display timing check has not passed; SSVEP cannot start.')
    if len(set(s.channels)) != len(s.channels) or any(not 0 <= c < len(CHANNELS) for c in s.channels):
        raise ValueError('Unknown or duplicate channel')
    if any(not ssvep_decoder.is_posterior(req.electrodes[c]) for c in s.channels):
        raise ValueError('Decoder channels must be mapped to posterior O/PO electrodes')
    for f, n in zip(s.frequencies_hz, s.frames_per_cycle):
        if n < 2 or abs(s.display.profile_hz / n - f) > 1e-6:
            raise ValueError(f'{f} Hz is not {s.display.profile_hz}/{n} frames; use frequencies with whole frames per cycle')
    if len(set(s.frequencies_hz)) != 3: raise ValueError('Frequencies must differ')
    if s.luminance_mean - s.luminance_amplitude < 0 or s.luminance_mean + s.luminance_amplitude > 1:
        raise ValueError('Luminance must stay within 0–1')


def experiment_error(exc):
    if isinstance(exc, Conflict): return HTTPException(409, str(exc))
    if isinstance(exc, Forbidden): return HTTPException(403, str(exc))
    if isinstance(exc, KeyError): return HTTPException(404, str(exc).strip("'"))
    if isinstance(exc, ValueError): return HTTPException(400, str(exc))
    if isinstance(exc, OSError): return HTTPException(500, f'Cannot write recording: {exc}')
    return HTTPException(500, str(exc))

@app.get('/api/experiments/clock')
def experiment_clock():
    return dict(server_wall_ms=time.time()*1000, server_mono_ms=time.monotonic()*1000)

@app.post('/api/experiments/start')
async def experiment_start(req: StartRequest):
    async with service.lock:
        try:
            validate_start(req)
            exp = service.experiments.start(req.kind, req.model_dump(), service.session_id, service.source, service.receiving())
        except Exception as exc: raise experiment_error(exc)
        return dict(id=exp.id, token=exp.token, experiment=service.experiments.describe(exp))

@app.post('/api/experiments/{experiment_id}/heartbeat')
def experiment_heartbeat(experiment_id: str, req: TokenRequest):
    try: return service.experiments.heartbeat(experiment_id, req.token)
    except Exception as exc: raise experiment_error(exc)

@app.post('/api/experiments/{experiment_id}/events')
def experiment_events(experiment_id: str, req: EventsRequest):
    try: return service.experiments.events(experiment_id, req.token, req.events)
    except Exception as exc: raise experiment_error(exc)

@app.post('/api/experiments/{experiment_id}/frames')
def experiment_frames(experiment_id: str, req: FramesRequest):
    try: return service.experiments.frames(experiment_id, req.token, req.model_dump(exclude={'token'}))
    except Exception as exc: raise experiment_error(exc)

@app.post('/api/experiments/{experiment_id}/thresholds')
async def experiment_thresholds(experiment_id: str, req: TokenRequest):
    try: return await asyncio.to_thread(service.experiments.select_thresholds, experiment_id, req.token)
    except Exception as exc: raise experiment_error(exc)

@app.post('/api/experiments/{experiment_id}/stop')
def experiment_stop(experiment_id: str, req: StopRequest):
    try: return service.experiments.stop(experiment_id, req.token, req.reason, req.completed)
    except Exception as exc: raise experiment_error(exc)

@app.get('/api/experiments')
def experiment_list():
    return dict(root=str(service.experiments.root), experiments=service.experiments.recent())

@app.get('/api/experiments/{experiment_id}/export')
def experiment_export(experiment_id: str):
    try: folder = service.experiments.folder(experiment_id)
    except Exception as exc: raise experiment_error(exc)
    tmp = Path(tempfile.mkdtemp(prefix='bci-export-'))
    archive = shutil.make_archive(str(tmp / f'experiment-{experiment_id}'), 'zip', root_dir=folder)
    return FileResponse(archive, media_type='application/zip', filename=Path(archive).name,
                        background=BackgroundTask(shutil.rmtree, tmp, ignore_errors=True))

@app.post('/api/simulation')
async def simulation(req: SimulationRequest):
    async with service.lock:
        if not isinstance(service.board, SimulatedBoard):
            raise HTTPException(409, 'Simulated stimulus responses are only available with Simulated EEG.')
        service.board.set_stimulus(req.gaze_hz, req.gaze_side)
        return dict(gaze_hz=req.gaze_hz, gaze_side=req.gaze_side)
