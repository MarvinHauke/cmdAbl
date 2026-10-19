import json
import unittest

from fake_live import FakeSong, FakeTrack
from cmdAbl import protocol
from cmdAbl.ops import OPS, WRITES
from cmdAbl.ops.tags import KEY, MAX_VALUE_BYTES

TOKEN = "t" * 32


def song():
    return FakeSong(tracks=[FakeTrack("Bass"), FakeTrack("Lead")])


def ask(s, op, args, with_token=True):
    a = dict(args)
    if with_token:
        a["token"] = TOKEN
    data = json.dumps({"v": 1, "id": "i", "op": op, "args": a}).encode()
    ops = {n: (lambda args, fn=fn: fn(s, args)) for n, fn in OPS.items()}
    reply, _ = protocol.handle_request(data, ops, WRITES, TOKEN)
    return json.loads(reply)


class TrackTags(unittest.TestCase):
    def test_get_on_an_untagged_track(self):
        r = ask(song(), "track_tags", {"route": [0]})
        self.assertEqual(r["result"], {"name": "Bass", "present": False})

    def test_set_then_get_a_json_string(self):
        s = song()
        w = ask(s, "track_tags_set", {"route": [1], "expectName": "Lead", "value": '["a","b"]'})
        self.assertEqual(w["result"], {"name": "Lead", "stored": True, "same": True, "type": "str", "length": 9})
        self.assertEqual(s.tracks[1].data[KEY], '["a","b"]')
        self.assertNotIn(KEY, s.tracks[0].data)
        r = ask(s, "track_tags", {"route": [1]})["result"]
        self.assertEqual(r, {"name": "Lead", "present": True, "type": "str", "length": 9, "value": '["a","b"]'})

    def test_fill_stores_a_long_string_and_get_reports_length_without_value(self):
        s = song()
        w = ask(s, "track_tags_set", {"route": [0], "expectName": "Bass", "fill": 10000})["result"]
        self.assertEqual((w["length"], w["same"]), (10000, True))
        r = ask(s, "track_tags", {"route": [0]})["result"]
        self.assertEqual(r["length"], 10000)
        self.assertNotIn("value", r)  # over the reply budget
        self.assertLess(MAX_VALUE_BYTES, 4096)

    def test_non_ascii_value_and_a_lone_surrogate(self):
        s = song()
        ask(s, "track_tags_set", {"route": [0], "expectName": "Bass", "value": "Drüms 🥁"})
        self.assertEqual(ask(s, "track_tags", {"route": [0]})["result"]["value"], "Drüms 🥁")
        s.tracks[0].data[KEY] = "\ud800"
        r = ask(s, "track_tags", {"route": [0]})["result"]
        self.assertEqual((r["present"], "value" in r), (True, False))

    def test_wrap_as_list_dict_and_clear(self):
        s = song()
        ask(s, "track_tags_set", {"route": [0], "expectName": "Bass", "value": "x", "as": "list"})
        self.assertEqual(s.tracks[0].data[KEY], ["x"])
        ask(s, "track_tags_set", {"route": [0], "expectName": "Bass", "value": "x", "as": "dict"})
        self.assertEqual(s.tracks[0].data[KEY], {"v": "x"})
        w = ask(s, "track_tags_set", {"route": [0], "expectName": "Bass", "clear": True})["result"]
        self.assertEqual(w["type"], "NoneType")

    def test_undo_step_only_when_asked(self):
        s = song()
        s.undo_steps = []
        ask(s, "track_tags_set", {"route": [0], "expectName": "Bass", "value": "a"})
        self.assertEqual(s.undo_steps, [])
        ask(s, "track_tags_set", {"route": [0], "expectName": "Bass", "value": "a", "undo": True})
        self.assertEqual(s.undo_steps, ["begin", "end"])

    def test_errors(self):
        s = song()
        for args, code in (
            ({"route": [0], "value": "a"}, "bad_request"),  # no expectName
            ({"route": [0], "expectName": "Old", "value": "a"}, "stale"),
            ({"route": [9], "expectName": "x", "value": "a"}, "out_of_range"),
            ({"route": [0, 0], "expectName": "Bass", "value": "a"}, "bad_request"),
            ({"route": [0], "expectName": "Bass"}, "bad_request"),
            ({"route": [0], "expectName": "Bass", "fill": -1}, "bad_request"),
            ({"route": [0], "expectName": "Bass", "value": "a", "as": "set"}, "bad_request"),
        ):
            self.assertEqual(ask(s, "track_tags_set", args)["error"]["code"], code, args)
        self.assertEqual(s.tracks[0].data, {})
        s.tracks[0].set_data_raises = True
        r = ask(s, "track_tags_set", {"route": [0], "expectName": "Bass", "value": "a"})
        self.assertEqual(r["error"]["code"], "unsupported")

    def test_the_write_needs_the_token_the_read_does_not(self):
        s = song()
        r = ask(s, "track_tags_set", {"route": [0], "expectName": "Bass", "value": "a"}, with_token=False)
        self.assertEqual(r["error"]["code"], "forbidden")
        self.assertEqual(s.tracks[0].data, {})
        self.assertTrue(ask(s, "track_tags", {"route": [0]}, with_token=False)["ok"])


if __name__ == "__main__":
    unittest.main()
