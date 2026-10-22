"""`set_id`: the Live Set's own id, kept in the Set (plan 0013), for things that belong to one Set.

Where it lives: `Song.set_data("cmdabl.set-id", <hex string>)`; `get_data`/`set_data` are in Live's
Python API (Song and Track), not in the Cycling '74 reference. Whether the value survives save,
reload and Save As is still to be checked in Live.

set_id   Args: {create?: bool (default false)}. (A writing op: it needs the token, as `create` may write.)
         Result: {id: string | null, marked?: bool}.
         Without `create` it only reads: the id, or null when the Set has none (or holds something that
         is not an id). With `create` and no id yet, it stores a new random id (uuid4 hex), reads it
         back (`failed` if it differs) and marks the Set as modified so Live asks to save (the colour
         toggle of tags.py on one track; `marked` false when that did not work, or the Set has no
         track). With `create` and an id already there, nothing is written and no mark is made.
"""

import re
import uuid

from ..protocol import OpError
from .tags import _mark_modified

KEY = "cmdabl.set-id"
_ID = re.compile(r"^[0-9a-f]{32}$")
_MISSING = None


def _read(song):
    """The stored id, or None when there is none or the value is not an id."""
    try:
        value = song.get_data(KEY, _MISSING)
    except Exception:
        return None
    return value if isinstance(value, str) and _ID.match(value) else None


def _any_track(song):
    for tracks in (song.tracks, song.return_tracks):
        for track in tracks:
            return track
    return song.master_track


def set_id(song, args):
    create = args.get("create", False)
    if not isinstance(create, bool):
        raise OpError("bad_request", "create must be true or false")
    found = _read(song)
    if found is not None or not create:
        return {"id": found}
    new = uuid.uuid4().hex
    try:
        song.set_data(KEY, new)
    except Exception as e:
        raise OpError("unsupported", "set_data failed: %s: %s" % (type(e).__name__, e))
    if _read(song) != new:
        raise OpError("failed", "Live did not keep the id")
    try:
        marked = _mark_modified(song, _any_track(song))
    except Exception:
        marked = False
    return {"id": new, "marked": marked}
