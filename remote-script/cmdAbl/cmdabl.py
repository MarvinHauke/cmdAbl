"""cmdAbl bridge Remote Script — the control surface: socket, read, hand over.

Receives JSON datagrams from the cmdAbl extension on 127.0.0.1:27185. The
socket is drained from `update_display`, which Live calls on the main thread at
~10 Hz, so LOM access made here is thread-safe. No operation logic lives here:

- protocol.py  message format, errors, `hello` (pure)
- routes.py    {scope, route} -> Live objects
- ops/         one handler per operation (the list `hello` reports)

Layout and rules: docs/feature-plans/0001 §8.
"""

import socket
import traceback

from _Framework.ControlSurface import ControlSurface

from .ops import OPS, WRITES
from .access_token import create_token
from .protocol import handle_request

BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = 27185
MAX_PER_TICK = 32


class cmdAbl(ControlSurface):
    def __init__(self, c_instance):
        super().__init__(c_instance)
        self._socket = None
        # The access token for writing ops: new per Live start, a file only the user can read.
        # The value is never logged.
        self._token = create_token()
        self.log_message(
            "cmdAbl bridge: access token %s" % ("written" if self._token else "unavailable (writing operations are refused)")
        )
        try:
            self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._socket.setblocking(False)
            self._socket.bind((BRIDGE_HOST, BRIDGE_PORT))
            self.log_message("cmdAbl bridge listening on %s:%d" % (BRIDGE_HOST, BRIDGE_PORT))
        except Exception:
            self.log_message("cmdAbl bridge failed to bind:\n%s" % traceback.format_exc())

    def disconnect(self):
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
                self.log_message("cmdAbl bridge: handler error:\n%s" % traceback.format_exc())

    def _ops_for_song(self):
        """The op table with the song bound; the song is read per request, never cached."""
        return {name: (lambda args, fn=fn: fn(self.song(), args)) for name, fn in OPS.items()}

    def _handle(self, data, addr):
        # Every request has an id and an op; a datagram without them is dropped and logged
        # (this includes the old one-way `cmd` messages of early development builds).
        reply, problem = handle_request(data, self._ops_for_song(), WRITES, self._token)
        if problem:
            self.log_message("cmdAbl bridge: dropped datagram: %s" % problem)
        if reply is not None:
            try:
                self._socket.sendto(reply, addr)
            except Exception:
                self.log_message("cmdAbl bridge: reply failed:\n%s" % traceback.format_exc())
