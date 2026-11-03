"""cmdAbl bridge Remote Script — the control surface: socket, read, hand over.

Receives JSON datagrams from the cmdAbl extension on 127.0.0.1:27185. The
socket is drained from `update_display`, which Live calls on the main thread at
~10 Hz, so LOM access made here is thread-safe. No operation logic lives here:

- protocol.py  message format, errors, `hello` (pure)
- routes.py    {scope, route} -> Live objects
- ops/         one handler per operation (the list `hello` reports)
- midi.py      MIDI in: the forwarded set, the ring buffer (plan 0018)
- events.py    the outbox that pushes events to cmdAbl (plan 0018)

Layout and rules: docs/feature-plans/0001 §8.
"""

import socket
import time
import traceback

from _Framework.ControlSurface import ControlSurface

from .events import HttpPusher, Outbox
from .midi import MidiService
from .ops import OPS, WRITES
from .access_token import create_token
from .protocol import handle_request

BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = 27185
MAX_PER_TICK = 32
MAX_MIDI_LOG_LINES = 300  # spike: one Log.txt line per message, for the first ones only


class cmdAbl(ControlSurface):
    def __init__(self, c_instance):
        super().__init__(c_instance)
        self._socket = None
        self.peer = None  # the address of the request being handled (ops that register a push target read it)
        self._midi_logged = 0
        self.midi = MidiService()
        self._http = HttpPusher(lambda: self._token)
        self._outbox = Outbox(self._send_to, self._http, self.log_message)
        # The access token for writing ops: new per Live start, a file only the user can read.
        # The value is never logged.
        self._token = create_token()
        self.log_message(
            "cmdAbl [script] access token %s" % ("written" if self._token else "unavailable (writing operations are refused)")
        )
        try:
            self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._socket.setblocking(False)
            self._socket.bind((BRIDGE_HOST, BRIDGE_PORT))
            self.log_message("cmdAbl [script] listening on %s:%d" % (BRIDGE_HOST, BRIDGE_PORT))
        except Exception:
            self.log_message("cmdAbl [script] failed to bind:\n%s" % traceback.format_exc())

    def disconnect(self):
        try:
            self._http.close()
        except Exception:
            pass
        if self._socket is not None:
            try:
                self._socket.close()
            except Exception:
                pass
            self._socket = None
        super().disconnect()

    def update_display(self):
        super().update_display()
        self._drain_socket()
        try:
            self._outbox.flush_tick(self.midi.peer)
            for line in self._http.drain_problems():  # the worker thread may not call Live, so the main thread logs
                self.log_message(line)
        except Exception:
            self.log_message("cmdAbl [script] event flush error:\n%s" % traceback.format_exc())

    # -- MIDI in (plan 0018): Live's callbacks, wired to midi.py and events.py ------------------

    def build_midi_map(self, midi_map_handle):
        super().build_midi_map(midi_map_handle)
        try:
            import Live  # only inside Live

            started = time.time()
            count = self.midi.build_map(Live.MidiMap, self._c_instance.handle(), midi_map_handle)
            self.log_message("cmdAbl [midi] map built: %d controls forwarded in %.0f ms" % (count, (time.time() - started) * 1000.0))
        except Exception:
            self.log_message("cmdAbl [midi] map failed:\n%s" % traceback.format_exc())

    def receive_midi(self, midi_bytes):
        try:
            msg = self.midi.receive(midi_bytes)
            if msg is None:
                super().receive_midi(midi_bytes)  # sysex, clock, … stay with the framework
                return
            self._outbox.push(msg, self.midi.peer)
            if self._midi_logged < MAX_MIDI_LOG_LINES:  # after the push: logging must not delay it
                self._midi_logged += 1
                self.log_message("cmdAbl [midi] %s ch%d #%d = %d" % (msg["type"], msg["channel"], msg["number"], msg["value"]))
        except Exception:
            self.log_message("cmdAbl [midi] receive error:\n%s" % traceback.format_exc())

    def rebuild_map(self):
        try:
            self.request_rebuild_midi_map()
        except Exception:
            self.log_message("cmdAbl [midi] rebuild request failed:\n%s" % traceback.format_exc())

    def _send_to(self, data, addr):
        if self._socket is not None:
            self._socket.sendto(data, addr)

    def _drain_socket(self):
        if self._socket is None:
            return
        # At most MAX_PER_TICK datagrams per tick: a flood must not stall Live's main thread.
        for _ in range(MAX_PER_TICK):
            try:
                data, addr = self._socket.recvfrom(4096)
            except (BlockingIOError, OSError):
                return  # nothing left to read
            if not data:
                return
            try:
                self._handle(data, addr)
            except Exception:
                self.log_message("cmdAbl [script] handler error:\n%s" % traceback.format_exc())

    def _ops_for_song(self):
        """The op table with the song bound; the song is read per request, never cached."""
        def bind(fn):
            if getattr(fn, "wants_context", False):
                return lambda args: fn(self.song(), args, self)
            return lambda args: fn(self.song(), args)

        return {name: bind(fn) for name, fn in OPS.items()}

    def _handle(self, data, addr):
        # Every request has an id and an op; a datagram without them is dropped and logged
        # (this includes the old one-way `cmd` messages of early development builds).
        self.peer = addr
        reply, problem = handle_request(data, self._ops_for_song(), WRITES, self._token)
        if problem:
            self.log_message("cmdAbl [script] dropped datagram: %s" % problem)
        if reply is not None:
            try:
                self._socket.sendto(reply, addr)
            except Exception:
                self.log_message("cmdAbl [script] reply failed:\n%s" % traceback.format_exc())
