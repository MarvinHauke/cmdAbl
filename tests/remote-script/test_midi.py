import json
import unittest

import fake_live  # noqa: F401  (installs the _Framework stub)
from cmdAbl import midi
from cmdAbl.midi import MidiService, expand, parse_controls, parse_message, status_text
from cmdAbl.ops.midi import midi_last, midi_listen
from cmdAbl.protocol import OpError


class FakeMidiMap(object):
    def __init__(self):
        self.calls = []

    def forward_midi_cc(self, handle, map_handle, ch, n):
        self.calls.append(("cc", handle, map_handle, ch, n))

    def forward_midi_note(self, handle, map_handle, ch, n):
        self.calls.append(("note", handle, map_handle, ch, n))

    def forward_midi_pitchbend(self, handle, map_handle, ch):
        self.calls.append(("pb", handle, map_handle, ch))


class Ctx(object):
    def __init__(self):
        self.midi = MidiService(clock=lambda: 1.0)
        self.peer = ("127.0.0.1", 5000)
        self.rebuilds = 0

    def rebuild_map(self):
        self.rebuilds += 1


class Parse(unittest.TestCase):
    def test_cc_note_on_note_off_pitch_bend(self):
        self.assertEqual(parse_message((0xB1, 21, 127)), {"type": "cc", "channel": 2, "number": 21, "value": 127})
        self.assertEqual(parse_message((0x90, 60, 100)), {"type": "note_on", "channel": 1, "number": 60, "value": 100})
        self.assertEqual(parse_message((0x80, 60, 64)), {"type": "note_off", "channel": 1, "number": 60, "value": 64})
        self.assertEqual(parse_message((0xEF, 0x00, 0x40)), {"type": "pb", "channel": 16, "number": 0, "value": 8192})

    def test_note_on_with_velocity_0_is_a_note_off(self):
        self.assertEqual(parse_message((0x90, 60, 0)), {"type": "note_off", "channel": 1, "number": 60, "value": 0})

    def test_the_rest_is_none(self):
        for raw in (None, (), (0xB0,), (0xB0, 1), (0xF0, 1, 2), (0xF8,), (0xC0, 5), ("a", 1, 2), (0xB0, "x", 1)):
            self.assertIsNone(parse_message(raw), raw)


class Controls(unittest.TestCase):
    def test_all_none_and_lists(self):
        self.assertEqual(parse_controls("all"), "all")
        self.assertEqual(parse_controls("none"), "none")
        self.assertEqual(parse_controls([{"type": "cc", "channel": 2, "number": 7}, {"type": "pb"}]), [("cc", 1, 7), ("pb", None, None)])

    def test_bad_shapes(self):
        for bad in (None, "x", 5, [{}], [{"type": "sysex"}], [{"type": "cc", "channel": 0}], [{"type": "cc", "channel": True}],
                    [{"type": "cc", "number": 128}], [{"type": "cc", "number": "1"}], [{"type": "cc"}] * (midi.MAX_CONTROLS + 1)):
            with self.assertRaises(OpError) as cm:
                parse_controls(bad)
            self.assertEqual(cm.exception.code, "bad_request", bad)

    def test_expand(self):
        self.assertEqual(len(expand("all")), 16 * 128 * 2 + 16)
        self.assertEqual(expand("none"), [])
        self.assertEqual(expand([("cc", 1, 7), ("cc", 1, 7)]), [("cc", 1, 7)])
        self.assertEqual(len(expand([("note", None, None)])), 16 * 128)
        self.assertEqual(expand([("pb", 3, None)]), [("pb", 3, None)])


class Service(unittest.TestCase):
    def test_build_map_forwards_only_the_listened_controls_on_the_script_handle(self):
        svc = MidiService()
        svc.spec = parse_controls([{"type": "cc", "channel": 1, "number": 7}, {"type": "note", "channel": 2, "number": 60}, {"type": "pb", "channel": 1}])
        m = FakeMidiMap()
        self.assertEqual(svc.build_map(m, "H", "M"), 3)
        self.assertEqual(m.calls, [("cc", "H", "M", 0, 7), ("note", "H", "M", 1, 60), ("pb", "H", "M", 0)])

    def test_default_forwards_nothing(self):
        m = FakeMidiMap()
        self.assertEqual(MidiService().build_map(m, "H", "M"), 0)
        self.assertEqual(m.calls, [])

    def test_receive_stamps_seq_and_time_and_keeps_a_ring(self):
        svc = MidiService(clock=lambda: 2.5, capacity=3)
        for v in range(5):
            msg = svc.receive((0xB0, 1, v))
        self.assertEqual((msg["seq"], msg["t"]), (5, 2500.0))
        self.assertEqual([m["seq"] for m in svc._buffer], [3, 4, 5])
        self.assertIsNone(svc.receive((0xF8,)))
        self.assertEqual(svc._seq, 5)

    def test_wanted_matches_notes_of_both_kinds_cc_and_pitch_bend(self):
        svc = MidiService()
        svc.op_listen({"controls": [{"type": "note", "number": 60, "channel": 1}, {"type": "cc", "number": 7}, {"type": "pb", "channel": 2}]}, None)
        yes = [(0x90, 60, 100), (0x80, 60, 0), (0x90, 60, 0), (0xB5, 7, 3), (0xE1, 0, 64)]
        no = [(0x90, 61, 100), (0x91, 60, 100), (0xB0, 8, 3), (0xE0, 0, 64)]
        for raw in yes:
            self.assertTrue(svc.wanted(parse_message(raw)), raw)
        for raw in no:
            self.assertFalse(svc.wanted(parse_message(raw)), raw)

    def test_the_ring_sees_unlistened_messages_while_pushing_only_wanted(self):
        svc = MidiService()
        msg = svc.receive((0xB0, 1, 5))
        self.assertFalse(svc.wanted(msg))
        self.assertEqual(len(svc._buffer), 1)

    def test_monitor_forwards_everything_then_ends_by_itself(self):
        now = [100.0]
        svc = MidiService(clock=lambda: now[0])
        out = svc.op_listen({"controls": [{"type": "cc", "number": 1, "channel": 1}], "monitor": True, "seconds": 10}, None)
        self.assertEqual(out, {"count": 16 * 128 * 2 + 16, "monitor": True})
        self.assertTrue(svc.monitoring())
        self.assertEqual(svc.build_map(FakeMidiMap(), "H", "M"), 16 * 128 * 2 + 16)
        self.assertFalse(svc.tick())
        self.assertTrue(svc.wanted(parse_message((0xB0, 1, 9))) and not svc.wanted(parse_message((0xB0, 2, 9))))  # push stays the listened set
        now[0] += 10
        self.assertFalse(svc.monitoring())
        self.assertTrue(svc.tick())
        self.assertFalse(svc.tick())  # once
        self.assertEqual(svc.build_map(FakeMidiMap(), "H", "M"), 1)

    def test_a_new_listen_without_monitor_ends_the_monitor(self):
        svc = MidiService()
        svc.op_listen({"controls": "none", "monitor": True}, None)
        svc.op_listen({"controls": "none"}, None)
        self.assertFalse(svc.monitoring())


class Status(unittest.TestCase):
    def make(self, **args):
        self.now = [100.0]
        svc = MidiService(clock=lambda: self.now[0])
        svc.op_listen(dict({"controls": "none", "monitor": True, "seconds": 10}, **args), None)
        return svc

    def msg(self, svc, raw):
        return svc.receive(raw)

    def test_texts(self):
        cases = {
            (0xB0, 48, 127): "cmdAbl \u00b7 CC48 ch1 = 127",
            (0x99, 36, 100): "cmdAbl \u00b7 N36 ch10 on 100",
            (0x89, 36, 0): "cmdAbl \u00b7 N36 ch10 off",
            (0xE0, 0x00, 0x40): "cmdAbl \u00b7 PB ch1 = 8192",
        }
        for raw, text in cases.items():
            self.assertEqual(status_text(parse_message(raw)), text)

    def test_shows_while_the_window_is_open_and_throttles_to_20_a_second(self):
        svc = self.make()
        self.assertEqual(svc.status_for(self.msg(svc, (0xB0, 48, 1))), "cmdAbl \u00b7 CC48 ch1 = 1")
        self.now[0] += 0.01
        self.assertIsNone(svc.status_for(self.msg(svc, (0xB0, 48, 2))))
        self.now[0] += 0.01
        self.assertIsNone(svc.status_for(self.msg(svc, (0xB0, 48, 3))))
        self.assertIsNone(svc.status_flush())  # too early
        self.now[0] += 0.05
        self.assertEqual(svc.status_flush(), "cmdAbl \u00b7 CC48 ch1 = 3")  # the latest value
        self.assertIsNone(svc.status_flush())
        self.now[0] += 0.06
        self.assertIsNotNone(svc.status_for(self.msg(svc, (0xB0, 48, 4))))

    def test_nothing_without_a_window_or_with_status_false(self):
        svc = MidiService(clock=lambda: 1.0)
        self.assertIsNone(svc.status_for(svc.receive((0xB0, 1, 1))))
        quiet = self.make(status=False)
        self.assertIsNone(quiet.status_for(quiet.receive((0xB0, 1, 1))))
        self.now[0] += 20
        self.assertTrue(quiet.tick())
        self.assertIsNone(quiet.status_flush())

    def test_monitor_off_once_at_the_end_by_time_and_by_a_new_listen(self):
        svc = self.make()
        svc.status_for(svc.receive((0xB0, 1, 1)))
        self.now[0] += 10
        self.assertTrue(svc.tick())
        self.assertEqual(svc.status_flush(), "cmdAbl \u00b7 monitor off")
        self.assertIsNone(svc.status_flush())
        again = self.make()
        again.op_listen({"controls": "none"}, None)  # ended early
        self.assertEqual(again.status_flush(), "cmdAbl \u00b7 monitor off")
        self.assertIsNone(again.status_flush())

    def test_a_pending_value_is_dropped_when_the_window_ends(self):
        svc = self.make()
        svc.status_for(svc.receive((0xB0, 1, 1)))
        svc.status_for(svc.receive((0xB0, 1, 2)))
        self.now[0] += 10
        svc.tick()
        self.assertEqual(svc.status_flush(), "cmdAbl \u00b7 monitor off")

    def test_a_new_window_cancels_a_pending_monitor_off(self):
        svc = self.make()
        svc.status_for(svc.receive((0xB0, 1, 1)))
        svc.op_listen({"controls": "none"}, None)  # ends the window: "monitor off" is due
        svc.op_listen({"controls": "none", "monitor": True}, None)  # the next learn, before update_display
        self.assertIsNone(svc.status_flush())

    def test_status_must_be_a_bool(self):
        with self.assertRaises(OpError):
            MidiService().op_listen({"controls": "none", "status": "no"}, None)


class Ops(unittest.TestCase):
    def test_listen_sets_spec_registers_the_peer_and_rebuilds(self):
        ctx = Ctx()
        self.assertEqual(midi_listen(None, {"controls": [{"type": "cc", "number": 1}]}, ctx), {"count": 16, "monitor": False})
        self.assertEqual(ctx.midi.peer, ("127.0.0.1", 5000))
        self.assertEqual(ctx.rebuilds, 1)
        self.assertEqual(midi_listen(None, {"controls": "none"}, ctx), {"count": 0, "monitor": False})

    def test_listen_with_bad_controls_changes_nothing(self):
        ctx = Ctx()
        ctx.midi.spec = "none"
        for bad in ({"controls": [{"type": "x"}]}, {"controls": "none", "monitor": "yes"}, {"controls": "none", "monitor": True, "seconds": 0},
                    {"controls": "none", "monitor": True, "seconds": 500}, {"controls": "none", "seconds": True}):
            with self.assertRaises(OpError):
                midi_listen(None, bad, ctx)
        self.assertEqual((ctx.midi.spec, ctx.rebuilds, ctx.midi.peer), ("none", 0, None))

    def test_last_returns_rows_after_since_and_fits_the_reply(self):
        ctx = Ctx()
        for v in range(60):
            ctx.midi.receive((0xB0, 1, v))
        out = midi_last(None, {"since": 55}, ctx)
        self.assertEqual(out["last"], 60)
        self.assertEqual([r[0] for r in out["messages"]], [56, 57, 58, 59, 60])
        self.assertEqual(out["messages"][0], [56, "cc", 1, 1, 55, 1000.0])
        everything = midi_last(None, {}, ctx)
        self.assertLessEqual(len(json.dumps(everything)), 4096)
        self.assertEqual(everything["messages"][-1][0], 60)
        for bad in (-1, "1", True, 1.5):
            with self.assertRaises(OpError):
                midi_last(None, {"since": bad}, ctx)

    def test_without_a_service_the_op_fails_coded(self):
        with self.assertRaises(OpError) as cm:
            midi_last(None, {}, object())
        self.assertEqual(cm.exception.code, "failed")


if __name__ == "__main__":
    unittest.main()
