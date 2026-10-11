"""The old one-way `cmd` messages (select_track / select_device).

Kept until goto uses the `select` op (0001 §8); then this file is deleted.
`song` is passed in; `log` is a callable taking one string.
"""

import json
import traceback

from .routes import tracks_for_scope, unfold_parents


def handle(data, song, log):
    try:
        msg = json.loads(data.decode("utf-8"))
    except Exception:
        log("cmdAbl bridge: bad message: %r" % data)
        return
    cmd = msg.get("cmd") if isinstance(msg, dict) else None
    if cmd == "select_track":
        select_track(song, msg, log)
    elif cmd == "select_device":
        select_device(song, msg, log)
    else:
        log("cmdAbl bridge: unknown cmd %r" % cmd)


def select_track(song, msg, log):
    scope = msg.get("scope", "regular")
    index = msg.get("index")
    tracks = tracks_for_scope(song, scope)
    if not isinstance(index, int) or index < 0 or index >= len(tracks):
        log("cmdAbl bridge: select_track index out of range: %r (scope=%r)" % (index, scope))
        return
    try:
        track = tracks[index]
        unfold_parents(track)
        song.view.selected_track = track
    except Exception:
        log("cmdAbl bridge: select failed:\n%s" % traceback.format_exc())


def select_device(song, msg, log):
    scope = msg.get("scope", "regular")
    track_index = msg.get("trackIndex")
    device_index = msg.get("deviceIndex")
    tracks = tracks_for_scope(song, scope)
    if not isinstance(track_index, int) or track_index < 0 or track_index >= len(tracks):
        log("cmdAbl bridge: select_device trackIndex out of range: %r (scope=%r)" % (track_index, scope))
        return
    track = tracks[track_index]
    devices = track.devices
    if not isinstance(device_index, int) or device_index < 0 or device_index >= len(devices):
        log("cmdAbl bridge: select_device deviceIndex out of range: %r" % device_index)
        return
    try:
        # Device selection requires the containing track to be selected too
        # (and visible, if it's nested in a folded group).
        unfold_parents(track)
        song.view.selected_track = track
        song.view.select_device(devices[device_index])
    except Exception:
        log("cmdAbl bridge: select_device failed:\n%s" % traceback.format_exc())
