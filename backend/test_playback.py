"""Native SDK integration: disk -> playback -> feature -> explicit end-of-file."""
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from brainflow.data_filter import DataFilter
from backend.main import Service, ConnectRequest, CHANNELS, RATE
from backend.recordings import inspect_recording, resolve_recording
from backend.signal import feature
from backend.test_sessions import block

class NativePlaybackTests(unittest.TestCase):
    def test_full_file_matches_native_stream_and_feature(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();path=root/'BrainFlow-RAW-test.csv'
            DataFilter.write_file(block(0,625),str(path),'w')
            expected,preview=inspect_recording(path)
            self.assertEqual(preview['samples'],625)
            s=Service()
            try:
                with patch('backend.main.RECORDINGS',root):
                    s.connect(ConnectRequest(source='replay',recording=path.name))
                deadline=time.monotonic()+15
                while not s.at_end() and time.monotonic()<deadline:
                    time.sleep(.05);s.tick()
                self.assertTrue(s.at_end())
                self.assertEqual(s.verified_samples,625)
                self.assertEqual(s.mismatched_samples,0)
                self.assertAlmostEqual(s.value,feature(expected[-500:,CHANNELS].T,RATE),places=9)
                self.assertEqual(s.state(),'recording_complete')
                self.assertEqual(s.frame()['quality'],'poor')
                self.assertEqual(len(s.cal.values),0) # No implicit calibration.
            finally:s.stop()

    def test_preview_cannot_escape_recording_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                resolve_recording(Path(directory).resolve(),'../BrainFlow-RAW-other.csv')

if __name__=='__main__':unittest.main()
