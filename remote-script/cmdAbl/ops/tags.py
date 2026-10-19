"""SPIKE (temporary, plan 0008): `track_tags` / `track_tags_set` — what `Track.get_data` / `set_data` do.

Both ops address one track: {scope, route (length 1)}. The key is always KEY. `set_data` and
`get_data` are in Live's Python API (Song and Track only) but not in the Cycling '74 LOM reference.
What they do on duplicate / undo / save / size is not documented; these ops exist so the user can find
out in Live. They are deleted or replaced by the real tag operation once 0008 is decided.

track_tags      Args: {scope, route, expectName?, missing?: any}
                Result: {name, present, type, length, value?}
                `present` is false when the key is not stored (get_data returned the sentinel).
                `type` is the Python type name of the stored value; `length` its len() when it has one
                (else -1); `value` is sent when its JSON form is <= MAX_VALUE_BYTES.
track_tags_set  (writing op: needs the token) Args: {scope, route, expectName, value?, fill?, as?, undo?, clear?}
                  value   any JSON value, stored as given
                  fill    int: store "x" * fill instead (to find a size limit; the request stays small)
                  as      "string" (default) | "list" | "dict": wrap the stored value as [v] / {"v": v}
                  clear   true: store None (there is no delete) instead of a value
                  undo    true: wrap the write in begin_undo_step/end_undo_step (default false, to see
                          whether set_data makes an undo step of its own)
                Result: {name, stored, type, length, same}  — read back right after the write.
"""

import json

from ..protocol import OpError
from ..routes import parse_target, resolve

KEY = "cmdabl.tags"
MAX_VALUE_BYTES = 1500  # of the 4096-byte reply cap
MAX_FILL = 1000000
_MISSING = "\u0000cmdabl-missing\u0000"  # what get_data returns when nothing is stored under KEY


def _track(song, args, need_name):
    scope, route = parse_target(args)
    if len(route) != 1:
        raise OpError("bad_request", "tags take track routes (length 1)")
    expect = args.get("expectName")
    if need_name and not isinstance(expect, str):
        raise OpError("bad_request", "expectName is required for a change")
    if expect is not None and not isinstance(expect, str):
        raise OpError("bad_request", "expectName must be a string")
    track = resolve(song, scope, route)[0]
    if expect is not None and track.name != expect:
        raise OpError("stale", "name differs")
    return track


def _describe(value):
    try:
        length = len(value)
    except Exception:
        length = -1
    return {"type": type(value).__name__, "length": length}


def track_tags(song, args):
    track = _track(song, args, False)
    try:
        value = track.get_data(KEY, _MISSING)
    except Exception as e:
        raise OpError("unsupported", "get_data failed: %s: %s" % (type(e).__name__, e))
    result = {"name": track.name, "present": value != _MISSING}
    if not result["present"]:
        return result
    result.update(_describe(value))
    try:
        # the same settings as protocol._encode (UTF-8, no \u escapes)
        size = len(json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    except Exception:
        size = None  # not JSON, or a lone surrogate the protocol would escape: type/length only
    if size is not None and size <= MAX_VALUE_BYTES:
        result["value"] = value
    return result


def track_tags_set(song, args):
    track = _track(song, args, True)
    fill = args.get("fill")
    if fill is not None:
        if not isinstance(fill, int) or isinstance(fill, bool) or fill < 0 or fill > MAX_FILL:
            raise OpError("bad_request", "fill must be an integer from 0 to %d" % MAX_FILL)
        value = "x" * fill
    elif args.get("clear") is True:
        value = None
    elif "value" in args:
        value = args["value"]
    else:
        raise OpError("bad_request", "give value, fill or clear")
    wrap = args.get("as", "string")
    if wrap == "list":
        value = [value]
    elif wrap == "dict":
        value = {"v": value}
    elif wrap != "string":
        raise OpError("bad_request", "as must be string, list or dict")
    begin = getattr(song, "begin_undo_step", None)
    end = getattr(song, "end_undo_step", None)
    opened = False
    if args.get("undo") is True and callable(begin) and callable(end):
        try:
            begin()
            opened = True
        except Exception:
            opened = False
    try:
        try:
            track.set_data(KEY, value)
        except Exception as e:
            raise OpError("unsupported", "set_data failed: %s: %s" % (type(e).__name__, e))
    finally:
        if opened:
            try:
                end()
            except Exception:
                pass
    try:
        back = track.get_data(KEY, _MISSING)
    except Exception as e:
        raise OpError("unsupported", "get_data failed after the write: %s: %s" % (type(e).__name__, e))
    result = {"name": track.name, "stored": back != _MISSING, "same": back == value}
    result.update(_describe(back) if back != _MISSING else {"type": "missing", "length": -1})
    return result


# ---- mark_modified: which harmless write makes Live consider the Set modified? ------------------
# Live's Python API has no "mark modified"; set_data does not mark the Set (Live-verified). Each
# candidate is tried by the user; the reply says whether an undo step appeared (Song.can_undo).
# `toggle_*` change a value and put it back inside one begin/end_undo_step pair.

CANDIDATES = ("same_name", "toggle_name", "toggle_color", "empty_undo", "song_data")
DIRTY_KEY = "cmdabl.dirty"


def _can_undo(song):
    try:
        return bool(song.can_undo)
    except Exception:
        return None


def _in_undo_step(song, work):
    begin = getattr(song, "begin_undo_step", None)
    end = getattr(song, "end_undo_step", None)
    opened = False
    if callable(begin) and callable(end):
        try:
            begin()
            opened = True
        except Exception:
            opened = False
    try:
        work()
    finally:
        if opened:
            try:
                end()
            except Exception:
                pass
    return opened


def mark_modified(song, args):
    track = _track(song, args, True)
    candidate = args.get("candidate")
    if candidate not in CANDIDATES:
        raise OpError("bad_request", "candidate must be one of %s" % ", ".join(CANDIDATES))
    before = _can_undo(song)
    name = track.name
    touched = ""
    try:
        if candidate == "same_name":
            track.name = name
            touched = "name set to its own value"
        elif candidate == "toggle_name":
            seen = []

            def work():
                track.name = name + " "
                seen.append(track.name)  # Live may trim the space: then nothing changed
                track.name = name
            _in_undo_step(song, work)
            touched = "name changed and restored" if seen and seen[0] != name else "name unchanged by Live (trailing space trimmed)"
        elif candidate == "toggle_color":
            index = track.color_index
            other = index + 1 if index < 69 else index - 1

            def work():
                track.color_index = other
                track.color_index = index
            try:
                _in_undo_step(song, work)
            finally:
                if track.color_index != index:
                    track.color_index = index
            touched = "color_index changed and restored"
        elif candidate == "empty_undo":
            _in_undo_step(song, lambda: None)
            touched = "empty undo step"
        else:
            current = song.get_data(DIRTY_KEY, 0)
            song.set_data(DIRTY_KEY, (current if isinstance(current, int) else 0) + 1)
            touched = "Song.set_data %s" % DIRTY_KEY
    except OpError:
        raise
    except Exception as e:
        raise OpError("unsupported", "%s failed: %s: %s" % (candidate, type(e).__name__, e))
    finally:
        try:
            if track.name != name:  # never leave a changed name behind
                track.name = name
        except Exception:
            pass
    return {"name": track.name, "candidate": candidate, "touched": touched,
            "can_undo_before": before, "can_undo_after": _can_undo(song)}
