"""Per-sample event flags for the EEG time series (the derived eeg_flags table).

Built at export from events.csv: game events are replayed in occurrence order
through a small state machine (round, stones, hand, bug, gust, flicker,
tumble ...), and each state change is placed on the first EEG sample of its
acquisition at or after the event's sample_estimate. The output has one row per
eeg.csv row, in the same order. Nothing here changes the stored recording.
"""
from __future__ import annotations

import json
from collections import defaultdict

from backend.research import schema

TABLE = 'eeg_flags'


def _payload(e):
    p = e.get('payload_json')
    if isinstance(p, dict):
        return p
    try:
        return json.loads(p) if p else {}
    except ValueError:
        return {}


def _occurred(e):
    t = e.get('est_server_wall_s')
    return t if t is not None else (e.get('server_wall_s') or 0.0)


class FlagState:
    FIELDS = ('game', 'round_id', 'round_active', 'round_paused', 'cairn_mode', 'cairn_stones', 'cairn_tier',
              'cairn_hand_phase', 'cairn_steady', 'cairn_bug_active', 'cairn_bug_id', 'cairn_bug_strength',
              'cairn_bug_path', 'cairn_bug_direction', 'cairn_gust_active', 'cairn_gust_peak', 'cairn_gust_id',
              'cairn_gust_strength', 'cairn_gust_direction', 'cairn_flicker_on', 'cairn_flicker_hz',
              'cairn_flicker_id', 'cairn_tumbling', 'garden_growing')

    def __init__(self):
        self.v = dict.fromkeys(self.FIELDS)
        for k in ('round_active', 'round_paused', 'cairn_bug_active', 'cairn_gust_active', 'cairn_gust_peak',
                  'cairn_flicker_on', 'cairn_tumbling', 'garden_growing'):
            self.v[k] = False

    def values(self):
        return tuple(self.v[k] for k in self.FIELDS)

    def _clear_bug(self):
        self.v.update(cairn_bug_active=False, cairn_bug_id=None, cairn_bug_strength=None, cairn_bug_path=None,
                      cairn_bug_direction=None)

    def _clear_gust(self):
        self.v.update(cairn_gust_active=False, cairn_gust_peak=False, cairn_gust_id=None, cairn_gust_strength=None,
                      cairn_gust_direction=None)

    def _clear_flicker(self):
        self.v.update(cairn_flicker_on=False, cairn_flicker_hz=None, cairn_flicker_id=None)

    def apply(self, e):
        t, p, v = e.get('type'), _payload(e), self.v
        cairn = e.get('game') == 'cairn'
        if t == 'round_started':
            self._clear_bug()
            self._clear_gust()
            self._clear_flicker()
            v.update(game=e.get('game'), round_id=e.get('round_id'), round_active=True, round_paused=False,
                     cairn_tumbling=False, garden_growing=False)
            if cairn:
                stones = p.get('stones_at_start') or 0
                v.update(cairn_mode=p.get('mode'), cairn_stones=stones, cairn_tier=stones // 5,
                         cairn_hand_phase=p.get('hand_phase'), cairn_steady=p.get('steady'))
            else:
                v.update(cairn_mode=None, cairn_stones=None, cairn_tier=None, cairn_hand_phase=None, cairn_steady=None)
        elif t == 'round_ended':
            if e.get('round_id') == v['round_id']:
                v.update(round_active=False, round_paused=False, cairn_hand_phase=None, cairn_steady=None,
                         garden_growing=False)
                self._clear_bug()
                self._clear_gust()
        elif t in ('round_paused', 'plant_paused'):
            v['round_paused'] = True
        elif t in ('round_resumed', 'plant_resumed'):
            v['round_paused'] = False
        elif t == 'stone_placed':
            stones = p.get('stones')
            if stones is not None:
                v.update(cairn_stones=stones, cairn_tier=stones // 5)
        elif t == 'level_changed':
            if p.get('new_tier') is not None:
                v['cairn_tier'] = p['new_tier']
        elif t == 'hand_phase_changed':
            v['cairn_hand_phase'] = p.get('new_phase')
        elif t == 'steadiness_changed':
            v['cairn_steady'] = p.get('steady')
        elif t == 'bug_started':
            v.update(cairn_bug_active=True, cairn_bug_id=p.get('effect_id'), cairn_bug_strength=p.get('strength'),
                     cairn_bug_path=p.get('path'), cairn_bug_direction=p.get('direction'))
        elif t == 'bug_ended':
            if p.get('effect_id') in (None, v['cairn_bug_id']):
                self._clear_bug()
        elif t == 'gust_started':
            v.update(cairn_gust_active=True, cairn_gust_peak=False, cairn_gust_id=p.get('effect_id'),
                     cairn_gust_strength=p.get('strength'), cairn_gust_direction=p.get('direction'))
        elif t == 'gust_peak_reached':
            if p.get('effect_id') == v['cairn_gust_id']:
                v['cairn_gust_peak'] = True
        elif t == 'gust_easing':
            if p.get('effect_id') == v['cairn_gust_id']:
                v['cairn_gust_peak'] = False
        elif t == 'gust_ended':
            if p.get('effect_id') in (None, v['cairn_gust_id']):
                self._clear_gust()
        elif t == 'flicker_started':
            v.update(cairn_flicker_on=True, cairn_flicker_hz=p.get('hz'), cairn_flicker_id=p.get('flicker_id'))
        elif t == 'flicker_ended':
            if p.get('flicker_id') in (None, v['cairn_flicker_id']):
                self._clear_flicker()
        elif t == 'tumble_started':
            v['cairn_tumbling'] = True
        elif t == 'tumble_settled':
            v['cairn_tumbling'] = False
        elif t == 'growth_started':
            v['garden_growing'] = True
        elif t == 'growth_stopped':
            v['garden_growing'] = False


def build(reader):
    """Change points per acquisition, from the recording's events and acquisitions.

    Returns (entry, points): entry[acq] is the flag state when that acquisition
    began; points[acq] is a list of (sample, state values, [(type, event_id)])
    with non-decreasing samples, in occurrence order.
    """
    events = sorted(enumerate(reader.rows('events')), key=lambda x: (_occurred(x[1]), x[0]))
    starts = sorted((a['started_wall_s'] or 0.0, a['acquisition_id']) for a in reader.rows('acquisitions'))
    state = FlagState()
    entry, points = {}, defaultdict(list)
    k = 0
    for _, e in events:
        when = _occurred(e)
        while k < len(starts) and starts[k][0] <= when:
            entry.setdefault(starts[k][1], state.values())
            k += 1
        state.apply(e)
        acq, sample = e.get('acquisition_id'), e.get('sample_estimate')
        if acq is None or sample is None:
            continue
        pts = points[acq]
        if pts and sample < pts[-1][0]:
            sample = pts[-1][0]  # keep occurrence order where clock offsets disagree slightly
        if pts and pts[-1][0] == sample:
            pts[-1] = (sample, state.values(), pts[-1][2] + [(e['type'], e['event_id'])])
        else:
            pts.append((sample, state.values(), [(e['type'], e['event_id'])]))
    for _, acq in starts[k:]:
        entry.setdefault(acq, state.values())
    return entry, points


def rows(reader):
    """Yield eeg_flags rows (logical values), one per eeg row in stored order."""
    entry, points = build(reader)
    blank = FlagState().values()
    cursor = {}
    common = None
    for rid, pid, acq, idx, ts in reader.columns_of('eeg', ('recording_id', 'participant_id', 'acquisition_id',
                                                            'sample_index', 'source_timestamp_s')):
        common = common if common and common[0] == rid else (rid, pid)
        cur = cursor.get(acq)
        if cur is None:
            cur = cursor[acq] = [0, entry.get(acq, blank)]
        pts = points.get(acq, ())
        types, ids = [], []
        while cur[0] < len(pts) and pts[cur[0]][0] <= idx:
            _, cur[1], evs = pts[cur[0]]
            for t, i in evs:
                types.append(t)
                ids.append(i)
            cur[0] += 1
        yield common + (acq, idx, ts) + cur[1] + (';'.join(types), ';'.join(ids))


def csv_bytes(reader) -> bytes:
    types = schema.col_types(TABLE)
    frees = schema.free_flags(TABLE)
    out = [schema.header(TABLE)]
    out.extend(schema.row_line(TABLE, r, types, frees) for r in rows(reader))
    return ('\n'.join(out) + '\n').encode('utf-8')
