import unittest

from fake_live import FakeSong, FakeTrack
from cmdAbl.ops.tracks import MAX_TARGETS, track_facts
from cmdAbl.protocol import OpError


class TrackFacts(unittest.TestCase):
    def setUp(self):
        self.group = FakeTrack("Analog Rytm", foldable=True, can_be_armed=True)
        self.midi = FakeTrack("Kick", group=self.group, arm=True)
        self.nodevice = FakeTrack("Dead MIDI", can_be_armed=False)
        self.ret = FakeTrack("A Reverb", can_be_armed=False)
        self.song = FakeSong(tracks=[self.group, self.midi, self.nodevice], returns=[self.ret])

    def test_several_tracks_in_one_reply_in_order(self):
        r = track_facts(self.song, {"targets": [
            {"scope": "regular", "route": [1], "expectName": "Kick"},
            {"scope": "regular", "route": [0]},
            {"scope": "return", "route": [0]},
            {"scope": "master", "route": [0]},
        ]})
        t = r["tracks"]
        self.assertEqual(t[0], {"can_be_armed": True, "is_foldable": False, "is_grouped": True, "arm": True})
        self.assertEqual(t[1]["name"], "Analog Rytm")  # no expectName: the name comes back
        self.assertEqual(t[1]["is_foldable"], True)
        self.assertEqual(t[1]["is_grouped"], False)
        self.assertEqual(t[2]["can_be_armed"], False)
        self.assertIsNone(t[2]["arm"])  # reading arm would raise
        self.assertEqual(t[3]["name"], "Master")

    def test_matched_name_is_not_echoed(self):
        r = track_facts(self.song, {"targets": [{"route": [1], "expectName": "Kick"}]})
        self.assertNotIn("name", r["tracks"][0])

    def test_a_track_that_cannot_be_armed_reports_so(self):
        r = track_facts(self.song, {"targets": [{"route": [2], "expectName": "Dead MIDI"}]})
        self.assertEqual(r["tracks"][0]["can_be_armed"], False)
        self.assertIsNone(r["tracks"][0]["arm"])

    def test_bad_targets_are_entries_not_a_failed_request(self):
        r = track_facts(self.song, {"targets": [
            {"route": [9]}, {"route": [0], "expectName": "Old"}, {"route": [0, 0]}, "x", {"route": [1]},
        ]})
        codes = [e.get("error", {}).get("code") for e in r["tracks"]]
        self.assertEqual(codes, ["out_of_range", "stale", "bad_request", "bad_request", None])
        self.assertEqual(r["tracks"][4]["name"], "Kick")

    def test_an_unreadable_track_is_its_own_entry(self):
        class Odd(FakeTrack):
            @property
            def is_foldable(self):
                raise RuntimeError("boom")

            @is_foldable.setter
            def is_foldable(self, value):
                pass

        song = FakeSong(tracks=[Odd("Odd"), FakeTrack("Fine")])
        r = track_facts(song, {"targets": [{"route": [0]}, {"route": [1]}]})
        self.assertEqual(r["tracks"][0]["error"]["code"], "failed")
        self.assertEqual(r["tracks"][1]["name"], "Fine")

    def test_request_shape_errors(self):
        for args in ({}, {"targets": []}, {"targets": "x"}, {"targets": [{"route": [0]}] * (MAX_TARGETS + 1)}):
            with self.assertRaises(OpError) as cm:
                track_facts(self.song, args)
            self.assertEqual(cm.exception.code, "bad_request")

    def test_reply_fits_the_datagram_cap_at_max_targets(self):
        import json

        names = ["日本語のとても長いトラック名その%d" % i for i in range(MAX_TARGETS)]
        song = FakeSong(tracks=[FakeTrack(n) for n in names])
        with_names = track_facts(song, {"targets": [{"route": [i], "expectName": n} for i, n in enumerate(names)]})
        self.assertLess(len(json.dumps(with_names, separators=(",", ":"), ensure_ascii=False).encode("utf-8")), 4096)
        # without expectName the names come back; through the real encoder the cap still holds
        from cmdAbl import protocol

        reply, _ = protocol.handle_request(
            json.dumps({"v": 1, "id": "x", "op": "track_facts", "args": {"targets": [{"route": [i]} for i in range(MAX_TARGETS)]}}).encode(),
            {"track_facts": lambda a: track_facts(song, a)},
            (),
        )
        self.assertLess(len(reply), 4097)


if __name__ == "__main__":
    unittest.main()
