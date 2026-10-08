"""Synthetic input server. This intentionally does not claim headset connectivity."""
import asyncio
import math
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
app = FastAPI(title="Brain Balance input service")
@app.get('/health')
def health():
    return {"status": "ok", "source": "synthetic", "protocol_version": 1}
@app.websocket('/ws/input')
async def stream(socket: WebSocket):
    await socket.accept()
    sequence = 0
    started = time.monotonic()
    try:
        while True:
            await socket.send_json({
                "version": 1, "sequence": sequence,
                "timestamp_ms": int(time.time() * 1000), "source": "synthetic",
                "score": 0.5 + 0.4 * math.sin((time.monotonic() - started) * 0.4),
                "quality": "good", "calibrated": True,
            })
            sequence += 1
            await asyncio.sleep(0.25)
    except (WebSocketDisconnect, RuntimeError):
        return
