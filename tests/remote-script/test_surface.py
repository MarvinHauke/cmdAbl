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
    real_http, mod.HttpPusher = mod.HttpPusher, lambda token: real_http(token, start=False)  # no worker thread
    try:
        s = cmdAbl(None)
    finally:
        mod.socket = real
        mod.create_token = real_token
        mod.HttpPusher = real_http
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

    def listen(self, controls, token=None):
        args = {"controls": controls, "token": token or self.TOKEN}
        return (json.dumps({"v": 1, "id": "m", "op": "midi_listen", "args": args}).encode(), ("127.0.0.1", 4242))

    def test_midi_listen_over_the_socket_needs_the_token_registers_the_peer_and_rebuilds(self):
        s = self.surface([self.listen("none", token="0" * 32), self.listen([{"type": "cc", "number": 1}])])
        s._drain_socket()
        refused, ok = [r for r, _ in s._socket.sent]
        self.assertEqual(refused["error"]["code"], "forbidden")
        self.assertEqual(ok["result"], {"count": 16, "all": False})
        self.assertEqual(s.midi.peer, ("127.0.0.1", 4242))
        self.assertEqual(getattr(s, "rebuilds", 0), 1)

    def test_receive_midi_pushes_on_udp_now_and_udp_tick_later_and_logs_after(self):
        s = self.surface([self.listen("all")])
        s._drain_socket()
        s._socket.sent.clear()
        s.receive_midi((0xB0, 21, 127))
        events = [r for r, _ in s._socket.sent]
        self.assertEqual([(e["via"], e["type"], e["number"], e["value"]) for e in events], [("udp", "cc", 21, 127)])
        s.update_display()
        self.assertEqual([r["via"] for r, _ in s._socket.sent], ["udp", "udp_tick"])
        self.assertTrue(any("cmdAbl [midi] cc ch1 #21 = 127" in m for m in s.logged))
        self.assertFalse(hasattr(s, "base_midi"))

    def test_update_display_logs_the_http_workers_problems_on_the_main_thread(self):
        s = self.surface()
        s._http._problem("ConnectionRefusedError")
        self.assertEqual(s.logged and [m for m in s.logged if "event push (http)" in m], [])  # the worker never logs itself
        s.update_display()
        self.assertEqual([m for m in s.logged if "event push (http)" in m], ["cmdAbl [script] event push (http) failed: ConnectionRefusedError"])

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
