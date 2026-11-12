import json
import unittest

from fake_live import FakeSong, FakeTrack
from cmdAbl import protocol
from cmdAbl.ops import OPS, WRITES
from cmdAbl.ops.transport import jump, loop_set, transport
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
            "barStart": 44.0, "barLen": 4.0, "sigNum": 4, "sigDen": 4, "songLength": 0.0, "loop": {"on": True, "start": 8.0, "length": 16.0},
        })

    def test_bar_grid_follows_the_signature(self):
        s = song()
        s.signature_numerator, s.signature_denominator = 6, 8
        s.current_song_time = 7.0
        r = transport(s, {})
        self.assertEqual((r["barLen"], r["barStart"]), (3.0, 6.0))
        self.assertEqual((r["sigNum"], r["sigDen"]), (6, 8))

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

    def test_deferred_loop_on_is_trusted(self):
        class Deferred(FakeSong):
            """song.loop applies on the next tick: a read right after the write still shows the old value."""
            @property
            def loop(self):
                return self.__dict__.get("_shown", False)

            @loop.setter
            def loop(self, v):
                self.__dict__["_pending"] = v
        s = Deferred()
        s.loop_start, s.loop_length = 0.0, 16.0
        r = loop_set(s, {"on": True, "start": 0, "length": 16})
        self.assertEqual(r, {"loop": {"on": True, "start": 0.0, "length": 16.0}})
        self.assertEqual((s.loop_start, s.loop_length), (0.0, 16.0))
        self.assertTrue(s.__dict__["_pending"])

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

    def test_start_beyond_the_song_length_is_retried_length_first(self):
        class Strict(FakeSong):
            """Refuses loop_start beyond the song length, which includes the loop's end."""
            @property
            def song_length(self):
                return max(32.0, self.loop_start + self.loop_length)

            def __setattr__(self, k, v):
                if k == "loop_start" and v > self.song_length:
                    raise RuntimeError("Cannot set the Loopstart behind the Songlength")
                object.__setattr__(self, k, v)
        s = Strict()
        object.__setattr__(s, "loop_start", 0.0)
        object.__setattr__(s, "loop_length", 4.0)
        r = loop_set(s, {"on": True, "start": 40, "length": 8})
        self.assertEqual(r["loop"]["start"], 40.0)
        self.assertEqual(transport(s, {})["songLength"], 48.0)

    def test_failed_restore_is_named_in_the_error(self):
        class Locked(FakeSong):
            def __setattr__(self, k, v):
                if k in ("loop_start", "loop_length") and getattr(self, "locked", False):
                    if not getattr(self, "first", False):
                        self.first = True  # the first write lands, every later one is refused
                        object.__setattr__(self, k, v)
                        return
                    raise RuntimeError("Cannot set the Loopstart behind the Songlength")
                object.__setattr__(self, k, v)
        s = Locked()
        s.loop_start, s.loop_length = 2.0, 4.0
        s.locked = True
        with self.assertRaises(OpError) as cm:
            loop_set(s, {"on": True, "start": 50, "length": 8})
        self.assertIn("the old loop could not be put back", cm.exception.text)

    def test_pos_is_built_from_the_fields(self):
        class BT(object):
            bars, beats, sub_division, ticks = 12, 3, 1, 1
        s = song()
        s.beats_song_time = BT()
        self.assertEqual(transport(s, {})["pos"], "12.3.1.1")


class Jump(unittest.TestCase):
    def test_moves_the_playhead_and_reads_back(self):
        s = song()
        s.is_playing = True
        self.assertEqual(jump(s, {"time": 12}), {"time": 12.0})
        self.assertEqual(s.current_song_time, 12.0)
        self.assertTrue(s.is_playing)

    def test_needs_the_token(self):
        s = song()
        r = ask(s, "jump", {"time": 4}, with_token=False)
        self.assertFalse(r["ok"])
        self.assertEqual(s.current_song_time, 0.0)
        self.assertTrue(ask(s, "jump", {"time": 4})["ok"])

    def test_validates_input(self):
        s = song()
        for bad in ({}, {"time": -1}, {"time": "4"}, {"time": True}, {"time": float("nan")}, {"time": float("inf")}):
            with self.assertRaises(OpError, msg=str(bad)):
                jump(s, bad)

    def test_live_refusing_is_failed_with_its_reason(self):
        class Refuses(FakeSong):
            def __setattr__(self, k, v):
                if k == "current_song_time":
                    raise RuntimeError("beyond the end")
                object.__setattr__(self, k, v)
        with self.assertRaises(OpError) as cm:
            jump(Refuses(), {"time": 9999})
        self.assertEqual(cm.exception.code, "failed")
        self.assertIn("beyond the end", cm.exception.text)

    def test_a_lagging_read_back_is_not_an_error(self):
        class Deferred(FakeSong):
            @property
            def current_song_time(self):
                return 1.0

            @current_song_time.setter
            def current_song_time(self, v):
                pass
        r = jump(Deferred(), {"time": 8})
        self.assertEqual(r["time"], 1.0)
        self.assertIn("note", r)
        self.assertNotIn("note", jump(song(), {"time": 8}))

    def test_playing_playhead_may_have_moved_on(self):
        class Moves(FakeSong):
            @property
            def current_song_time(self):
                return self.__dict__.get("_t", 0.0) + 0.2

            @current_song_time.setter
            def current_song_time(self, v):
                self.__dict__["_t"] = v
        s = Moves()
        s.is_playing = True
        self.assertAlmostEqual(jump(s, {"time": 8})["time"], 8.2)


if __name__ == "__main__":
    unittest.main()
