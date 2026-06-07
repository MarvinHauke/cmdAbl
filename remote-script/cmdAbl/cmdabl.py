"""cmdAbl bridge Remote Script.

Receives small JSON commands from the cmdAbl extension over a local UDP
socket and applies them to the Live Set. The socket is drained from
`update_display`, which Live calls on the main thread at ~10 Hz, so LOM
mutations made here are thread-safe.

Protocol (UTF-8 JSON datagrams):
    {"cmd": "select_track", "scope": <"regular"|"return"|"master">, "index": <int>}
    {"cmd": "select_device", "scope": <...>, "trackIndex": <int>, "deviceIndex": <int>}

`scope` names which track collection the index resolves into — song.tracks,
song.return_tracks, or the single-element [song.master_track]. It mirrors
TrackScope on the extension side (src/types.ts) and defaults to "regular" if
omitted, matching pre-Phase-2 messages that only ever addressed song.tracks.
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
        elif cmd == "select_device":
            self._select_device(msg)
        else:
            self.log_message("cmdAbl bridge: unknown cmd %r" % cmd)

    def _tracks_for_scope(self, song, scope):
        if scope == "return":
            return song.return_tracks
        if scope == "master":
            return [song.master_track]
        return song.tracks

    def _select_track(self, msg):
        scope = msg.get("scope", "regular")
        index = msg.get("index")
        song = self.song()
        tracks = self._tracks_for_scope(song, scope)
        if not isinstance(index, int) or index < 0 or index >= len(tracks):
            self.log_message(
                "cmdAbl bridge: select_track index out of range: %r (scope=%r)" % (index, scope)
            )
            return
        try:
            track = tracks[index]
            self._unfold_parents(track)
            song.view.selected_track = track
        except Exception:
            self.log_message(
                "cmdAbl bridge: select failed:\n%s" % traceback.format_exc()
            )

    def _select_device(self, msg):
        scope = msg.get("scope", "regular")
        track_index = msg.get("trackIndex")
        device_index = msg.get("deviceIndex")
        song = self.song()
        tracks = self._tracks_for_scope(song, scope)
        if not isinstance(track_index, int) or track_index < 0 or track_index >= len(tracks):
            self.log_message(
                "cmdAbl bridge: select_device trackIndex out of range: %r (scope=%r)" % (track_index, scope)
            )
            return
        track = tracks[track_index]
        devices = track.devices
        if not isinstance(device_index, int) or device_index < 0 or device_index >= len(devices):
            self.log_message(
                "cmdAbl bridge: select_device deviceIndex out of range: %r" % device_index
            )
            return
        try:
            # Device selection requires the containing track to be selected
            # too (and visible, if it's nested in a folded group).
            self._unfold_parents(track)
            song.view.selected_track = track
            song.view.select_device(devices[device_index])
        except Exception:
            self.log_message(
                "cmdAbl bridge: select_device failed:\n%s" % traceback.format_exc()
            )

    def _unfold_parents(self, track):
        # A track inside a folded Group Track is hidden in the UI even when
        # selected, so walk up the chain of enclosing groups and unfold each.
        group = track.group_track
        while group:
            if group.is_foldable and group.fold_state:
                group.fold_state = 0
            group = group.group_track
