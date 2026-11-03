"""The outbox: events the script pushes to cmdAbl (plan 0018, spike).

Not a reply to a request: the script sends on its own, so cmdAbl can run a command when a MIDI
message arrives. The spike sends every event on three channels and stamps each with `via`, so the
extension can compare them from one run:

- `udp`       a datagram to the extension's bridge socket, sent from inside `receive_midi`;
- `udp_tick`  the same, but held until the next `update_display` (what a tick-driven send would cost);
- `http`      a POST to the extension's trigger server (127.0.0.1:27184/midi-event) with the access
              token, from a worker thread, so a slow server cannot stall Live's main thread.

Wire format: {"v":1,"event":"midi","via":...,"seq":n,"type":...,"channel":1-16,"number":n,"value":n,
"t":<ms when receive_midi ran>,"sent":<ms when this datagram or request left>}. Both clocks are
`time.time()` on the same machine, so the extension's `Date.now() - t` is the push latency.

Rules: the worker thread never calls into Live (not even `log_message`): its problems wait in a
queue and `drain_problems` hands them to the main thread (update_display); nothing raises out of here; a token or any environment value never appears in a log line;
failures are logged once per kind, not once per message.
"""

import json
import queue
import threading
import time

HTTP_HOST = "127.0.0.1"
HTTP_PORT = 27184
HTTP_PATH = "/midi-event"
HTTP_TIMEOUT_S = 0.5
HTTP_BACKOFF_S = 5.0
HTTP_QUEUE_MAX = 200
TICK_QUEUE_MAX = 200
CHANNELS = ("udp", "udp_tick", "http")


def encode_event(event, via, clock=time.time):
    body = {"v": 1, "event": "midi", "via": via}
    body.update(event)
    body["sent"] = round(clock() * 1000.0, 3)
    return json.dumps(body, separators=(",", ":")).encode("utf-8")


class HttpPusher(object):
    """POSTs bodies to the trigger server from one worker thread. `post` never blocks."""

    def __init__(self, token, log=None, clock=time.time, connection=None, start=True):
        self._token = token  # a callable returning the token string or None; never logged
        self._problems = queue.Queue(20)  # worker -> main thread; `log` is unused, kept so callers stay simple
        self._clock = clock
        self._connection = connection  # a factory(host, port, timeout) -> http.client-like; tests inject a fake
        self._queue = queue.Queue(HTTP_QUEUE_MAX)
        self._muted_until = 0.0
        self._last_problem = None
        self._thread = None
        if start:
            self._thread = threading.Thread(target=self._run, name="cmdAbl-events", daemon=True)
            self._thread.start()

    def post(self, event, clock=None):
        """Queue one event (a dict, without `sent`; it is stamped when the worker sends it)."""
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            self._problem("queue full")

    def close(self):
        try:
            self._queue.put_nowait(None)
        except queue.Full:
            pass

    def _run(self):
        while True:
            event = self._queue.get()
            if event is None:
                return
            self._send(event)

    def _problem(self, what):
        """Called on the worker thread (and from post): only queue the text, once per kind."""
        if what != self._last_problem:
            self._last_problem = what
            try:
                self._problems.put_nowait("cmdAbl [script] event push (http) failed: %s" % what)
            except queue.Full:
                pass

    def drain_problems(self):
        """Main thread: the problem lines waiting to be logged."""
        out = []
        while True:
            try:
                out.append(self._problems.get_nowait())
            except queue.Empty:
                return out

    def _send(self, event):
        """One POST; a failure mutes the channel for a few seconds. Returns True when sent."""
        now = self._clock()
        if now < self._muted_until:
            return False
        token = None
        try:
            token = self._token()
        except Exception:
            token = None
        if not token:
            self._problem("no access token")
            self._muted_until = now + HTTP_BACKOFF_S
            return False
        try:
            body = encode_event(event, "http", self._clock)
            conn = (self._connection or _default_connection)(HTTP_HOST, HTTP_PORT, HTTP_TIMEOUT_S)
            try:
                conn.request("POST", HTTP_PATH, body, {"Authorization": "Bearer " + token, "Content-Type": "application/json"})
                response = conn.getresponse()
                response.read()
                status = response.status
            finally:
                conn.close()
        except Exception as e:  # connection refused, timeout, reset
            self._problem(type(e).__name__)
            self._muted_until = now + HTTP_BACKOFF_S
            return False
        if status != 200:
            self._problem("status %d" % status)
            self._muted_until = now + HTTP_BACKOFF_S
            return False
        self._last_problem = None
        return True


def _default_connection(host, port, timeout):
    import http.client

    return http.client.HTTPConnection(host, port, timeout=timeout)


class Outbox(object):
    """Fans one event out to the channels. `send_udp(data, peer)` is the script socket's sendto."""

    def __init__(self, send_udp, http, log, clock=time.time, channels=CHANNELS):
        self._send_udp = send_udp
        self._http = http
        self._log = log
        self._clock = clock
        self._channels = tuple(channels)
        self._held = []
        self._last_problem = None

    def push(self, event, peer):
        """Called from receive_midi: udp now, udp_tick held, http queued. `peer` may be None (no extension registered)."""
        for via in self._channels:
            try:
                if via == "udp":
                    self._udp(event, "udp", peer)
                elif via == "udp_tick":
                    if peer is not None and len(self._held) < TICK_QUEUE_MAX:
                        self._held.append(event)
                elif via == "http" and self._http is not None:
                    self._http.post(event)
            except Exception as e:
                self._problem("%s: %s" % (via, type(e).__name__))

    def flush_tick(self, peer):
        """Called from update_display: send what receive_midi held back."""
        held, self._held = self._held, []
        for event in held:
            try:
                self._udp(event, "udp_tick", peer)
            except Exception as e:
                self._problem("udp_tick: %s" % type(e).__name__)

    def _udp(self, event, via, peer):
        if peer is not None:
            self._send_udp(encode_event(event, via, self._clock), peer)

    def _problem(self, what):
        if what != self._last_problem:
            self._last_problem = what
            try:
                self._log("cmdAbl [script] event push failed: %s" % what)
            except Exception:
                pass
