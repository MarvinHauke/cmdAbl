"""cmdAbl bridge Remote Script.

Receives small JSON commands from the cmdAbl extension over a local UDP
socket and applies them to the Live Set. The socket is drained from
`update_display`, which Live calls on the main thread at ~10 Hz, so LOM
mutations made here are thread-safe.

Protocol (UTF-8 JSON datagrams):
    {"cmd": "select_track", "index": <int>}   # index into song.tracks
"""

import json
import socket
import traceback

from _Framework.ControlSurface import ControlSurface

BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = 27185


class cmdAbl(ControlSurface):
    def __init__(self, c_instance):
        super().__init__(c_instance)
        self._socket = None
        try:
            self._socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._socket.setblocking(False)
            self._socket.bind((BRIDGE_HOST, BRIDGE_PORT))
            self.log_message(
                "cmdAbl bridge listening on %s:%d" % (BRIDGE_HOST, BRIDGE_PORT)
            )
        except Exception:
            self.log_message(
                "cmdAbl bridge failed to bind:\n%s" % traceback.format_exc()
            )

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
        while True:
            try:
                data, _addr = self._socket.recvfrom(4096)
            except (BlockingIOError, OSError):
                return  # nothing left to read
            if not data:
                return
            self._handle(data)

    def _handle(self, data):
        try:
            msg = json.loads(data.decode("utf-8"))
        except Exception:
            self.log_message("cmdAbl bridge: bad message: %r" % data)
            return
        cmd = msg.get("cmd")
        if cmd == "select_track":
            self._select_track(msg)
        else:
            self.log_message("cmdAbl bridge: unknown cmd %r" % cmd)

    def _select_track(self, msg):
        index = msg.get("index")
        song = self.song()
        tracks = song.tracks
        if not isinstance(index, int) or index < 0 or index >= len(tracks):
            self.log_message(
                "cmdAbl bridge: select_track index out of range: %r" % index
            )
            return
        try:
            song.view.selected_track = tracks[index]
        except Exception:
            self.log_message(
                "cmdAbl bridge: select failed:\n%s" % traceback.format_exc()
            )
