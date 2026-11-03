import json
import unittest

import fake_live as fl
from fake_live import FakeDevice, FakeSong, FakeTrack
from cmdAbl import routes
from cmdAbl.cmdabl import cmdAbl
from cmdAbl.ops import OPS


class Sock(object):
    def __init__(self, datagrams):
        self.queue = list(datagrams)
        self.sent = []

    def recvfrom(self, n):
        if not self.queue:
            raise BlockingIOError()
        return self.queue.pop(0)

    def sendto(self, data, addr):
        self.sent.append((json.loads(data.decode()), addr))


class NoSocket(object):
    """Stands in for socket.socket while the surface is built: no real port is bound in tests."""

    AF_INET = SOCK_DGRAM = 0

    def socket(self, *a):
        return self

    def setblocking(self, flag):
        pass

    def bind(self, addr):
        pass

    def close(self):
        pass


def surface(song, datagrams):
    from cmdAbl import cmdabl as mod

    # No real port and, above all, no real token file: the user's own token must not be touched.
    real, mod.socket = mod.socket, NoSocket()
    real_token, mod.create_token = mod.create_token, lambda *a, **k: None
    try:
        s = cmdAbl(None)
    finally:
        mod.socket = real
        mod.create_token = real_token
    s._song = song
    s._socket = Sock(datagrams)
    return s


class Surface(unittest.TestCase):
    def test_hello_reports_exactly_the_op_list(self):
        s = surface(FakeSong(), [(b'{"v":1,"id":"a","op":"hello","args":{}}', ("127.0.0.1", 5))])
        s._drain_socket()
        reply, addr = s._socket.sent[0]
        self.assertEqual(addr, ("127.0.0.1", 5))
        self.assertEqual(reply["result"]["ops"], sorted(list(OPS) + ["hello"]))
        self.assertIn("select", reply["result"]["ops"])

    def test_select_over_the_socket_replies_with_the_read_back(self):
        t = FakeTrack("T")
        song = FakeSong(tracks=[t])
        req = b'{"v":1,"id":"s","op":"select","args":{"scope":"regular","route":[0],"expectName":"T"}}'
        s = surface(song, [(req, ("h", 1))])
        s._drain_socket()
        reply, _ = s._socket.sent[0]
        self.assertEqual(reply["result"], {"name": "T"})
        self.assertIs(song.view.selected_track, t)

    def test_old_cmd_messages_and_junk_are_dropped_and_logged(self):
        s = surface(FakeSong(), [(b'{"cmd":"select_track","index":0}', ("h", 1)), (b"\xff", ("h", 1))])
        s._drain_socket()
        self.assertEqual(s._socket.sent, [])
        self.assertEqual(len([m for m in s.logged if "dropped" in m]), 2)

    def test_a_flood_is_capped_per_tick(self):
        from cmdAbl import cmdabl as mod

        hello = (b'{"v":1,"id":"a","op":"hello","args":{}}', ("h", 1))
        s = surface(FakeSong(), [hello] * (mod.MAX_PER_TICK + 5))
        s._drain_socket()
        self.assertEqual(len(s._socket.sent), mod.MAX_PER_TICK)


class Midi(unittest.TestCase):
    TOKEN = "f" * 32

    def surface(self, datagrams=()):
        s = surface(FakeSong(), list(datagrams))
        s._token = self.TOKEN
        return s

    def listen(self, controls, token=None, **more):
        args = dict({"controls": controls, "token": token or self.TOKEN}, **more)
        return (json.dumps({"v": 1, "id": "m", "op": "midi_listen", "args": args}).encode(), ("127.0.0.1", 4242))

    def test_midi_listen_over_the_socket_needs_the_token_registers_the_peer_and_rebuilds(self):
        s = self.surface([self.listen("none", token="0" * 32), self.listen([{"type": "cc", "number": 1}])])
        s._drain_socket()
        refused, ok = [r for r, _ in s._socket.sent]
        self.assertEqual(refused["error"]["code"], "forbidden")
        self.assertEqual(ok["result"], {"count": 16, "monitor": False, "blocked": []})
        self.assertEqual(s.midi.peer, ("127.0.0.1", 4242))
        self.assertEqual(getattr(s, "rebuilds", 0), 1)

    def test_every_reply_carries_the_boot_id_and_it_differs_per_run(self):
        hello = (b'{"v":1,"id":"a","op":"hello","args":{}}', ("h", 1))
        a, b = self.surface([hello, (b'{"v":1,"id":"b","op":"nope","args":{}}', ("h", 1))]), self.surface([hello])
        a._drain_socket()
        b._drain_socket()
        replies = [r for r, _ in a._socket.sent]
        self.assertEqual(len({r["boot"] for r in replies}), 1)
        self.assertNotEqual(replies[0]["boot"], b._socket.sent[0][0]["boot"])

    def test_receive_midi_pushes_only_listened_controls_over_udp_and_keeps_the_ring_for_all(self):
        s = self.surface([self.listen([{"type": "cc", "number": 21}])])
        s._drain_socket()
        s._socket.sent.clear()
        s.receive_midi((0xB0, 21, 127))
        s.receive_midi((0xB0, 22, 1))
        events = [(r, a) for r, a in s._socket.sent]
        self.assertEqual([(e["event"], e["type"], e["number"], e["value"]) for e, _ in events], [("midi", "cc", 21, 127)])
        self.assertEqual(events[0][1], ("127.0.0.1", 4242))
        self.assertEqual(len(s.midi._buffer), 2)
        self.assertFalse(hasattr(s, "base_midi"))

    def test_a_monitor_window_pushes_every_message_marked_and_listened_ones_once(self):
        now = [10.0]
        s = self.surface([self.listen([{"type": "cc", "number": 21}], monitor=True, seconds=5)])
        s.midi._clock = lambda: now[0]
        s._drain_socket()
        s.midi._monitor_until = 15.0
        s._socket.sent.clear()
        s.receive_midi((0xB0, 21, 127))  # listened
        s.receive_midi((0xB0, 22, 1))  # not listened
        s.receive_midi((0x90, 36, 100))
        events = [r for r, _ in s._socket.sent]
        self.assertEqual([(e["number"], e.get("monitor")) for e in events], [(21, True), (22, True), (36, True)])
        now[0] = 16.0  # the window is over: back to the listened controls, unmarked
        s._socket.sent.clear()
        s.receive_midi((0xB0, 22, 2))
        s.receive_midi((0xB0, 21, 3))
        self.assertEqual([(r["number"], r.get("monitor")) for r, _ in s._socket.sent], [(21, None)])

    def test_nothing_is_pushed_by_default(self):
        s = self.surface()
        s.receive_midi((0xB0, 21, 127))
        self.assertEqual(s._socket.sent, [])

    def test_the_monitor_window_ends_in_update_display_with_a_map_rebuild(self):
        now = [50.0]
        s = self.surface([self.listen("none", monitor=True, seconds=5)])
        s.midi._clock = lambda: now[0]
        s._drain_socket()
        s.midi._monitor_until = 55.0
        before = getattr(s, "rebuilds", 0)
        s.update_display()
        self.assertEqual(getattr(s, "rebuilds", 0), before)
        now[0] = 56.0
        s.update_display()
        self.assertEqual(getattr(s, "rebuilds", 0), before + 1)

    def test_the_status_bar_shows_values_during_the_window_and_monitor_off_at_its_end(self):
        now = [10.0]
        s = self.surface([self.listen("none", monitor=True, seconds=5)])
        s.midi._clock = lambda: now[0]
        s._drain_socket()
        s.midi._monitor_until = 15.0
        s.receive_midi((0xB0, 48, 127))
        self.assertEqual(s.shown, ["cmdAbl \u00b7 CC48 ch1 = 127"])
        now[0] = 16.0
        s.update_display()
        self.assertEqual(s.shown[-1], "cmdAbl \u00b7 monitor off")
        s.update_display()
        self.assertEqual(len(s.shown), 2)
        s.receive_midi((0xB0, 48, 1))
        self.assertEqual(len(s.shown), 2)  # no window: silent

    def test_a_failing_status_bar_is_logged_and_never_raises(self):
        s = self.surface([self.listen("none", monitor=True)])
        s._drain_socket()

        def boom(text):
            raise RuntimeError("x")

        s.show_message = boom
        s.receive_midi((0xB0, 1, 1))
        self.assertTrue(any("status bar failed" in m for m in s.logged))

    def test_other_messages_stay_with_the_framework(self):
        s = self.surface()
        s.receive_midi((0xF8,))
        self.assertEqual(s.base_midi, [(0xF8,)])

    def test_build_midi_map_forwards_on_the_script_handle(self):
        import sys
        import types

        calls = []
        live = types.ModuleType("Live")
        live.MidiMap = types.SimpleNamespace(
            forward_midi_cc=lambda *a: calls.append(("cc",) + a),
            forward_midi_note=lambda *a: calls.append(("note",) + a),
            forward_midi_pitchbend=lambda *a: calls.append(("pb",) + a),
        )
        s = self.surface()
        s.midi.spec = [("cc", 0, 7)]
        s._c_instance = types.SimpleNamespace(handle=lambda: "H")
        sys.modules["Live"] = live
        try:
            s.build_midi_map("M")
        finally:
            del sys.modules["Live"]
        self.assertEqual(calls, [("cc", "H", "M", 0, 7)])
        self.assertEqual(s.base_map_calls, 1)
        self.assertTrue(any("map built: 1 controls" in m for m in s.logged))

    def test_a_refused_control_is_logged_and_pushed_once_as_midi_blocked(self):
        import sys
        import types

        deny = {"on": True}
        live = types.ModuleType("Live")
        live.MidiMap = types.SimpleNamespace(
            forward_midi_cc=lambda h, m, ch, n: not (deny["on"] and (ch, n) == (0, 51)),
            forward_midi_note=lambda *a: True,
            forward_midi_pitchbend=lambda *a: True,
        )
        s = self.surface([self.listen([{"type": "cc", "number": 51, "channel": 1}])])
        s._drain_socket()
        s._socket.sent.clear()
        s._c_instance = types.SimpleNamespace(handle=lambda: "H")
        sys.modules["Live"] = live
        try:
            s.build_midi_map("M")
            s.build_midi_map("M")  # same set: nothing new
            deny["on"] = False
            s.build_midi_map("M")
        finally:
            del sys.modules["Live"]
        events = [r for r, _ in s._socket.sent]
        self.assertEqual([(e["event"], e["blocked"]) for e in events], [("midi_blocked", ["CC51/ch1"]), ("midi_blocked", [])])
        self.assertTrue(any("blocked by Live: CC51/ch1" in m for m in s.logged))

    def test_build_midi_map_outside_live_logs_and_does_not_raise(self):
        s = self.surface()
        s._c_instance = None
        s.build_midi_map("M")
        self.assertTrue(any("map failed" in m for m in s.logged))


class Routes(unittest.TestCase):
    def test_resolve_alternates_devices_and_chains(self):
        inner = FakeDevice("Inner")
        chain = fl.FakeChain("Kick", devices=[inner])
        rack = FakeDevice("Rack", chains=[chain])
        t = FakeTrack("T", devices=[rack])
        song = FakeSong(tracks=[t])
        path = routes.resolve(song, "regular", [0, 0, 0, 0])
        self.assertEqual([p.name for p in path], ["T", "Rack", "Kick", "Inner"])

    def test_out_of_range_and_bad_shape(self):
        song = FakeSong(tracks=[FakeTrack("T", devices=[FakeDevice("D")])])
        from cmdAbl.protocol import OpError

        for route in ([5], [0, 3], [0, 0, 0]):
            with self.assertRaises(OpError) as cm:
                routes.resolve(song, "regular", route)
            self.assertEqual(cm.exception.code, "out_of_range")
        for args in ({"route": []}, {"route": ["a"]}, {"route": [True]}, {"scope": "x", "route": [0]}):
            with self.assertRaises(OpError) as cm:
                routes.parse_target(args)
            self.assertEqual(cm.exception.code, "bad_request")

    def test_scopes(self):
        r = FakeTrack("Return A")
        song = FakeSong(returns=[r])
        self.assertIs(routes.resolve(song, "return", [0])[0], r)
        self.assertIs(routes.resolve(song, "master", [0])[0], song.master_track)


if __name__ == "__main__":
    unittest.main()
