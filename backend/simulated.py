"""Simulated EEG board: Cyton-shaped 24-row samples at 250 Hz, generated in real time.

Used only for the explicitly labelled "Simulated EEG — no headset" source. It is
drained by the same single acquisition producer as a real board. Signals:
background 1/f-like noise, a slowly varying 10 Hz alpha rhythm (strongest on
CH6–CH8), optional SSVEP-like sinusoids at an operator-chosen "gaze" frequency
on CH6–CH8, and optional horizontal-eye-movement steps on CH1/CH2.

A response generated from a chosen frequency is pipeline testing, never
evidence that the decoder works on people.
"""
import threading
import time
import numpy as np
from brainflow.board_shim import BoardShim, BoardIds

CYTON = BoardIds.CYTON_BOARD.value
RATE = BoardShim.get_sampling_rate(CYTON)
EEG = BoardShim.get_eeg_channels(CYTON)
TIMESTAMP = BoardShim.get_timestamp_channel(CYTON)
ROWS = BoardShim.get_num_rows(CYTON)
POSTERIOR = (5, 6, 7)  # CH6–CH8 (0-based within EEG list) carry the simulated visual responses
SSVEP_UV = 6.0
ALPHA_UV = 9.0
NOISE_UV = 6.0
EOG_UV = 60.0


class SimulatedBoard:
    def __init__(self, seed=None, clock=time.monotonic, wall=time.time):
        self.rng = np.random.default_rng(seed)
        self.clock = clock
        self.wall = wall
        self.lock = threading.Lock()
        self.started = None
        self.wall_start = None
        self.generated = 0
        self.state = np.zeros(len(EEG))
        self.eog = 0.0
        self.gaze_hz = None
        self.gaze_onset = 0
        self.gaze_side = None

    # BrainFlow-compatible surface used by the service
    def prepare_session(self): pass
    def start_stream(self):
        self.started = self.clock()
        self.wall_start = self.wall()
    def is_prepared(self): return True
    def release_session(self): self.started = None

    def set_stimulus(self, gaze_hz=None, gaze_side=None):
        with self.lock:
            if gaze_hz != self.gaze_hz:
                self.gaze_onset = self.generated + int(0.12 * RATE)  # plausible visual latency
            self.gaze_hz = gaze_hz
            self.gaze_side = gaze_side

    def get_board_data(self):
        if self.started is None:
            return np.zeros((ROWS, 0))
        due = int((self.clock() - self.started) * RATE)
        with self.lock:
            n = max(0, due - self.generated)
            if not n:
                return np.zeros((ROWS, 0))
            idx = self.generated + np.arange(n)
            self.generated += n
            gaze_hz, gaze_onset, side = self.gaze_hz, self.gaze_onset, self.gaze_side
        t = idx / RATE
        data = np.zeros((ROWS, n))
        data[0] = idx % 256
        data[TIMESTAMP] = self.wall_start + t
        white = self.rng.normal(0, 1, (len(EEG), n))
        x = np.empty_like(white)
        for k in range(n):  # AR(1) pink-ish background
            self.state = 0.96 * self.state + white[:, k]
            x[:, k] = self.state
        x *= NOISE_UV / 3.5
        x += self.rng.normal(0, 1.2, x.shape)
        alpha = ALPHA_UV * (0.55 + 0.45 * np.sin(2 * np.pi * t / 23.0)) * np.sin(2 * np.pi * 10.2 * t + 0.3)
        for c in range(len(EEG)):
            gain = 1.0 if c in POSTERIOR else 0.35
            x[c] += gain * alpha
        if gaze_hz:
            on = idx >= gaze_onset
            resp = SSVEP_UV * (np.sin(2 * np.pi * gaze_hz * t) + 0.45 * np.sin(2 * np.pi * 2 * gaze_hz * t + 0.8))
            for c, g in zip(POSTERIOR, (0.8, 1.0, 0.85)):
                x[c] += g * resp * on
        target = {'left': -EOG_UV, 'right': EOG_UV}.get(side, 0.0)
        eog = np.empty(n)
        for k in range(n):  # saccade-like steps smoothed over ~40 ms
            self.eog += (target - self.eog) * 0.1
            eog[k] = self.eog
        x[0] += eog
        x[1] -= 0.8 * eog
        for c, row in enumerate(EEG):
            data[row] = x[c]
        return data
