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
        s.last_packet = time.monotonic() - 3
        s.quality = 'good'
        s.cal.center = .2
        s.cal.scale = .1
        s.tick()
        self.assertEqual(s.frame()['quality'], 'poor')

if __name__ == '__main__': unittest.main()
