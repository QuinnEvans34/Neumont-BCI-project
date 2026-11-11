import csv
import io
import json
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from backend.research import flags, schema
from backend.test_research import Rig


class FakeReader:
    def __init__(self, events, samples, acquisitions=None):
        self.events = events
        self.samples = samples
        self.acqs = acquisitions or [dict(acquisition_id='A', started_wall_s=0.0)]

    def rows(self, table):
        if table == 'events':
            return iter(self.events)
        if table == 'acquisitions':
            return iter(self.acqs)
        raise KeyError(table)

    def columns_of(self, table, names):
        assert table == 'eeg'
        for acq, i in self.samples:
            yield ('R', 'P1', acq, i, 1000.0 + i / 250)


def ev(type_, t, sample, acq='A', game='cairn', round_id='R1', **payload):
    return dict(event_id=f'{type_}@{t}', type=type_, game=game, round_id=round_id, est_server_wall_s=t,
                server_wall_s=t, acquisition_id=acq, sample_estimate=sample, producer='browser',
                payload_json=json.dumps(payload))


def table(reader):
    cols = schema.columns('eeg_flags')
    return [dict(zip(cols, r)) for r in flags.rows(reader)]


class FlagTests(unittest.TestCase):
    def test_intervals_and_impulses_land_on_the_right_samples(self):
        events = [
            ev('round_started', 1, 2, mode='calm', stones_at_start=0, hand_phase='approach', steady=True),
            ev('bug_started', 2, 4, effect_id='R1:effect-0', strength=0.5, path='air', direction=-1),
            ev('flicker_started', 3, 5, flicker_id='F1', hz=15),
            ev('stone_placed', 4, 6, stones=1),
            ev('flicker_ended', 5, 7, flicker_id='F1'),
            ev('bug_ended', 6, 8, effect_id='R1:effect-0'),
            ev('gust_started', 7, 9, effect_id='R1:effect-1', strength=0.7, direction=1),
            ev('gust_peak_reached', 8, 10, effect_id='R1:effect-1'),
            ev('gust_easing', 9, 11, effect_id='R1:effect-1'),
            ev('cairn_fell', 10, 12),
            ev('gust_ended', 10.1, 12, effect_id='R1:effect-1'),
            ev('round_ended', 10.2, 12),
            ev('tumble_started', 11, 13),
            ev('tumble_settled', 12, 15),
        ]
        rows = table(FakeReader(events, [('A', i) for i in range(17)]))
        self.assertEqual(len(rows), 17)
        col = lambda k: [r[k] for r in rows]
        self.assertEqual(col('round_active'), [False] * 2 + [True] * 10 + [False] * 5)
        self.assertEqual(col('cairn_bug_active'), [False] * 4 + [True] * 4 + [False] * 9)
        self.assertEqual(col('cairn_flicker_on'), [False] * 5 + [True] * 2 + [False] * 10)
        self.assertEqual(col('cairn_flicker_hz')[5:7], [15, 15])
        self.assertIsNone(rows[7]['cairn_flicker_hz'])
        self.assertEqual(col('cairn_gust_active'), [False] * 9 + [True] * 3 + [False] * 5)
        self.assertEqual(col('cairn_gust_peak'), [False] * 10 + [True] + [False] * 6)
        self.assertEqual(col('cairn_tumbling'), [False] * 13 + [True] * 2 + [False] * 2)
        self.assertEqual(col('cairn_stones'), [None] * 2 + [0] * 4 + [1] * 11)
        self.assertEqual(rows[4]['cairn_bug_path'], 'air')
        self.assertEqual(rows[4]['cairn_bug_direction'], -1)
        self.assertEqual(rows[12]['events'], 'cairn_fell;gust_ended;round_ended')
        self.assertEqual(rows[12]['event_ids'].split(';')[0], 'cairn_fell@10')
        self.assertEqual(rows[3]['events'], '')
        self.assertEqual(rows[0]['round_id'], None)
        self.assertEqual(rows[16]['round_id'], 'R1', 'the last round stays named after it ends')

    def test_event_between_samples_and_before_first_sample(self):
        events = [ev('round_started', 1, -40, mode='go', stones_at_start=0), ev('marker', 2, 7, game=None)]
        rows = table(FakeReader(events, [('A', 5), ('A', 6), ('A', 9), ('A', 10)]))  # 7 and 8 missing (gap)
        self.assertEqual([r['events'] for r in rows], ['round_started', '', 'marker', ''])
        self.assertTrue(all(r['round_active'] for r in rows))

    def test_state_carries_into_a_new_acquisition(self):
        events = [
            ev('round_started', 1, 3, acq='A', mode='calm', stones_at_start=0),
            ev('bug_started', 2, 5, acq='A', effect_id='R1:effect-0', strength=0.2, path='ground', direction=1),
            ev('bug_ended', 30, 100, acq='B', effect_id='R1:effect-0'),
        ]
        acqs = [dict(acquisition_id='A', started_wall_s=0.0), dict(acquisition_id='B', started_wall_s=20.0)]
        samples = [('A', i) for i in range(8)] + [('B', i) for i in range(98, 103)]
        rows = table(FakeReader(events, samples, acqs))
        b = [r for r in rows if r['acquisition_id'] == 'B']
        self.assertEqual([r['cairn_bug_active'] for r in b], [True, True, False, False, False])
        self.assertTrue(all(r['round_active'] for r in b))

    def test_an_event_without_a_sample_still_updates_state(self):
        events = [ev('round_started', 1, None, mode='calm', stones_at_start=0), ev('stone_placed', 2, 3, stones=1)]
        rows = table(FakeReader(events, [('A', i) for i in range(5)]))
        self.assertEqual([r['round_active'] for r in rows], [False] * 3 + [True] * 2)

    def test_garden_growth_and_plant_pause(self):
        events = [ev('round_started', 1, 1, game='garden', round_id='G1'),
                  ev('growth_started', 2, 2, game='garden', round_id='G1'),
                  ev('plant_paused', 3, 3, game='garden', round_id='G1'),
                  ev('growth_stopped', 3.1, 3, game='garden', round_id='G1'),
                  ev('plant_resumed', 4, 4, game='garden', round_id='G1')]
        rows = table(FakeReader(events, [('A', i) for i in range(6)]))
        self.assertEqual([r['garden_growing'] for r in rows], [False, False, True, False, False, False])
        self.assertEqual([r['round_paused'] for r in rows], [False] * 3 + [True] + [False] * 2)
        self.assertIsNone(rows[2]['cairn_stones'])


class FlagExportTests(unittest.TestCase):
    def test_export_has_one_flag_row_per_eeg_row_and_places_game_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            rig = Rig(tmp, 'both')
            rig.connect_live()
            rec = rig.start()
            rig.feed(1)
            now = lambda: time.time() * 1000
            rig.s.research.items(rec.id, rec.token, [
                dict(seq=1, kind='event', event_id='rs', type='round_started', game='cairn', round_id='R1',
                     t_browser_ms=now(), payload=dict(mode='calm', stones_at_start=0)),
                dict(seq=2, kind='event', event_id='bs', type='bug_started', game='cairn', round_id='R1',
                     t_browser_ms=now(), payload=dict(effect_id='R1:effect-0', strength=0.4, path='air', direction=1)),
                dict(seq=3, kind='event', event_id='fs', type='flicker_started', game='cairn', round_id='R1',
                     t_browser_ms=now(), payload=dict(flicker_id='F', hz=15))])
            rig.feed(2)
            rig.s.research.items(rec.id, rec.token, [
                dict(seq=4, kind='event', event_id='fe', type='flicker_ended', game='cairn', round_id='R1',
                     t_browser_ms=now(), payload=dict(flicker_id='F')),
                dict(seq=5, kind='event', event_id='be', type='bug_ended', game='cairn', round_id='R1',
                     t_browser_ms=now(), payload=dict(effect_id='R1:effect-0'))])
            rig.feed(1)
            folder = rig.finish(rec)
            path, _ = rig.store.export_zip(rec.id)
            with zipfile.ZipFile(path) as z:
                files = {Path(n).name: z.read(n) for n in z.namelist()}
            eeg = list(csv.DictReader(io.StringIO(files['eeg.csv'].decode())))
            fl = list(csv.DictReader(io.StringIO(files['eeg_flags.csv'].decode())))
            self.assertEqual(len(fl), len(eeg))
            self.assertEqual([(r['acquisition_id'], r['sample_index']) for r in fl],
                             [(r['acquisition_id'], r['sample_index']) for r in eeg])
            on = [int(r['sample_index']) for r in fl if r['cairn_bug_active'] == '1']
            self.assertTrue(on, 'bug interval flagged')
            self.assertEqual(on, list(range(on[0], on[-1] + 1)), 'one contiguous stretch')
            self.assertTrue(200 <= on[0] <= 300 and 700 <= on[-1] <= 800, (on[0], on[-1]))
            self.assertTrue(all(r['cairn_flicker_hz'] == '15.0' for r in fl if r['cairn_flicker_on'] == '1'))
            marked = [r['events'] for r in fl if r['events']]
            self.assertIn('round_started;bug_started;flicker_started', marked)
            man = json.loads(files['manifest.json'])
            self.assertEqual(man['files']['eeg_flags.csv']['rows'], len(fl))
            self.assertIn('## eeg_flags.csv', files['data_dictionary.md'].decode())
            # The same table downloads on its own, and the stored recording is untouched.
            data, _ = rig.store.table_csv(rec.id, 'eeg_flags')
            self.assertEqual(data, files['eeg_flags.csv'])
            self.assertFalse((folder / 'eeg_flags.csv').exists())


if __name__ == '__main__':
    unittest.main()
