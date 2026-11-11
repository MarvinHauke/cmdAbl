import json
import unittest

from fake_live import FakeSong, FakeTrack
from cmdAbl import protocol
from cmdAbl.ops import OPS, WRITES
from cmdAbl.ops.transport import loop_set, transport
from cmdAbl.protocol import OpError

TOKEN = "t" * 32


def ask(s, op, args, with_token=True):
    a = dict(args)
    if with_token:
        a["token"] = TOKEN
    data = json.dumps({"v": 1, "id": "i", "op": op, "args": a}).encode()
    ops = {n: (lambda args, fn=fn: fn(s, args)) for n, fn in OPS.items()}
    reply, _ = protocol.handle_request(data, ops, WRITES, TOKEN)
    return json.loads(reply)


def song():
    return FakeSong(tracks=[FakeTrack("A"), FakeTrack("B")])


class Transport(unittest.TestCase):
    def test_reads_everything_without_a_token(self):
        s = song()
        s.current_song_time = 46.5
        s.beats_song_time = "12.3.1.1"
        s.is_playing = True
        s.loop, s.loop_start, s.loop_length = True, 8.0, 16.0
        r = ask(s, "transport", {}, with_token=False)
        self.assertTrue(r["ok"])
        self.assertEqual(r["result"], {
            "playing": True, "session": False, "pos": "12.3.1.1", "time": 46.5,
            "barStart": 44.0, "barLen": 4.0, "loop": {"on": True, "start": 8.0, "length": 16.0},
        })

    def test_bar_grid_follows_the_signature(self):
        s = song()
        s.signature_numerator, s.signature_denominator = 6, 8
        s.current_song_time = 7.0
        r = transport(s, {})
        self.assertEqual((r["barLen"], r["barStart"]), (3.0, 6.0))

    def test_session_is_true_when_any_track_plays_a_slot(self):
        s = song()
        s.tracks[1].playing_slot_index = 0
        self.assertTrue(transport(s, {})["session"])

    def test_session_ignores_tracks_without_clip_slots(self):
        s = song()
        s.tracks[0].playing_slot_index = -1
        class NoSlots(object):
            name = "Group"

            @property
            def playing_slot_index(self):
                raise RuntimeError("no slots")
        s.tracks.append(NoSlots())
        self.assertFalse(transport(s, {})["session"])


class LoopSet(unittest.TestCase):
    def test_sets_and_reads_back(self):
        s = song()
        r = loop_set(s, {"on": True, "start": 4, "length": 8})
        self.assertEqual(r, {"loop": {"on": True, "start": 4.0, "length": 8.0}})
        self.assertTrue(s.loop)

    def test_needs_the_token(self):
        s = song()
        r = ask(s, "loop_set", {"on": True, "start": 0, "length": 4}, with_token=False)
        self.assertFalse(r["ok"])
        self.assertFalse(s.loop)

    def test_validates_input(self):
        s = song()
        for bad in ({"on": 1, "start": 0, "length": 4}, {"on": True, "start": -1, "length": 4},
                    {"on": True, "start": 0, "length": 0}, {"on": True, "start": "0", "length": 4},
                    {"on": True, "start": 0}, {"on": True, "start": True, "length": 4},
                    {"on": True, "start": float("nan"), "length": 4}):
            with self.assertRaises(OpError, msg=str(bad)):
                loop_set(s, bad)
        self.assertFalse(s.loop)

    def test_fails_when_live_does_not_keep_it(self):
        class Stubborn(FakeSong):
            @property
            def loop_length(self):
                return 1.0

            @loop_length.setter
            def loop_length(self, v):
                pass
        s = Stubborn()
        s.loop_start, s.loop = 2.0, False
        with self.assertRaises(OpError):
            loop_set(s, {"on": True, "start": 8, "length": 4})
        self.assertEqual((s.loop_start, s.loop), (2.0, False))

    def test_pos_is_built_from_the_fields(self):
        class BT(object):
            bars, beats, sub_division, ticks = 12, 3, 1, 1
        s = song()
        s.beats_song_time = BT()
        self.assertEqual(transport(s, {})["pos"], "12.3.1.1")


if __name__ == "__main__":
    unittest.main()
