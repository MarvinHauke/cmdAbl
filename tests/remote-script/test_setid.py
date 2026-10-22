import json
import unittest

from fake_live import FakeSong, FakeTrack
from cmdAbl import protocol
from cmdAbl.ops import OPS, WRITES
from cmdAbl.ops.setid import KEY, set_id
from cmdAbl.protocol import OpError

TOKEN = "t" * 32


def song():
    s = FakeSong(tracks=[FakeTrack("Bass")], returns=[FakeTrack("Verb")])
    s.undo_steps = []
    return s


def ask(s, args, with_token=True):
    a = dict(args)
    if with_token:
        a["token"] = TOKEN
    data = json.dumps({"v": 1, "id": "i", "op": "set_id", "args": a}).encode()
    ops = {n: (lambda args, fn=fn: fn(s, args)) for n, fn in OPS.items()}
    reply, _ = protocol.handle_request(data, ops, WRITES, TOKEN)
    return json.loads(reply)


class SetId(unittest.TestCase):
    def test_read_without_an_id_is_null_and_writes_nothing(self):
        s = song()
        self.assertEqual(set_id(s, {}), {"id": None})
        self.assertEqual(set_id(s, {"create": False}), {"id": None})
        self.assertIsNone(s.data)
        self.assertEqual(s.undo_steps, [])

    def test_create_stores_a_random_hex_id_and_marks_the_set(self):
        s = song()
        r = set_id(s, {"create": True})
        self.assertRegex(r["id"], r"^[0-9a-f]{32}$")
        self.assertEqual(r["marked"], True)
        self.assertEqual(s.data[KEY], r["id"])
        self.assertEqual(s.undo_steps, ["begin", "end"])
        self.assertEqual(s.tracks[0].color_index, 5)  # the colour toggle puts it back

    def test_existing_id_is_returned_and_never_overwritten(self):
        s = song()
        first = set_id(s, {"create": True})["id"]
        s.undo_steps = []
        self.assertEqual(set_id(s, {"create": True}), {"id": first})
        self.assertEqual(set_id(s, {}), {"id": first})
        self.assertEqual(s.undo_steps, [])

    def test_a_stored_value_that_is_no_id_counts_as_none_and_is_replaced_on_create(self):
        s = song()
        s.set_data(KEY, "not an id")
        self.assertEqual(set_id(s, {}), {"id": None})
        self.assertRegex(set_id(s, {"create": True})["id"], r"^[0-9a-f]{32}$")

    def test_two_sets_get_different_ids(self):
        self.assertNotEqual(set_id(song(), {"create": True})["id"], set_id(song(), {"create": True})["id"])

    def test_failures_are_coded_not_raised(self):
        s = song()
        s.set_data = lambda key, value: (_ for _ in ()).throw(RuntimeError("no"))
        with self.assertRaises(OpError) as cm:
            set_id(s, {"create": True})
        self.assertEqual(cm.exception.code, "unsupported")
        s2 = song()
        s2.set_data = lambda key, value: None  # Live ignores the write
        with self.assertRaises(OpError) as cm:
            set_id(s2, {"create": True})
        self.assertEqual(cm.exception.code, "failed")
        with self.assertRaises(OpError) as cm:
            set_id(song(), {"create": "yes"})
        self.assertEqual(cm.exception.code, "bad_request")

    def test_a_set_without_tracks_marks_on_the_main_track_and_a_failed_mark_is_reported(self):
        s = FakeSong()
        self.assertEqual(set_id(s, {"create": True})["marked"], True)
        s2 = song()
        s2.tracks[0].color_index = 0
        type(s2.tracks[0])  # keep the track; make the toggle fail
        s2.tracks[0].__class__ = type("T", (type(s2.tracks[0]),), {"color_index": property(lambda self: 1 / 0, lambda self, v: None)})
        self.assertEqual(set_id(s2, {"create": True})["marked"], False)

    def test_it_is_a_writing_op_the_token_is_demanded_and_the_reply_is_small(self):
        s = song()
        self.assertEqual(ask(s, {"create": True}, with_token=False)["error"]["code"], "forbidden")
        self.assertIsNone(s.data)
        r = ask(s, {"create": True})
        self.assertTrue(r["ok"])
        self.assertIn("set_id", WRITES)


if __name__ == "__main__":
    unittest.main()
