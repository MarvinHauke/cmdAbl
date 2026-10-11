import unittest

import fake_live as fl
from fake_live import FakeChain, FakeDevice, FakeSong, FakeTrack
from cmdAbl.ops.select import select
from cmdAbl.protocol import OpError


def code(fn):
    with unittest.TestCase().assertRaises(OpError) as cm:
        fn()
    return cm.exception.code


class Select(unittest.TestCase):
    def setUp(self):
        self.inner = FakeDevice("Inner")
        self.chain = FakeChain("Kick", devices=[self.inner])
        self.rack = FakeDevice("Rack", chains=[self.chain])
        self.group = FakeTrack("G", foldable=True)
        self.group.fold_state = 1
        self.kid = FakeTrack("Kid", devices=[self.rack], group=self.group)
        self.song = FakeSong(tracks=[self.group, self.kid], returns=[FakeTrack("A")])

    def test_track_with_read_back_and_unfold(self):
        r = select(self.song, {"scope": "regular", "route": [1], "expectName": "Kid"})
        self.assertEqual(r, {"name": "Kid"})
        self.assertIs(self.song.view.selected_track, self.kid)
        self.assertEqual(self.group.fold_state, 0)

    def test_return_track(self):
        self.assertEqual(select(self.song, {"scope": "return", "route": [0], "expectName": "A"}), {"name": "A"})

    def test_device_and_nested_device(self):
        self.assertEqual(select(self.song, {"route": [1, 0], "expectName": "Rack"}), {"name": "Rack"})
        self.assertIs(self.kid.view.selected_device, self.rack)
        self.assertEqual(select(self.song, {"route": [1, 0, 0, 0], "expectName": "Inner"}), {"name": "Inner"})
        self.assertIs(self.kid.view.selected_device, self.inner)

    def test_chain_is_selected_in_its_rack(self):
        self.assertEqual(select(self.song, {"route": [1, 0, 0], "expectName": "Kick"}), {"name": "Kick"})
        self.assertIs(self.rack.view.selected_chain, self.chain)

    def test_stale_name_changes_nothing(self):
        self.assertEqual(code(lambda: select(self.song, {"route": [1], "expectName": "Old"})), "stale")
        self.assertIsNone(self.song.view.selected_track)
        self.assertEqual(self.group.fold_state, 1)

    def test_out_of_range_and_bad_args(self):
        self.assertEqual(code(lambda: select(self.song, {"route": [9], "expectName": "x"})), "out_of_range")
        self.assertEqual(code(lambda: select(self.song, {"route": [1, 4], "expectName": "x"})), "out_of_range")
        self.assertEqual(code(lambda: select(self.song, {"route": "1"})), "bad_request")
        self.assertEqual(code(lambda: select(self.song, {"route": [0], "expectName": 3})), "bad_request")

    def test_read_back_differs_is_failed(self):
        self.song.view.refuse = True
        self.assertEqual(code(lambda: select(self.song, {"route": [1, 0], "expectName": "Rack"})), "failed")

    def test_expect_name_is_optional(self):
        self.assertEqual(select(self.song, {"route": [0]}), {"name": "G"})


if __name__ == "__main__":
    unittest.main()
