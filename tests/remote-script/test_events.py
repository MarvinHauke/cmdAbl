import json
import unittest

import fake_live  # noqa: F401
from cmdAbl import events
from cmdAbl.events import HttpPusher, Outbox, encode_event

EVENT = {"seq": 1, "type": "cc", "channel": 1, "number": 21, "value": 127, "t": 1000.0}


class Clock(object):
    def __init__(self, now=10.0):
        self.now = now

    def __call__(self):
        return self.now


class FakeResponse(object):
    def __init__(self, status):
        self.status = status

    def read(self):
        return b""


class FakeConn(object):
    log = []
    status = 200
    boom = None

    def __init__(self, host, port, timeout):
        FakeConn.log.append(("open", host, port, timeout))

    def request(self, method, path, body, headers):
        if FakeConn.boom:
            raise FakeConn.boom
        FakeConn.log.append((method, path, json.loads(body.decode()), headers))

    def getresponse(self):
        return FakeResponse(FakeConn.status)

    def close(self):
        FakeConn.log.append(("close",))


class DrainingPusher(HttpPusher):
    """`lines` is what the main thread would log: only drain_problems feeds it."""

    @property
    def lines(self):
        return self.drain_problems()


def pusher(token="a" * 32, clock=None):
    FakeConn.log, FakeConn.status, FakeConn.boom = [], 200, None
    p = DrainingPusher(lambda: token, None, clock or Clock(), FakeConn, start=False)
    return p, p


class Encode(unittest.TestCase):
    def test_wire_format(self):
        body = json.loads(encode_event(EVENT, "udp", Clock(2.0)).decode())
        self.assertEqual(body, dict(EVENT, v=1, event="midi", via="udp", sent=2000.0))


class OutboxTests(unittest.TestCase):
    def make(self, channels=events.CHANNELS):
        self.sent, self.posted, self.lines = [], [], []

        class Http(object):
            def post(s, event):
                self.posted.append(event)

        return Outbox(lambda data, peer: self.sent.append((json.loads(data.decode()), peer)), Http(), self.lines.append, Clock(3.0), channels)

    def test_udp_goes_now_udp_tick_waits_http_is_queued(self):
        box = self.make()
        box.push(EVENT, ("h", 1))
        self.assertEqual([(s["via"], p) for s, p in self.sent], [("udp", ("h", 1))])
        self.assertEqual(self.posted, [EVENT])
        box.flush_tick(("h", 1))
        self.assertEqual([s["via"] for s, _ in self.sent], ["udp", "udp_tick"])
        box.flush_tick(("h", 1))
        self.assertEqual(len(self.sent), 2)  # nothing held any more

    def test_without_a_peer_no_datagram_leaves_but_http_still_does(self):
        box = self.make()
        box.push(EVENT, None)
        box.flush_tick(None)
        self.assertEqual(self.sent, [])
        self.assertEqual(len(self.posted), 1)

    def test_a_failing_socket_is_logged_once_and_never_raises(self):
        lines = []

        def boom(data, peer):
            raise OSError("no")

        box = Outbox(boom, None, lines.append, Clock(), ("udp",))
        for _ in range(5):
            box.push(EVENT, ("h", 1))
        self.assertEqual(lines, ["cmdAbl [script] event push failed: udp: OSError"])

    def test_held_events_are_capped(self):
        box = self.make(("udp_tick",))
        for _ in range(events.TICK_QUEUE_MAX + 50):
            box.push(EVENT, ("h", 1))
        box.flush_tick(("h", 1))
        self.assertEqual(len(self.sent), events.TICK_QUEUE_MAX)


class Http(unittest.TestCase):
    def test_post_goes_to_the_trigger_server_with_the_bearer_token(self):
        p, lines = pusher()
        self.assertTrue(p._send(EVENT))
        _, method_row, _ = FakeConn.log[0], FakeConn.log[1], FakeConn.log[2]
        method, path, body, headers = method_row
        self.assertEqual((method, path, body["via"], body["seq"]), ("POST", "/midi-event", "http", 1))
        self.assertEqual(headers["Authorization"], "Bearer " + "a" * 32)
        self.assertEqual(FakeConn.log[0], ("open", "127.0.0.1", 27184, 0.5))
        self.assertEqual(lines.lines, [])

    def test_a_refused_connection_mutes_the_channel_and_logs_once_without_the_token(self):
        clock = Clock()
        p, lines = pusher(clock=clock)
        FakeConn.boom = ConnectionRefusedError("x")
        self.assertFalse(p._send(EVENT))
        self.assertFalse(p._send(EVENT))  # muted: no new attempt
        self.assertEqual(len([r for r in FakeConn.log if r[0] == "open"]), 1)
        clock.now += events.HTTP_BACKOFF_S + 1
        self.assertFalse(p._send(EVENT))
        got = lines.lines
        self.assertEqual(got, ["cmdAbl [script] event push (http) failed: ConnectionRefusedError"])
        self.assertNotIn("a" * 32, " ".join(got))
        self.assertEqual(lines.lines, [])  # drained

    def test_no_token_and_bad_status(self):
        p, lines = pusher(token=None)
        self.assertFalse(p._send(EVENT))
        self.assertEqual(lines.lines, ["cmdAbl [script] event push (http) failed: no access token"])
        p, lines = pusher()
        FakeConn.status = 403
        self.assertFalse(p._send(EVENT))
        self.assertEqual(lines.lines, ["cmdAbl [script] event push (http) failed: status 403"])

    def test_a_full_queue_drops_and_never_blocks(self):
        p, lines = pusher()
        for _ in range(events.HTTP_QUEUE_MAX + 5):
            p.post(EVENT)
        self.assertEqual(lines.lines, ["cmdAbl [script] event push (http) failed: queue full"])

    def test_the_worker_thread_sends_and_stops_on_close(self):
        FakeConn.log, FakeConn.status, FakeConn.boom = [], 200, None
        p = HttpPusher(lambda: "t" * 32, None, Clock(), FakeConn, start=True)
        p.post(EVENT)
        p.close()
        p._thread.join(2)
        self.assertFalse(p._thread.is_alive())
        self.assertTrue(any(r[0] == "POST" for r in FakeConn.log))


if __name__ == "__main__":
    unittest.main()
