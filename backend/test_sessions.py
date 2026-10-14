import unittest
from unittest.mock import MagicMock, patch
import numpy as np
from backend.main import Service, CHANNELS, RATE, TIMESTAMP
from backend.signal import feature


def block(start, count, flat=False):
    data=np.zeros((24,count))
    n=np.arange(start,start+count)
    t=n/RATE
    # Variable spectral mix produces a non-degenerate baseline.
    amplitude=12+7*np.sin(t*.25)
    for channel in CHANNELS:
        data[channel]=0 if flat else amplitude*np.sin(2*np.pi*10*t)+12*np.sin(2*np.pi*20*t)
    data[TIMESTAMP]=1000+t
    data[0]=n%256
    return data


def service():
    s=Service();s.source='live';s.board=MagicMock();s.enabled=True;s.session_id='test-session';s.started_at=100
    return s


class SessionTests(unittest.TestCase):
    def test_explicit_baseline_ignores_previous_samples_and_survives_handoff(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            s.ingest(block(0,1000))
            self.assertEqual(s.cal.values,[])
            self.assertFalse(s.calibrating)
            s.begin_calibration()
            self.assertEqual(s.baseline_start_sample,1000)
            # Vary chunk boundaries: windows must consume exactly 15,000 samples.
            start=1000
            for count in [333]*45+[15]:
                s.ingest(block(start,count));start+=count
            self.assertEqual(start,16000)
            self.assertEqual(len(s.cal.values),30)
            np.testing.assert_allclose(s.cal.values,[feature(block(i,500)[CHANNELS],RATE) for i in range(1000,16000,500)],rtol=1e-12)
            self.assertEqual(s.baseline_end_sample,16000)
            self.assertTrue(s.status()['calibrated'])
            identity=s.session_id;center=s.cal.center
            s.status();s.frame() # Navigation only observes the session.
            s.ingest(block(start,250))
            self.assertEqual(s.session_id,identity)
            self.assertEqual(s.cal.center,center)
            self.assertEqual(s.total,16250)
            self.assertFalse(s.calibrating)

    def test_rejected_window_does_not_advance_baseline(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            s.ingest(block(0,500));s.begin_calibration()
            s.ingest(block(500,500,flat=True))
            self.assertEqual(s.rejected,1)
            self.assertEqual(s.cal.values,[])
            self.assertIn('Flat signal',s.last_rejection)
            s.ingest(block(1000,500))
            self.assertEqual(len(s.cal.values),1)
            self.assertEqual(s.status()['calibration_seconds'],2)

    def test_timestamp_gap_window_is_rejected(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            s.ingest(block(0,500));s.begin_calibration()
            data=block(500,500);data[TIMESTAMP,250:]+=5
            s.ingest(data)
            self.assertEqual(s.rejected,1)
            self.assertIn('Timestamp gap',s.last_rejection)
            self.assertEqual(s.quality,'poor')

    def test_replay_matches_file_and_stops_at_exact_eof(self):
        s=service();s.source='replay'
        data=block(0,1000);s.file_data=data.T.copy();s.recording={'samples':1000}
        with patch('backend.main.time.monotonic',return_value=101):
            incoming=data[:,:500].copy();incoming[TIMESTAMP]+=9000
            s.ingest(incoming)
            self.assertEqual(s.verified_samples,500)
            self.assertEqual(s.mismatched_samples,0)
            self.assertAlmostEqual(s.value,feature(data[CHANNELS,:500],RATE))
            self.assertTrue(s.receiving())
            s.ingest(data[:,500:])
            self.assertEqual(s.total,1000)
            self.assertEqual(s.verified_samples,1000)
            self.assertEqual(s.state(),'recording_complete')
            self.assertFalse(s.receiving())
            self.assertEqual(s.frame()['quality'],'poor')

    def test_mismatched_replay_is_not_consumed(self):
        s=service();s.source='replay'
        data=block(0,500);s.file_data=data.T.copy();s.recording={'samples':500}
        data[CHANNELS[0],0]+=1
        with self.assertRaisesRegex(ValueError,'differs'):
            s.ingest(data)
        self.assertEqual(s.total,0)
        self.assertEqual(s.mismatched_samples,1)

    def test_live_counter_wrap_is_not_loss(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            s.ingest(block(0,260))
            self.assertEqual(s.counter_gaps,0)
            self.assertEqual(s.counter_duplicates,0)
            s.ingest(block(262,2))
            self.assertEqual(s.counter_gaps,2)

    def test_live_small_gaps_and_duplicates_reject_then_recover(self):
        for duplicate in (False, True):
            with self.subTest(duplicate=duplicate):
                s=service()
                with patch('backend.main.time.monotonic',return_value=101):
                    s.ingest(block(0,500));s.begin_calibration()
                    # Discontinuity crosses SDK reads, well below the 100 ms timestamp gate.
                    s.ingest(block(500,200))
                    start=699 if duplicate else 701
                    s.ingest(block(start,300))
                    self.assertEqual(s.rejected,1)
                    self.assertEqual(s.cal.values,[])
                    self.assertEqual(s.quality,'poor')
                    self.assertIn('Cyton packets',s.last_rejection)
                    s.ingest(block(start+300,500))
                    self.assertEqual(len(s.cal.values),1)
                    self.assertEqual(s.quality,'good')

    def test_multiple_packet_gaps_in_large_read_reject_each_window(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            s.ingest(block(0,500));s.begin_calibration()
            data=block(500,1000)
            data[0,100:]=(data[0,100:]+1)%256
            data[0,600:]=(data[0,600:]+1)%256
            s.ingest(data)
            self.assertEqual(s.rejected,2)
            self.assertEqual(s.cal.values,[])

    def test_recalibration_preserves_source_and_position(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            s.ingest(block(0,500));board=s.board
            s.begin_calibration();s.ingest(block(500,500));s.begin_calibration()
            self.assertIs(s.board,board)
            self.assertEqual(s.total,1000)
            self.assertEqual(s.session_id,'test-session')
            self.assertEqual(s.cal.values,[])
            self.assertEqual(s.baseline_start_sample,1000)

if __name__=='__main__':unittest.main()
