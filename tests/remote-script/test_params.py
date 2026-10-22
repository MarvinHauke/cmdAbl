import unittest

from fake_live import FakeSong, FakeTrack
from cmdAbl.ops import OPS, WRITES
from cmdAbl.ops.params import MAX_VALUES, param_display
from cmdAbl.protocol import OpError


def code(fn):
    with unittest.TestCase().assertRaises(OpError) as cm:
        fn()
    return cm.exception.code


class ParamDisplay(unittest.TestCase):
    def setUp(self):
        self.track = FakeTrack("Bass")
        self.song = FakeSong(tracks=[self.track], returns=[FakeTrack("Verb")])

    def test_strings_in_order_without_moving_the_fader(self):
        r = param_display(self.song, {"route": [0], "param": "volume", "values": [1.0, 0.5, 0]})
        self.assertEqual(r, {"strings": ["0.0 dB", "-6.0 dB", "-inf dB"]})
        self.assertEqual(self.track.mixer_device.volume.value, 0.85)

    def test_return_track_and_expect_name(self):
        r = param_display(self.song, {"scope": "return", "route": [0], "param": "volume", "values": [1], "expectName": "Verb"})
        self.assertEqual(r, {"strings": ["0.0 dB"]})
        self.assertEqual(code(lambda: param_display(self.song, {"route": [0], "param": "volume", "values": [1], "expectName": "Old"})), "stale")

    def test_bad_requests(self):
        base = {"route": [0], "param": "volume", "values": [0.5]}
        for change in (
            {"param": "pan"}, {"param": None}, {"values": []}, {"values": "x"}, {"values": ["a"]}, {"values": [True]},
            {"values": [float("nan")]}, {"values": [1.5]}, {"values": [-0.1]}, {"route": [0, 1]}, {"expectName": 3},
            {"values": [0.1] * (MAX_VALUES + 1)},
        ):
            args = dict(base)
            args.update(change)
            self.assertEqual(code(lambda: param_display(self.song, args)), "bad_request", change)
        self.assertEqual(code(lambda: param_display(self.song, {"route": [9], "param": "volume", "values": [0.5]})), "out_of_range")

    def test_max_values_fit_the_reply_cap(self):
        r = param_display(self.song, {"route": [0], "param": "volume", "values": [i / MAX_VALUES for i in range(MAX_VALUES)]})
        self.assertEqual(len(r["strings"]), MAX_VALUES)
        import json
        self.assertLess(len(json.dumps(r)), 1500)

    def test_str_for_value_failure_is_failed(self):
        def boom(value):
            raise RuntimeError("no")
        self.track.mixer_device.volume.str_for_value = boom
        self.assertEqual(code(lambda: param_display(self.song, {"route": [0], "param": "volume", "values": [0.5]})), "failed")

    def test_it_is_a_read_op(self):
        self.assertIn("param_display", OPS)
        self.assertNotIn("param_display", WRITES)


if __name__ == "__main__":
    unittest.main()
