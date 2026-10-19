import json
import unittest

from fake_live import FakeSong, FakeTrack
from cmdAbl import protocol
from cmdAbl.ops import OPS, WRITES
from cmdAbl.ops.tags import CANDIDATES, DIRTY_KEY, KEY, MAX_VALUE_BYTES

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


class MarkModified(unittest.TestCase):
    def run_candidate(self, s, candidate, **extra):
        return ask(s, "mark_modified", dict({"route": [0], "expectName": "Bass", "candidate": candidate}, **extra))

    def test_every_candidate_leaves_the_track_as_it_was(self):
        for c in CANDIDATES:
            s = song()
            r = self.run_candidate(s, c)
            self.assertTrue(r["ok"], (c, r))
            t = s.tracks[0]
            self.assertEqual((t.name, t.color_index), ("Bass", 5), c)
            self.assertEqual(r["result"]["candidate"], c)
            self.assertEqual(r["result"]["can_undo_before"], False)

    def test_toggles_run_inside_one_undo_step_the_others_do_not_write(self):
        s = song()
        s.undo_steps = []
        self.run_candidate(s, "toggle_name")
        self.assertEqual(s.undo_steps, ["begin", "end"])
        s.undo_steps = []
        self.run_candidate(s, "same_name")
        self.assertEqual(s.undo_steps, [])
        self.run_candidate(s, "song_data")
        self.run_candidate(s, "song_data")
        self.assertEqual(s.data[DIRTY_KEY], 2)

    def test_toggle_name_says_when_live_trims_the_space(self):
        s = song()
        self.assertEqual(self.run_candidate(s, "toggle_name")["result"]["touched"], "name changed and restored")

        class Trimming(type(s.tracks[0])):
            @property
            def name(self):
                return self.__dict__.get("_n", "").rstrip()

            @name.setter
            def name(self, v):
                self.__dict__["_n"] = v

        t = Trimming("Bass")
        s2 = FakeSong(tracks=[t])
        r = ask(s2, "mark_modified", {"route": [0], "expectName": "Bass", "candidate": "toggle_name"})["result"]
        self.assertIn("unchanged by Live", r["touched"])

    def test_can_undo_after_is_read(self):
        s = song()
        s.can_undo = True
        self.assertEqual(self.run_candidate(s, "empty_undo")["result"]["can_undo_after"], True)

    def test_bad_requests_token_and_nothing_left_changed(self):
        s = song()
        t = s.tracks[0]
        r = self.run_candidate(s, "song_data")
        self.assertTrue(r["ok"])
        for args, code in (
            ({"candidate": "nope"}, "bad_request"),
            ({"candidate": "same_name", "expectName": "Old"}, "stale"),
        ):
            a = dict({"route": [0], "expectName": "Bass"}, **args)
            self.assertEqual(ask(s, "mark_modified", a)["error"]["code"], code)
        self.assertEqual(ask(s, "mark_modified", {"route": [0], "candidate": "same_name"}, with_token=True)["error"]["code"], "bad_request")  # no expectName
        self.assertEqual(ask(s, "mark_modified", {"route": [0], "expectName": "Bass", "candidate": "same_name"}, with_token=False)["error"]["code"], "forbidden")
        self.assertEqual(t.color_index, 5)


if __name__ == "__main__":
    unittest.main()
