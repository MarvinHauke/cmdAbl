"""cmdAbl bridge protocol — the pure part (no Live imports, unit-tested).

Request:  {"v": 1, "id": "<string>", "op": "<name>", "args": {...}}
Reply:    {"v": 1, "id": "<same>", "ok": true,  "result": {...}}
          {"v": 1, "id": "<same>", "ok": false, "error": {"code": "<slug>", "text": "<msg>"}}

See docs/feature-plans/0001-path-addressed-objects-and-commands.md
("Phase 4 protocol proposal"). Rules: every parseable request with an id gets
exactly one reply; unparseable or id-less datagrams are dropped (the caller
logs them); nothing raises out of `handle_request`.
"""

import json

VERSION = "0.1.0"  # the script's own version; keep in step with SCRIPT_VERSION in src/ableton/bridgeProtocol.ts
PROTOCOL = 1
MAX_REPLY_BYTES = 4096


class OpError(Exception):
    """Raised by an op handler to answer with a coded error."""

    def __init__(self, code, text):
        Exception.__init__(self, text)
        self.code = code
        self.text = text


def _error(request_id, code, text):
    return {"v": PROTOCOL, "id": request_id, "ok": False, "error": {"code": code, "text": text}}


def _encode(reply):
    data = json.dumps(reply, separators=(",", ":")).encode("utf-8")
    if len(data) > MAX_REPLY_BYTES:
        reply = _error(str(reply.get("id"))[:64], "too_large", "reply exceeds %d bytes" % MAX_REPLY_BYTES)
        data = json.dumps(reply, separators=(",", ":")).encode("utf-8")
    return data


def hello_result(op_names):
    return {"script": VERSION, "v": PROTOCOL, "ops": sorted(op_names)}


def handle_request(data, ops):
    """Turn one datagram into a reply datagram, or None when it must be dropped.

    `ops` maps op name -> callable(args: dict) -> dict (may raise OpError).
    `hello` is built in and answered whatever `v` the request carries.
    Returns (reply_bytes_or_None, problem_text_or_None).
    """
    try:
        msg = json.loads(data.decode("utf-8"))
    except Exception:
        return None, "unparseable datagram"
    if not isinstance(msg, dict):
        return None, "request is not an object"
    request_id = msg.get("id")
    if not isinstance(request_id, str) or not request_id:
        return None, "request without id"
    op = msg.get("op")
    if not isinstance(op, str):
        return _encode(_error(request_id, "bad_request", "missing op")), None
    if op == "hello":
        reply = {"v": PROTOCOL, "id": request_id, "ok": True, "result": hello_result(list(ops) + ["hello"])}
        return _encode(reply), None
    if msg.get("v") != PROTOCOL:
        return _encode(_error(request_id, "protocol_mismatch", "script speaks protocol %d" % PROTOCOL)), None
    handler = ops.get(op)
    if handler is None:
        return _encode(_error(request_id, "unknown_op", "unknown op %r" % op)), None
    args = msg.get("args", {})
    if not isinstance(args, dict):
        return _encode(_error(request_id, "bad_request", "args must be an object")), None
    try:
        result = handler(args)
        return _encode({"v": PROTOCOL, "id": request_id, "ok": True, "result": result}), None
    except OpError as e:
        return _encode(_error(request_id, e.code, e.text)), None
    except Exception as e:  # nothing may raise into Live
        return _encode(_error(request_id, "failed", "%s: %s" % (type(e).__name__, e))), None
