import json
import unittest

import fake_live as fl
from fake_live import FakeDevice, FakeSong, FakeTrack
from cmdAbl import legacy, routes
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

    real, mod.socket = mod.socket, NoSocket()
    try:
        s = cmdAbl(None)
    finally:
        mod.socket = real
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

    def test_legacy_select_track_still_works_and_unfolds(self):
        group = FakeTrack("G", foldable=True)
        group.fold_state = 1
        kid = FakeTrack("K", group=group)
        song = FakeSong(tracks=[group, kid])
        s = surface(song, [(json.dumps({"cmd": "select_track", "scope": "regular", "index": 1}).encode(), ("h", 1))])
        s._drain_socket()
        self.assertIs(song.view.selected_track, kid)
        self.assertEqual(group.fold_state, 0)

    def test_legacy_select_device(self):
        dev = FakeDevice("EQ")
        t = FakeTrack("T", devices=[dev])
        song = FakeSong(tracks=[t])
        legacy.select_device(song, {"scope": "regular", "trackIndex": 0, "deviceIndex": 0}, lambda m: None)
        self.assertIs(song.view.selected_track, t)
        self.assertIs(t.view.selected_device, dev)

    def test_legacy_select_device_through_the_socket(self):
        dev = FakeDevice("EQ")
        t = FakeTrack("T", devices=[dev])
        song = FakeSong(tracks=[t])
        msg = json.dumps({"cmd": "select_device", "trackIndex": 0, "deviceIndex": 0}).encode()
        surface(song, [(msg, ("h", 1))])._drain_socket()
        self.assertIs(t.view.selected_device, dev)

    def test_legacy_bad_input_is_logged_not_raised(self):
        logged = []
        legacy.handle(b"\xff", FakeSong(), logged.append)
        legacy.handle(b'{"cmd":"x"}', FakeSong(), logged.append)
        legacy.select_track(FakeSong(), {"index": 9}, logged.append)
        self.assertEqual(len(logged), 3)

    def test_a_flood_is_capped_per_tick(self):
        from cmdAbl import cmdabl as mod

        hello = (b'{"v":1,"id":"a","op":"hello","args":{}}', ("h", 1))
        s = surface(FakeSong(), [hello] * (mod.MAX_PER_TICK + 5))
        s._drain_socket()
        self.assertEqual(len(s._socket.sent), mod.MAX_PER_TICK)


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
