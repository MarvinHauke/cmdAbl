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

    def test_nested_rack_selects_the_enclosing_chains_first_and_the_target(self):
        pad = FakeChain("Kick Rumble", devices=[FakeDevice("Sampler")])
        drum = FakeDevice("Kit", chains=[pad], drum=True)
        outer_chain = FakeChain("Strutter Kit", devices=[drum])
        outer = FakeDevice("Strutter Kit", chains=[outer_chain])
        song = FakeSong(tracks=[FakeTrack("Drums", devices=[outer])])
        # a nested pad (route length 5): the outer chain is shown, then the pad in the inner rack
        self.assertEqual(select(song, {"route": [0, 0, 0, 0, 0], "expectName": "Kick Rumble"}), {"name": "Kick Rumble"})
        self.assertIs(outer.view.selected_chain, outer_chain)
        self.assertIs(drum.view.selected_chain, pad)
        # a device inside the nested pad (route length 6)
        outer.view.selected_chain = None
        self.assertEqual(select(song, {"route": [0, 0, 0, 0, 0, 0], "expectName": "Sampler"}), {"name": "Sampler"})
        self.assertIs(outer.view.selected_chain, outer_chain)
        self.assertIs(drum.view.selected_chain, pad)
        # the rack in the first chain (route length 4)
        self.assertEqual(select(song, {"route": [0, 0, 0, 0], "expectName": "Kit"}), {"name": "Kit"})

    def test_refused_ancestor_selection_is_not_an_error_by_itself(self):
        inner = FakeDevice("Inner")
        chain = FakeChain("C", devices=[inner])
        rack = FakeDevice("R", chains=[chain])
        song = FakeSong(tracks=[FakeTrack("T", devices=[rack])])
        rack.view = None  # selecting its chain raises: ignored, the read-back decides
        self.assertEqual(select(song, {"route": [0, 0, 0, 0], "expectName": "Inner"}), {"name": "Inner"})

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

    def test_show_chains_unfolds_only_when_asked(self):
        self.assertEqual(select(self.song, {"route": [1, 0, 0], "expectName": "Kick"}), {"name": "Kick"})
        self.assertFalse(self.kid.is_showing_chains)  # default: untouched
        r = select(self.song, {"route": [1, 0, 0], "expectName": "Kick", "showChains": True})
        self.assertEqual(r, {"name": "Kick", "is_showing_chains": True})
        self.assertTrue(self.kid.is_showing_chains)

    def test_show_chains_never_folds_and_is_no_error_without_a_rack(self):
        self.kid.is_showing_chains = True
        r = select(self.song, {"route": [1], "expectName": "Kid", "showChains": True})
        self.assertEqual(r["is_showing_chains"], True)
        self.assertTrue(self.kid.is_showing_chains)
        r = select(self.song, {"route": [0], "expectName": "G", "showChains": True})  # a track without a rack
        self.assertEqual(r, {"name": "G", "is_showing_chains": None})
        self.assertFalse(self.group.is_showing_chains)

    def test_show_chains_write_that_does_not_take_and_odd_values(self):
        class Stubborn(FakeTrack):
            @property
            def is_showing_chains(self):
                return False

            @is_showing_chains.setter
            def is_showing_chains(self, value):
                pass

        t = Stubborn("T", devices=[FakeDevice("Rack", chains=[FakeChain("A")])])
        song = FakeSong(tracks=[t])
        self.assertEqual(select(song, {"route": [0], "expectName": "T", "showChains": True}), {"name": "T", "is_showing_chains": False})
        self.assertIs(song.view.selected_track, t)  # the selection stands
        self.assertEqual(code(lambda: select(self.song, {"route": [1], "showChains": "yes"})), "bad_request")
        self.assertIsNone(self.song.view.selected_track)  # validated before anything changed

    def test_expect_name_is_optional(self):
        self.assertEqual(select(self.song, {"route": [0]}), {"name": "G"})


if __name__ == "__main__":
    unittest.main()
