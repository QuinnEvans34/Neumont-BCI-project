import unittest
import numpy as np
from backend.signal import Calibration, feature

class SignalTests(unittest.TestCase):
    def test_alpha_feature_distinguishes_frequency_and_rejects_flat_artifact(self):
        t = np.arange(500) / 250
        alpha = np.array([20 * np.sin(2*np.pi*10*t)])
        beta = np.array([20 * np.sin(2*np.pi*20*t)])
        self.assertGreater(feature(alpha,250), .95)
        self.assertLess(feature(beta,250), .05)
        self.assertIsNone(feature(np.zeros((1,500)),250))
        self.assertIsNone(feature(alpha * 100,250))

    def test_calibration_center_extremes_and_flat_failure(self):
        c = Calibration()
        for v in np.linspace(.1,.3,30): c.collect(float(v))
        self.assertAlmostEqual(c.map(c.center), .5)
        for _ in range(100): c.map(1)
        self.assertGreater(c.score,.99)
        c = Calibration()
        with self.assertRaises(ValueError):
            for _ in range(30): c.collect(.2)


class ServiceTests(unittest.TestCase):
    def test_disconnect_does_not_fall_back_to_synthetic(self):
        from backend.main import Service
        s = Service()
        s.source = 'replay'
        s.cal.center = .2
        s.cal.scale = .1
        s.stop()
        s.tick()
        self.assertEqual(s.frame()['source'], 'replay')
        self.assertEqual(s.frame()['quality'], 'poor')

    def test_old_buffer_cannot_keep_replay_playing_after_eof(self):
        import time
        from backend.main import Service
        class EmptyBoard:
            def get_board_data(self): return np.empty((24,0))
        s = Service()
        s.source = 'replay'
        s.board = EmptyBoard()
        s.enabled = True
        s.last_packet = time.monotonic() - 3
        s.quality = 'good'
        s.cal.center = .2
        s.cal.scale = .1
        s.tick()
        self.assertEqual(s.frame()['quality'], 'poor')

class ConnectionTests(unittest.TestCase):
    def test_startup_is_disconnected_and_cannot_drive_game(self):
        from backend.main import Service
        s = Service()
        s.tick()
        self.assertEqual(s.status()['state'], 'disconnected')
        self.assertFalse(s.status()['connected'])
        self.assertFalse(s.frame()['calibrated'])
        self.assertEqual(s.frame()['quality'], 'poor')

    def test_missing_port_rejects_live_and_discards_previous_simulation(self):
        from unittest.mock import patch
        from backend.main import Service, ConnectRequest
        s = Service()
        s.connect(ConnectRequest(source='synthetic'))
        with patch('backend.main.list_ports.comports', return_value=[]), patch('backend.main.BoardShim') as board:
            with self.assertRaisesRegex(ValueError, 'unavailable'):
                s.connect(ConnectRequest(source='live', serial_port='/dev/cu.missing'))
            board.assert_not_called()
        self.assertFalse(s.status()['connected'])
        self.assertFalse(s.frame()['calibrated'])
        self.assertEqual(s.frame()['source'], 'live')
        self.assertEqual(s.frame()['quality'], 'poor')

    def test_open_session_without_samples_is_not_connected_and_times_out(self):
        from unittest.mock import patch, MagicMock
        from types import SimpleNamespace
        from backend.main import Service, ConnectRequest
        board = MagicMock()
        board.get_board_data.return_value = np.empty((24,0))
        with patch('backend.main.list_ports.comports', return_value=[SimpleNamespace(device='test-port')]), patch('backend.main.BoardShim', return_value=board), patch('backend.main.time.monotonic', return_value=100):
            s = Service()
            s.connect(ConnectRequest(source='live', serial_port='test-port'))
            self.assertTrue(s.status()['session_open'])
            self.assertFalse(s.status()['connected'])
            self.assertFalse(s.status()['live_verified'])
            self.assertEqual(s.status()['state'], 'waiting_for_samples')
        with patch('backend.main.time.monotonic', return_value=106):
            s.tick()
            self.assertEqual(s.status()['state'], 'error')
            self.assertFalse(s.status()['session_open'])
            self.assertEqual(s.frame()['quality'], 'poor')
            self.assertIn('No live Cyton samples', s.error)
        board.release_session.assert_called_once()

    def test_receiving_replay_never_verifies_live_headset(self):
        from unittest.mock import MagicMock, patch
        from backend.main import Service
        s = Service()
        s.source = 'replay'
        s.enabled = True
        s.board = MagicMock()
        s.last_packet = 100
        with patch('backend.main.time.monotonic', return_value=101):
            self.assertTrue(s.status()['receiving_samples'])
            self.assertFalse(s.status()['live_verified'])

    def test_fresh_live_samples_verify_delivery_but_stale_or_disconnected_cannot_play(self):
        from unittest.mock import MagicMock, patch
        from backend.main import Service, CHANNELS
        s = Service()
        s.enabled = True
        s.board = MagicMock()
        data = np.zeros((24,500))
        data[0] = np.arange(500)%256
        for ch in CHANNELS: data[ch] = 20*np.sin(2*np.pi*10*np.arange(500)/250)
        s.board.get_board_data.return_value = data
        with patch('backend.main.time.monotonic', return_value=100):
            s.tick()
            self.assertTrue(s.status()['live_verified'])
            self.assertFalse(s.frame()['calibrated'])
            s.cal.center = .2
            s.cal.scale = .1
            self.assertEqual(s.frame()['quality'], 'good')
        # The frame must fail closed even before the next worker tick.
        with patch('backend.main.time.monotonic', return_value=103):
            self.assertFalse(s.status()['connected'])
            self.assertEqual(s.status()['state'], 'stalled')
            self.assertEqual(s.frame()['quality'], 'poor')
            s.stop()
            self.assertFalse(s.frame()['calibrated'])
            self.assertFalse(s.status()['connected'])

    def test_synthetic_is_ready_immediately_without_board_or_calibration(self):
        from backend.main import Service, ConnectRequest
        s = Service()
        s.connect(ConnectRequest(source='synthetic'))
        f = s.frame()
        self.assertEqual(f['source'], 'synthetic')
        self.assertEqual(f['quality'], 'good')
        self.assertTrue(f['calibrated'])
        self.assertIsNone(s.board)
        self.assertFalse(s.status()['live_verified'])

    def test_synthetic_is_explicit_and_disconnect_disables_it(self):
        from backend.main import Service, ConnectRequest
        s = Service()
        s.connect(ConnectRequest(source='synthetic'))
        s.tick()
        self.assertEqual(s.status()['state'], 'simulation')
        self.assertFalse(s.status()['live_verified'])
        self.assertFalse(s.status()['connected'])
        self.assertTrue(s.frame()['calibrated'])
        s.stop()
        s.tick()
        self.assertEqual(s.frame()['source'], 'synthetic')
        self.assertFalse(s.frame()['calibrated'])
        self.assertEqual(s.frame()['quality'], 'poor')

    def test_cleanup_failure_still_disables_input(self):
        from unittest.mock import MagicMock
        from backend.main import Service
        s = Service()
        s.enabled = True
        s.board = MagicMock()
        s.board.release_session.side_effect = RuntimeError('USB removed')
        s.cal.center = .2
        s.quality = 'good'
        s.stop()
        self.assertFalse(s.enabled)
        self.assertIsNone(s.board)
        self.assertEqual(s.frame()['quality'], 'poor')
        self.assertFalse(s.frame()['calibrated'])
        self.assertIn('USB removed',s.error)

    def test_connection_failure_releases_prepared_board(self):
        from unittest.mock import MagicMock, patch
        from types import SimpleNamespace
        from backend.main import Service, ConnectRequest
        board = MagicMock()
        board.start_stream.side_effect = RuntimeError('Radio handshake failed')
        board.is_prepared.return_value = True
        s = Service()
        with patch('backend.main.list_ports.comports', return_value=[SimpleNamespace(device='test-port')]), patch('backend.main.BoardShim', return_value=board):
            with self.assertRaisesRegex(RuntimeError, 'handshake'):
                s.connect(ConnectRequest(source='live',serial_port='test-port'))
        board.release_session.assert_called_once()
        self.assertFalse(s.status()['connected'])
        self.assertEqual(s.frame()['quality'], 'poor')

class ControlEndpointTests(unittest.TestCase):
    def test_missing_device_returns_error_instead_of_success(self):
        import asyncio
        from unittest.mock import patch
        from fastapi import HTTPException
        from backend.main import Service, ConnectRequest, connect
        s = Service()
        with patch('backend.main.service',s), patch('backend.main.list_ports.comports',return_value=[]):
            with self.assertRaises(HTTPException) as result:
                asyncio.run(connect(ConnectRequest(source='live',serial_port='missing')))
        self.assertEqual(result.exception.status_code,400)
        self.assertEqual(s.status()['state'],'error')
        self.assertFalse(s.status()['live_verified'])

    def test_cannot_start_calibration_without_eeg(self):
        import asyncio
        from unittest.mock import patch
        from fastapi import HTTPException
        from backend.main import Service, calibrate
        with patch('backend.main.service',Service()):
            with self.assertRaises(HTTPException) as result:
                asyncio.run(calibrate())
        self.assertEqual(result.exception.status_code,409)

if __name__ == '__main__': unittest.main()
