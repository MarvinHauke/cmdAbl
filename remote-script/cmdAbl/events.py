"""The outbox: events the script pushes to cmdAbl (plan 0018).

Not a reply to a request: the script sends on its own, so cmdAbl can run a command when a MIDI
message arrives. One channel: a UDP datagram from inside `receive_midi` to the address that last
called `midi_listen` (the extension's bridge socket). The spike measured a median of 0.2-0.5 ms
(max 2 ms); an HTTP POST and a send held until `update_display` were dropped.

Wire format: {"v":1,"event":"midi","seq":n,"type":"cc"|"note_on"|"note_off"|"pb","channel":1-16,
"number":n,"value":n,"t":<ms when receive_midi ran>}. `t` and the extension's clock are the same
machine's `time.time()`, so `Date.now() - t` is the push latency.

Rules: nothing raises out of here; a failing socket is logged once per kind, not once per message.
"""

import json


def encode_event(event):
    body = {"v": 1, "event": "midi"}
    for key in ("seq", "type", "channel", "number", "value", "t"):
        body[key] = event[key]
    return json.dumps(body, separators=(",", ":")).encode("utf-8")


def encode_blocked(blocked):
    """{"v":1,"event":"midi_blocked","blocked":["CC51/ch1", …] | null}  (null = Live's forward calls do not say)."""
    return json.dumps({"v": 1, "event": "midi_blocked", "blocked": blocked}, separators=(",", ":")).encode("utf-8")


class Outbox(object):
    """`send_udp(data, peer)` is the script socket's sendto."""

    def __init__(self, send_udp, log):
        self._send_udp = send_udp
        self._log = log
        self._last_problem = None

    def push(self, event, peer):
        """Send one event to `peer` (None = nobody registered: nothing is sent). Returns True when sent."""
        return self._send(encode_event, event, peer)

    def push_blocked(self, blocked, peer):
        """The set of controls Live refused changed."""
        return self._send(encode_blocked, blocked, peer)

    def _send(self, encode, thing, peer):
        if peer is None:
            return False
        try:
            self._send_udp(encode(thing), peer)
            self._last_problem = None
            return True
        except Exception as e:
            what = type(e).__name__
            if what != self._last_problem:
                self._last_problem = what
                try:
                    self._log("cmdAbl [script] event push failed: %s" % what)
                except Exception:
                    pass
            return False
