import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import fake_live  # noqa: E402,F401  (installs the _Framework stub, puts remote-script on the path)
from cmdAbl import protocol  # noqa: E402


def req(**kw):
    return json.dumps(kw).encode()


def run(data, ops=None):
    reply, problem = protocol.handle_request(data, ops or {}, ())
    return (json.loads(reply) if reply else None), problem


class Protocol(unittest.TestCase):
    def test_hello_lists_ops_and_ignores_v(self):
        r, _ = run(req(v=99, id="a", op="hello"), {"select": lambda a: {}})
        self.assertTrue(r["ok"])
        self.assertEqual(r["id"], "a")
        self.assertEqual(r["result"], {"script": protocol.VERSION, "v": 1, "ops": ["hello", "select"]})

    def test_unparseable_and_idless_are_dropped(self):
        self.assertEqual(run(b"\xff{")[0], None)
        self.assertEqual(run(req(v=1, op="hello"))[0], None)
        self.assertEqual(run(b"[1]")[0], None)

    def test_protocol_mismatch(self):
        r, _ = run(req(v=2, id="b", op="x"), {"x": lambda a: {}})
        self.assertEqual(r["error"]["code"], "protocol_mismatch")
        self.assertEqual(r["v"], 1)

    def test_unknown_op_and_bad_args(self):
        self.assertEqual(run(req(v=1, id="c", op="nope"))[0]["error"]["code"], "unknown_op")
        r, _ = run(req(v=1, id="c", op="x", args=[1]), {"x": lambda a: {}})
        self.assertEqual(r["error"]["code"], "bad_request")

    def test_handler_errors_become_replies(self):
        def boom(a):
            raise ValueError("kaputt")

        def coded(a):
            raise protocol.OpError("stale", "name differs")

        r, _ = run(req(v=1, id="d", op="boom"), {"boom": boom, "coded": coded})
        self.assertEqual(r["error"]["code"], "failed")
        r, _ = run(req(v=1, id="e", op="coded"), {"boom": boom, "coded": coded})
        self.assertEqual(r["error"], {"code": "stale", "text": "name differs"})

    def test_too_large(self):
        r, _ = run(req(v=1, id="f", op="big"), {"big": lambda a: {"x": "y" * 5000}})
        self.assertEqual(r["error"]["code"], "too_large")
        self.assertEqual(r["id"], "f")


if __name__ == "__main__":
    unittest.main()
