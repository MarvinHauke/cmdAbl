import json
import unittest

from fake_live import FakeChain, FakeDevice, FakeSong, FakeTrack
from cmdAbl.ops.chains import MAX_TARGETS, chains
from cmdAbl.protocol import OpError


def drum_rack(names):
    return FakeDevice("Drum Rack", chains=[FakeChain(n, devices=[FakeDevice("External Instrument")], in_note=36 + i) for i, n in enumerate(names)], drum=True)


class Chains(unittest.TestCase):
    def test_real_chain_names_not_the_first_device(self):
        rack = drum_rack(["Kick", "Snare", "Hat"])
        song = FakeSong(tracks=[FakeTrack("Vermona MIDI", devices=[rack])])
        r = chains(song, {"targets": [{"scope": "regular", "route": [0, 0]}]})
        e = r["racks"][0]
        self.assertEqual(e["kind"], "drum")
        self.assertEqual(e["total"], 3)
        self.assertEqual([c["name"] for c in e["chains"]], ["Kick", "Snare", "Hat"])
        self.assertEqual(e["chains"][0]["note"], 36)
        self.assertNotIn("next", e)

    def test_instrument_rack_chains_are_answered(self):
        # Regression: reading has_drum_pads raised on an Instrument Rack and the whole rack was skipped.
        rack = FakeDevice("Instrument Rack", chains=[FakeChain("Organ Softer"), FakeChain("Test chain")])
        song = FakeSong(tracks=[FakeTrack("E-Piano", devices=[rack])])
        r = chains(song, {"targets": [{"route": [0, 0]}]})
        e = r["racks"][0]
        self.assertNotIn("error", e)
        self.assertEqual(e["kind"], "rack")
        self.assertEqual([c["name"] for c in e["chains"]], ["Organ Softer", "Test chain"])

    def test_plain_rack_has_no_notes_and_nested_racks_resolve(self):
        inner = FakeDevice("Inner Rack", chains=[FakeChain("A"), FakeChain("B")])
        outer = FakeDevice("Outer", chains=[FakeChain("Layer", devices=[inner])])
        song = FakeSong(tracks=[FakeTrack("T", devices=[outer])])
        r = chains(song, {"targets": [{"route": [0, 0]}, {"route": [0, 0, 0, 0]}]})
        self.assertEqual(r["racks"][0]["kind"], "rack")
        self.assertEqual([c["name"] for c in r["racks"][1]["chains"]], ["A", "B"])
        self.assertNotIn("note", r["racks"][1]["chains"][0])

    def test_errors_are_entries(self):
        song = FakeSong(tracks=[FakeTrack("T", devices=[FakeDevice("EQ")])])
        r = chains(song, {"targets": [{"route": [0, 0]}, {"route": [0]}, {"route": [0, 5]}, {"route": [0, 0], "offset": -1}]})
        self.assertEqual([e["error"]["code"] for e in r["racks"]], ["unsupported", "bad_request", "out_of_range", "bad_request"])

    def test_request_shape_errors(self):
        for args in ({}, {"targets": []}, {"targets": [{"route": [0, 0]}] * (MAX_TARGETS + 1)}):
            with self.assertRaises(OpError):
                chains(FakeSong(), args)

    def test_long_names_page_under_the_cap_and_all_chains_are_reachable(self):
        names = ["日本語のとても長いパッド名その%03d" % i for i in range(128)]
        rack = drum_rack(names)
        song = FakeSong(tracks=[FakeTrack("T", devices=[rack])])
        got, offset, requests = [], 0, 0
        while True:
            r = chains(song, {"targets": [{"route": [0, 0], "offset": offset}]})
            requests += 1
            self.assertLess(len(json.dumps(r, separators=(",", ":"), ensure_ascii=False).encode("utf-8")), 4096 - 200)
            e = r["racks"][0]
            got += [c["name"] for c in e["chains"]]
            if "next" not in e:
                break
            offset = e["next"]
        self.assertEqual(got, names)
        self.assertGreater(requests, 1)

    def test_normal_drum_rack_is_one_request(self):
        rack = drum_rack(["Kick %d" % i for i in range(32)])
        song = FakeSong(tracks=[FakeTrack("T", devices=[rack])])
        r = chains(song, {"targets": [{"route": [0, 0]}]})
        self.assertNotIn("next", r["racks"][0])

    def test_several_racks_share_the_budget_in_one_reply(self):
        song = FakeSong(tracks=[FakeTrack("T%d" % i, devices=[drum_rack(["Pad %d" % k for k in range(16)])]) for i in range(5)])
        r = chains(song, {"targets": [{"route": [i, 0]} for i in range(5)]})
        self.assertEqual([len(e["chains"]) for e in r["racks"]], [16] * 5)
        self.assertLess(len(json.dumps(r)), 4096)


class ThroughTheProtocol(unittest.TestCase):
    """The real encoder and cap: a Set of ordinary racks must never answer too_large."""

    def _ask(self, song, routes, offsets=None):
        from cmdAbl import protocol

        targets = [{"route": r, "offset": (offsets or {}).get(i, 0)} for i, r in enumerate(routes)]
        data = json.dumps({"v": 1, "id": "x", "op": "chains", "args": {"targets": targets}}).encode()
        reply, _ = protocol.handle_request(data, {"chains": lambda a: chains(song, a)}, ())
        self.assertLessEqual(len(reply), 4096)
        return json.loads(reply)

    def _drain(self, song, routes):
        """What the extension does: ask again for every rack that has `next`."""
        names = {i: [] for i in range(len(routes))}
        pending = {i: 0 for i in range(len(routes))}
        requests = 0
        while pending:
            requests += 1
            self.assertLess(requests, 64)
            idx = list(pending)
            r = self._ask(song, [routes[i] for i in idx], {k: pending[i] for k, i in enumerate(idx)})
            self.assertTrue(r["ok"], r)
            for k, i in enumerate(idx):
                e = r["result"]["racks"][k]
                names[i] += [c["name"] for c in e.get("chains", [])]
                if "next" in e:
                    pending[i] = e["next"]
                else:
                    del pending[i]
        return names, requests

    def _song(self, racks, per_rack, name_len):
        tracks = [FakeTrack("T%d" % i, devices=[drum_rack(["P%d_%d_" % (i, k) + "x" * name_len for k in range(per_rack)])]) for i in range(racks)]
        return FakeSong(tracks=tracks), [[i, 0] for i in range(racks)]

    def test_twelve_and_twenty_racks_of_sixteen_chains_are_not_too_large(self):
        for racks in (12, 20):
            song, routes = self._song(racks, 16, 22)
            r = self._ask(song, routes)
            self.assertTrue(r["ok"], r)
            names, requests = self._drain(song, routes)
            for i in range(racks):
                self.assertEqual(len(names[i]), 16)

    def test_other_shapes(self):
        for racks, per, length in ((20, 128, 12), (4, 128, 200), (1, 128, 150), (20, 4, 150)):
            song, routes = self._song(racks, per, length)
            names, _ = self._drain(song, routes)
            self.assertEqual([len(names[i]) for i in range(racks)], [per] * racks)

    def test_errors_and_racks_mixed(self):
        song, routes = self._song(3, 16, 22)
        r = self._ask(song, routes + [[0], [9, 0]])
        self.assertTrue(r["ok"], r)
        self.assertEqual(len(r["result"]["racks"]), 5)


if __name__ == "__main__":
    unittest.main()
