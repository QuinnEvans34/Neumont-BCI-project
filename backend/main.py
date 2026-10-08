"""Local, single-owner Cyton/replay service with diagnostic controls."""
import asyncio
from contextlib import asynccontextmanager
import math
import os
from pathlib import Path
import time
import numpy as np
from brainflow.board_shim import BoardShim, BoardIds, BrainFlowInputParams
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Literal
from serial.tools import list_ports
from backend.signal import Calibration, feature

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
        self.total = 0
        self.last_packet = 0
        self.buffer = np.empty((len(CHANNELS), 0))
        self.cal = Calibration()
        self.pending = 0
        self.value = None
        self.quality = 'poor'
        self.sequence = 0
        self.lock = asyncio.Lock()

    def stop(self):
        try:
            if self.board:
                self.board.release_session()
        except Exception as exc:
            self.error = f'Board cleanup failed: {exc}'
        finally:
            self.board = None
            self.enabled = False
            self.quality = 'poor'
            self.cal = Calibration()
            self.value = None
            self.buffer = np.empty((len(CHANNELS), 0))

    def connect(self, request):
        self.stop()
        self.source = request.source
        self.error = None
        self.total = 0
        self.last_packet = 0
        self.value = None
        self.pending = 0
        self.cal = Calibration()
        self.buffer = np.empty((len(CHANNELS), 0))
        if request.source == 'synthetic':
            self.enabled = True
            return
        params = BrainFlowInputParams()
        if request.source == 'replay':
            path = (RECORDINGS / request.recording).resolve()
            if not path.is_relative_to(RECORDINGS) or not path.name.startswith('BrainFlow-RAW') or path.suffix != '.csv' or not path.is_file():
                raise ValueError('Select a BrainFlow recording from the list.')
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
            if board.is_prepared():
                board.release_session()
            raise

    def tick(self):
        self.sequence += 1
        if not self.enabled:
            self.quality = 'poor'
            return
        if self.source == 'synthetic':
            self.quality = 'good'
            return
        if not self.board:
            self.quality = 'poor'
            return
        data = self.board.get_board_data()
        if data.shape[1]:
            self.last_packet = time.monotonic()
            self.total += data.shape[1]
            self.pending += data.shape[1]
            self.buffer = np.concatenate((self.buffer, data[CHANNELS]), axis=1)[:, -RATE * 2:]
            self.value = feature(self.buffer, RATE)
            self.quality = 'good' if self.value is not None else 'poor'
            if self.value is not None:
                if self.cal.center is None and self.pending >= RATE * 2 and self.buffer.shape[1] >= RATE * 2:
                    self.pending = 0
                    self.cal.collect(self.value)
                elif self.cal.center is not None:
                    self.cal.map(self.value)
        if not self.last_packet or time.monotonic() - self.last_packet > 2:
            self.quality = 'poor'
        if self.source == 'live' and not self.last_packet and time.monotonic() - self.started_at >= 5:
            self.error = 'No live Cyton samples received within 5 seconds. Check board power, USB dongle, radio link, and close the OpenBCI GUI session.'
            self.stop()

    def receiving(self):
        return bool(self.enabled and self.board is not None and self.last_packet
                    and time.monotonic() - self.last_packet <= 2)

    def state(self):
        if self.error:
            return 'error'
        if not self.enabled:
            return 'disconnected'
        if self.source == 'synthetic':
            return 'simulation'
        if not self.last_packet:
            return 'waiting_for_samples'
        return 'receiving' if self.receiving() else 'stalled'

    def status(self):
        receiving = self.receiving()
        return dict(source=self.source, connected=receiving, session_open=self.board is not None,
                    receiving_samples=receiving, live_verified=self.source == 'live' and receiving,
                    state=self.state(),
                    sample_rate_hz=RATE, samples_received=self.total,
                    packet_age_ms=round((time.monotonic() - self.last_packet) * 1000) if self.last_packet else None,
                    calibration_seconds=min(60, len(self.cal.values) * 2), calibrated=self.cal.center is not None,
                    relative_alpha=self.value, quality=self.frame()['quality'], error=self.error,
                    channel_std_uv=np.std(self.buffer, axis=1).tolist() if self.buffer.shape[1] else [])

    def frame(self):
        return dict(version=1, sequence=self.sequence, timestamp_ms=int(time.time() * 1000), source=self.source,
                    score=0.5 + 0.4 * math.sin(time.monotonic() * 0.4) if self.source == 'synthetic' else self.cal.score,
                    quality=self.quality if (self.receiving() or (self.enabled and self.source == 'synthetic')) else 'poor',
                    calibrated=self.enabled and (self.source == 'synthetic' or self.cal.center is not None))

service = Service()
async def worker():
    while True:
        async with service.lock:
            try:
                await asyncio.to_thread(service.tick)
            except Exception as exc:
                service.error = str(exc)
                await asyncio.to_thread(service.stop)
        await asyncio.sleep(0.25)

@asynccontextmanager
async def lifespan(app):
    task = asyncio.create_task(worker())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    service.stop()

app = FastAPI(title='Brain Balance input service', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5173', 'http://localhost:5173'], allow_methods=['GET','POST'], allow_headers=['Content-Type'])
class ConnectRequest(BaseModel):
    source: Literal['synthetic','replay','live']
    recording: str = ''
    serial_port: str = ''

@app.get('/health')
def health():
    return {'status':'ok', 'source': service.source, 'protocol_version':1}
@app.get('/api/status')
async def status():
    async with service.lock:
        return service.status()
@app.get('/api/options')
def options():
    return dict(recordings=[str(p.relative_to(RECORDINGS)) for p in sorted(RECORDINGS.glob('**/BrainFlow-RAW*.csv'))],
                ports=[dict(device=p.device, description=p.description) for p in list_ports.comports()])
@app.post('/api/connect')
async def connect(request: ConnectRequest):
    async with service.lock:
        try:
            await asyncio.to_thread(service.connect, request)
        except Exception as exc:
            service.error = str(exc)
            raise HTTPException(400, service.error)
        return service.status()
@app.post('/api/disconnect')
async def disconnect():
    async with service.lock:
        await asyncio.to_thread(service.stop)
        return service.status()
@app.post('/api/calibrate')
async def calibrate():
    async with service.lock:
        if not service.receiving():
            raise HTTPException(409, 'Cannot calibrate without incoming EEG samples.')
        service.cal = Calibration()
        service.pending = 0
        service.buffer = np.empty((len(CHANNELS),0))
        service.error = None
        return service.status()
@app.websocket('/ws/input')
async def stream(socket: WebSocket):
    await socket.accept()
    try:
        while True:
            async with service.lock:
                frame = service.frame()
            await socket.send_json(frame)
            await asyncio.sleep(0.25)
    except (WebSocketDisconnect, RuntimeError):
        return
