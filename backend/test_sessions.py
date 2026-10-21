import unittest
from unittest.mock import MagicMock, patch
import numpy as np
from backend.main import Service, CHANNELS, RATE, TIMESTAMP
from backend.signal import feature


def block(start, count, flat=False, gain=1):
    data=np.zeros((24,count))
    n=np.arange(start,start+count)
    t=n/RATE
    # Variable spectral mix produces a non-degenerate baseline.
    amplitude=12+7*np.sin(t*.25)
    for channel in CHANNELS:
        data[channel]=0 if flat else gain*(amplitude*np.sin(2*np.pi*10*t)+12*np.sin(2*np.pi*20*t))
    data[TIMESTAMP]=1000+t
    data[0]=n%256
    return data


def service():
    s=Service();s.source='live';s.board=MagicMock();s.enabled=True;s.session_id='test-session';s.started_at=100
    return s


class SessionTests(unittest.TestCase):
    def test_experiments_keep_strict_counter_breaks_across_batches(self):
        s = service()
        s.experiments.on_samples = MagicMock()
        s.ingest(block(0, 250))
        # A one-sample skip is tolerated by the game tracker, but is still
        # forwarded to experiments at its absolute sample index.
        s.ingest(block(251, 250))
        self.assertEqual(s.counter.lost, 1)
        self.assertIsNone(s.counter.problem(0, 500))
        args = s.experiments.on_samples.call_args.args
        self.assertEqual(args[0], 250)
        self.assertEqual(args[4], [250])
        self.assertEqual(args[1].shape, (8, 250))
        s.set_gate(2000)
        self.assertEqual(s.gate_uv, 2000)
        self.assertEqual(s.last_counter, 500 % 256)

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

    def test_acceptance_gate_decides_baseline_windows_and_is_fixed_while_collecting(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            # Gain 30 keeps every window between roughly 900 and 1700 µV peak-to-peak.
            s.ingest(block(0,500,gain=30));s.begin_calibration()
            s.ingest(block(500,500,gain=30))
            self.assertIsNone(s.value)
            self.assertEqual(s.rejected,1)
            self.assertIn('500 µV peak-to-peak',s.last_rejection)
            with self.assertRaisesRegex(ValueError,'being collected'):
                s.set_gate(2000)
            self.assertEqual(s.gate_uv,500)
            s.calibrating=False
            s.set_gate(2000)
            # The current window is re-judged immediately, before more samples arrive.
            self.assertIsNotNone(s.value)
            self.assertTrue(all(c['included'] for c in s.channel_details))
            s.begin_calibration()
            start=1000
            for _ in range(30):
                s.ingest(block(start,500,gain=30));start+=500
            self.assertEqual(len(s.cal.values),30)
            self.assertEqual(s.rejected,0)
            self.assertTrue(s.status()['calibrated'])
            s.set_gate(500)
            status=s.status()
            self.assertEqual(status['gate_max_ptp_uv'],500)
            self.assertEqual(status['baseline_gate_uv'],2000)
            self.assertIsNone(s.value)
            for bad in [50,6000,float('nan')]:
                with self.assertRaisesRegex(ValueError,'between'):
                    s.set_gate(bad)

    def test_acceptance_gate_is_kept_across_sessions(self):
        from backend.main import ConnectRequest
        s=Service()
        s.set_gate(1500)
        s.connect(ConnectRequest(source='synthetic'))
        self.assertEqual(s.status()['gate_max_ptp_uv'],1500)
        self.assertIsNone(s.status()['baseline_gate_uv'])

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
            self.assertEqual((s.counter.lost,s.counter.corrupt,s.counter.breaks),(0,0,0))
            s.ingest(block(262,5))
            self.assertEqual((s.counter.lost,s.counter.corrupt,s.counter.breaks),(2,0,0))

    def test_live_lost_or_repeated_samples_reject_then_recover(self):
        for start,reason in ((710,'10 Cyton samples missing'),(699,'repeated or restarted')):
            with self.subTest(start=start):
                s=service()
                with patch('backend.main.time.monotonic',return_value=101):
                    s.ingest(block(0,500));s.begin_calibration()
                    # Discontinuity crosses SDK reads, far below the timestamp span tolerance.
                    s.ingest(block(500,200))
                    s.ingest(block(start,300))
                    self.assertEqual(s.rejected,1)
                    self.assertEqual(s.cal.values,[])
                    self.assertEqual(s.quality,'poor')
                    self.assertIn(reason,s.last_rejection)
                    s.ingest(block(start+300,500))
                    self.assertEqual(len(s.cal.values),1)
                    self.assertEqual(s.quality,'good')

    def test_corrupted_counters_and_tiny_losses_are_tolerated_up_to_limits(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            s.ingest(block(0,500));s.begin_calibration()
            data=block(500,1000)
            # Radio bit errors: lone (and a pair of) out-of-sequence counters, then 2 lost samples.
            for i in (50,51,300,620): data[0,i]=(data[0,i]+97)%256
            data[0,700:]=(data[0,700:]+2)%256
            s.ingest(data)
            self.assertEqual(s.rejected,0)
            self.assertEqual(len(s.cal.values),2)
            self.assertEqual((s.counter.lost,s.counter.corrupt,s.counter.breaks),(2,4,0))
            self.assertEqual(s.quality,'good')
            data=block(1500,500)
            data[0]=(data[0]+2)%256  # continue the sequence after the 2 lost samples
            data[0,::10]=(data[0,::10]+50)%256
            s.ingest(data)
            self.assertEqual(s.rejected,1)
            self.assertIn('50 corrupted Cyton packets',s.last_rejection)

    def test_multiple_packet_gaps_in_large_read_reject_each_window(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            s.ingest(block(0,500));s.begin_calibration()
            data=block(500,1000)
            data[0,100:]=(data[0,100:]+10)%256
            data[0,600:]=(data[0,600:]+10)%256
            s.ingest(data)
            self.assertEqual(s.rejected,2)
            self.assertEqual(s.cal.values,[])

    def test_bursty_host_timestamps_are_not_gaps(self):
        s=service()
        with patch('backend.main.time.monotonic',return_value=101):
            s.ingest(block(0,500));s.begin_calibration()
            data=block(500,1000)
            # USB delivers 0.4 s bursts stamped on arrival: 400 ms pauses, nothing missing.
            data[TIMESTAMP]=1000+np.ceil(np.arange(500,1500)/RATE/.4)*.4
            s.ingest(data)
            self.assertEqual(s.rejected,0)
            self.assertEqual(len(s.cal.values),2)
            self.assertEqual(s.quality,'good')

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
