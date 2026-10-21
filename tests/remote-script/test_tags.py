import json
import unittest

from fake_live import FakeSong, FakeTrack
from cmdAbl import protocol
from cmdAbl.ops import OPS, WRITES
from cmdAbl.ops.tags import BUDGET_BYTES, KEY, MAX_TAGS, parse_stored

TOKEN = "t" * 32


def song():
    return FakeSong(tracks=[FakeTrack("Bass"), FakeTrack("Lead")], returns=[FakeTrack("Verb")])


def ask(s, op, args, with_token=True):
    a = dict(args)
    if with_token:
        a["token"] = TOKEN
    data = json.dumps({"v": 1, "id": "i", "op": op, "args": a}).encode()
    ops = {n: (lambda args, fn=fn: fn(s, args)) for n, fn in OPS.items()}
    reply, _ = protocol.handle_request(data, ops, WRITES, TOKEN)
    assert len(reply) <= protocol.MAX_REPLY_BYTES
    return json.loads(reply)


def put(track, tags):
    track.data[KEY] = json.dumps(tags)


class TagsAll(unittest.TestCase):
    def test_only_tagged_tracks_with_scope_route_name_and_tags(self):
        s = song()
        put(s.tracks[1], ["fx", "drums"])
        put(s.return_tracks[0], ["send"])
        r = ask(s, "tags_all", {}, with_token=False)["result"]
        self.assertEqual(r["total"], 4)  # 2 regular + 1 return + main
        self.assertEqual(r["tracks"], [
            {"scope": "regular", "route": [1], "name": "Lead", "tags": ["fx", "drums"]},
            {"scope": "return", "route": [0], "name": "Verb", "tags": ["send"]},
        ])
        self.assertNotIn("next", r)

    def test_bad_stored_values_count_as_no_tags(self):
        s = song()
        for bad in ("not json", "{}", "[1,2]", 5, None, "[\"\", \"ok\"]"):
            s.tracks[0].data[KEY] = bad
            tags = ask(s, "tags_all", {}, with_token=False)["result"]["tracks"]
            self.assertEqual([t["tags"] for t in tags], [["ok"]] if bad == "[\"\", \"ok\"]" else [], bad)
        self.assertEqual(parse_stored(["a", "b"]), ["a", "b"])  # a native list works too

    def test_main_track_without_data_support_is_skipped(self):
        s = song()
        s.master_track.get_data = lambda k, d: (_ for _ in ()).throw(RuntimeError("no data on main"))
        put(s.tracks[0], ["a"])
        r = ask(s, "tags_all", {}, with_token=False)["result"]
        self.assertEqual([t["name"] for t in r["tracks"]], ["Bass"])

    def test_paging_under_the_byte_budget(self):
        names = ["Track %02d %s" % (i, "é" * 30) for i in range(30)]
        s = FakeSong(tracks=[FakeTrack(n) for n in names])
        for t in s.tracks:
            put(t, ["tag%d" % i + "x" * 20 for i in range(12)])
        got = []
        offset = 0
        for _ in range(40):
            r = ask(s, "tags_all", {"offset": offset}, with_token=False)["result"]
            got += [t["name"] for t in r["tracks"]]
            if "next" not in r:
                break
            self.assertGreater(r["next"], offset)
            offset = r["next"]
        self.assertEqual(got, names)
        self.assertGreater(offset, 0)  # it did page

    def test_bad_offset(self):
        for off in (-1, "x", True):
            self.assertEqual(ask(song(), "tags_all", {"offset": off}, with_token=False)["error"]["code"], "bad_request")


class TagsSet(unittest.TestCase):
    def set(self, s, tags, **kw):
        return ask(s, "tags_set", dict({"route": [0], "expectName": "Bass", "tags": tags}, **kw))

    def test_writes_a_json_list_and_toggles_the_colour_in_one_undo_step(self):
        s = song()
        s.undo_steps = []
        r = self.set(s, ["fx", "drums", "fx"])
        self.assertEqual(r["result"], {"name": "Bass", "tags": ["fx", "drums"], "marked": True})
        self.assertEqual(json.loads(s.tracks[0].data[KEY]), ["fx", "drums"])
        self.assertIsInstance(s.tracks[0].data[KEY], str)
        self.assertEqual(s.tracks[0].color_index, 5)
        self.assertEqual(s.undo_steps, ["begin", "end"])
        self.assertEqual(ask(s, "tags_all", {}, with_token=False)["result"]["tracks"][0]["tags"], ["fx", "drums"])

    def test_clearing(self):
        s = song()
        self.set(s, ["drums_2-b"])
        self.assertEqual(self.set(s, [])["result"]["tags"], [])
        self.assertEqual(ask(s, "tags_all", {}, with_token=False)["result"]["tracks"], [])

    def test_the_colour_is_restored_when_the_second_write_fails_once(self):
        t = FakeTrack("Bass")
        t.color_index = 6
        refusals = []

        class Once(type(t)):
            def __setattr__(self, k, v):
                if k == "color_index" and v == 6 and not refusals and self.__dict__.get("color_index") == 7:
                    refusals.append(1)
                    raise RuntimeError("refused once")
                object.__setattr__(self, k, v)

        t.__class__ = Once
        r = ask(FakeSong(tracks=[t]), "tags_set", {"route": [0], "expectName": "Bass", "tags": ["a"]})["result"]
        self.assertEqual(refusals, [1])
        self.assertEqual((t.color_index, r["marked"]), (6, False))

    def test_marked_false_when_the_colour_cannot_be_written(self):
        t = FakeTrack("Bass")

        class Locked(type(t)):
            def __setattr__(self, k, v):
                if k == "color_index":
                    raise RuntimeError("locked")
                object.__setattr__(self, k, v)

        t.__class__ = Locked
        r = ask(FakeSong(tracks=[t]), "tags_set", {"route": [0], "expectName": "Bass", "tags": ["a"]})["result"]
        self.assertEqual((r["marked"], r["tags"]), (False, ["a"]))

    def test_errors_change_nothing(self):
        s = song()
        too_many = ["t%d" % i for i in range(MAX_TAGS + 1)]
        for kw, code in (
            ({"expectName": "Old"}, "stale"),
            ({"route": [9]}, "out_of_range"),
            ({"route": [0, 0]}, "bad_request"),
            ({"tags": "fx"}, "bad_request"),
            ({"tags": [1]}, "bad_request"),
            ({"tags": [""]}, "bad_request"),
            ({"tags": ["x" * 41]}, "bad_request"),
            ({"tags": ["Fx"]}, "bad_request"),
            ({"tags": ["a b"]}, "bad_request"),
            ({"tags": ["drüms"]}, "bad_request"),
            ({"tags": too_many}, "bad_request"),
        ):
            args = dict({"route": [0], "expectName": "Bass", "tags": ["a"]}, **kw)
            self.assertEqual(ask(s, "tags_set", args)["error"]["code"], code, kw)
        self.assertEqual(ask(s, "tags_set", {"route": [0], "tags": ["a"]})["error"]["code"], "bad_request")  # no expectName
        self.assertEqual(s.tracks[0].data, {})
        s.tracks[0].set_data_raises = True
        self.assertEqual(self.set(s, ["a"])["error"]["code"], "unsupported")

    def test_the_write_needs_the_token_the_read_does_not(self):
        s = song()
        r = ask(s, "tags_set", {"route": [0], "expectName": "Bass", "tags": ["a"]}, with_token=False)
        self.assertEqual(r["error"]["code"], "forbidden")
        self.assertEqual(s.tracks[0].data, {})
        self.assertTrue(ask(s, "tags_all", {}, with_token=False)["ok"])
        self.assertEqual(set(WRITES), {"chain_set", "tags_set"})


if __name__ == "__main__":
    unittest.main()
