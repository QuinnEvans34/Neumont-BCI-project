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
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Literal
from serial.tools import list_ports
from backend.signal import Calibration, analyze
from backend.recordings import resolve_recording, inspect_recording, TIMESTAMP

RECORDINGS = Path(os.environ.get('BCI_RECORDINGS_DIR', str(Path.home() / 'Documents/OpenBCI_GUI/Recordings'))).resolve()
CYTON = BoardIds.CYTON_BOARD.value
RATE = BoardShim.get_sampling_rate(CYTON)
CHANNELS = BoardShim.get_eeg_channels(CYTON)

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
        self.last_counter = None
        self.counter_gaps = 0
        self.counter_duplicates = 0

    def stop(self):
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
        self.stop()
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
        if request.source == 'replay':
            path = resolve_recording(RECORDINGS, request.recording)
            self.file_data, self.recording = inspect_recording(path)
            params.file = str(path)
            params.master_board = CYTON
            board_id = BoardIds.PLAYBACK_FILE_BOARD.value
        else:
            if request.serial_port not in [p.device for p in list_ports.comports()]:
                raise ValueError('Serial port is unavailable. Plug in the USB dongle and refresh ports.')
            params.serial_port = request.serial_port
            params.timeout = 5
            board_id = CYTON
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
        self.cal = Calibration()
        self.calibrating = True
        self.cal_error = None
        self.rejected = 0
        self.last_rejection = None
        self.pending = np.empty((len(CHANNELS),0))
        self.pending_ts = np.empty(0)
        self.baseline_start_sample = self.total
        self.baseline_end_sample = None

    def ingest(self, data):
        """Consume every sample once. Kept independent of the SDK for regression tests."""
        if not data.shape[1]: return
        now = time.monotonic()
        if self.last_packet and now-self.last_packet > 2:
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
        self.last_source_timestamp = float(ts[-1])
        if self.source == 'live':
            counters = data[0].astype(int)
            seq = np.r_[self.last_counter, counters] if self.last_counter is not None else counters
            delta = np.diff(seq) % 256
            self.counter_duplicates += int((delta == 0).sum())
            self.counter_gaps += int(np.maximum(delta-1,0).sum())
            self.last_counter = int(counters[-1])
        self.total += count
        self.last_packet = now
        self.arrivals.append((now, count))
        while self.arrivals and self.arrivals[0][0] < now-5: self.arrivals.popleft()
        self.buffer = np.concatenate((self.buffer,eeg),axis=1)[:, -RATE*10:]
        self.timestamps = np.r_[self.timestamps,ts][-RATE*10:]
        self.value, self.channel_details = analyze(self.buffer,RATE)
        if len(self.timestamps) >= RATE*2 and np.any((np.diff(self.timestamps[-RATE*2:]) > .1) | (np.diff(self.timestamps[-RATE*2:]) < 0)):
            self.value = None
        self.quality = 'good' if self.value is not None else 'poor'
        self.history.append(dict(sample=self.total, value=self.value))
        if self.calibrating:
            self.pending = np.concatenate((self.pending,eeg),axis=1)
            self.pending_ts = np.r_[self.pending_ts,ts]
            while self.pending.shape[1] >= RATE*2 and self.calibrating:
                window = self.pending[:,:RATE*2]
                window_ts = self.pending_ts[:RATE*2]
                self.pending = self.pending[:,RATE*2:]
                self.pending_ts = self.pending_ts[RATE*2:]
                value, details = analyze(window,RATE)
                if np.any((np.diff(window_ts) > .1) | (np.diff(window_ts) < 0)):
                    value = None
                    reason = 'Timestamp gap or discontinuity in baseline window'
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
            return
        self.ingest(self.board.get_board_data())
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
                    relative_alpha=self.value, quality=self.effective_quality(), error=self.error,
                    channels=self.channel_details, channel_std_uv=[c['std_uv'] for c in self.channel_details],
                    waveform=waves, waveform_start_sample=max(0,self.total-self.buffer.shape[1]), waveform_stride=5,
                    feature_history=list(self.history), recording=rec, recorded_position_seconds=position_ts,
                    verified_samples=self.verified_samples, mismatched_samples=self.mismatched_samples,
                    timestamp_gaps=self.timestamp_gaps, counter_gaps=self.counter_gaps, counter_duplicates=self.counter_duplicates)

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
    source: Literal['synthetic','replay','live']
    recording: str = ''
    serial_port: str = ''

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
