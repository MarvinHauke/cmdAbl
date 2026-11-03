import json
import unittest

import fake_live  # noqa: F401
from cmdAbl.events import Outbox, encode_event

EVENT = {"seq": 1, "type": "cc", "channel": 1, "number": 21, "value": 127, "t": 1000.0, "extra": "dropped"}


class Events(unittest.TestCase):
    def test_wire_format_has_exactly_the_contract_fields(self):
        body = json.loads(encode_event(EVENT).decode())
        self.assertEqual(body, {"v": 1, "event": "midi", "seq": 1, "type": "cc", "channel": 1, "number": 21, "value": 127, "t": 1000.0})

    def test_monitor_is_in_the_datagram_only_when_true(self):
        self.assertTrue(json.loads(encode_event(dict(EVENT, monitor=True)).decode())["monitor"])
        self.assertNotIn("monitor", json.loads(encode_event(dict(EVENT, monitor=False)).decode()))
        self.assertNotIn("monitor", json.loads(encode_event(EVENT).decode()))

    def test_push_sends_one_datagram_to_the_peer(self):
        sent, lines = [], []
        box = Outbox(lambda data, peer: sent.append((json.loads(data.decode()), peer)), lines.append)
        self.assertTrue(box.push(EVENT, ("127.0.0.1", 5000)))
        self.assertEqual([(s["seq"], p) for s, p in sent], [(1, ("127.0.0.1", 5000))])
        self.assertEqual(lines, [])

    def test_without_a_peer_nothing_is_sent(self):
        sent = []
        self.assertFalse(Outbox(lambda d, p: sent.append(d), print).push(EVENT, None))
        self.assertEqual(sent, [])

    def test_a_failing_socket_is_logged_once_per_kind_and_never_raises(self):
        lines = []

        def boom(data, peer):
            raise OSError("no")

        box = Outbox(boom, lines.append)
        for _ in range(5):
            self.assertFalse(box.push(EVENT, ("h", 1)))
        self.assertEqual(lines, ["cmdAbl [script] event push failed: OSError"])

    def test_a_failing_log_does_not_raise_either(self):
        def boom(*a):
            raise RuntimeError

        Outbox(boom, boom).push(EVENT, ("h", 1))


if __name__ == "__main__":
    unittest.main()
