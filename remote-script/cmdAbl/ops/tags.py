"""Tags on tracks (plan 0008): `tags_all` reads them, `tags_set` writes them.

Where they live: `Track.set_data("cmdabl.tags", <JSON list of strings, as a string>)` — saved with the
Set and copied by a duplicated track (Live-verified in the 0008 spike). `Track.get_data` /
`set_data` are in Live's Python API but not in the Cycling '74 LOM reference.

`set_data` does not mark the Set as modified and adds no undo step (spike result), so a write is
followed by a harmless colour toggle on the same track inside one begin/end_undo_step pair: Live then
asks to save, the colour is unchanged, Cmd+Z leaves it so (one invisible "Custom Action" undo step).

tags_all   Args: {offset?}. Walks the tracks in one flat order (regular, then return, then main) and
           answers only the tracks that carry tags:
             {total, offset, tracks: [{scope, route: [i], name, tags}], next?}
           `total` is the number of tracks walked; `next` (the offset to ask for again) is present when
           the byte budget ended the reply early. Paging is by position in the live track list: a track
           added or deleted between two pages can repeat or skip an entry; the next read fixes it. A stored value that is not a JSON list of strings
           counts as no tags. A track that cannot hold data (the main track perhaps) is skipped.
tags_set   (writing op: needs the token) Args: {scope, route (length 1), expectName, tags: [string]}
           Result: {name, tags, marked} — `tags` read back from Live, `marked` false when the colour
           toggle did not work (the tags are stored, but the Set may not ask to save).
"""

import json
import re

from ..protocol import OpError
from ..routes import parse_target, resolve, tracks_for_scope

KEY = "cmdabl.tags"
MAX_TAGS = 40
MAX_TAG_CHARS = 40
MAX_STORED_BYTES = 1500  # of the JSON list; keeps one track's entry far below the reply cap
BUDGET_BYTES = 3600  # of the 4096-byte reply cap; the envelope uses the rest
TAG_PATTERN = re.compile(r"^[a-z0-9_-]+$")  # the 0008 grammar: the script keeps stored data within it
_MISSING = "\u0000cmdabl-missing\u0000"


def parse_stored(value):
    """The tags in a stored value, or [] when it is not a JSON list of non-empty strings."""
    try:
        if isinstance(value, str):
            value = json.loads(value)
        if not isinstance(value, list):
            return []
        return [t for t in value if isinstance(t, str) and t]
    except Exception:
        return []


def _size(obj):
    return len(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) + 1


def _walk(song):
    """Every track in the flat order of tags_all: (scope, index, track)."""
    for scope in ("regular", "return"):
        for index, track in enumerate(tracks_for_scope(song, scope)):
            yield scope, index, track
    yield "master", 0, song.master_track


def tags_all(song, args):
    offset = args.get("offset", 0)
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
        raise OpError("bad_request", "offset must be a non-negative integer")
    entries = []
    used = _size({"total": 0, "offset": offset, "tracks": [], "next": 0})
    total = 0
    nxt = None
    for position, (scope, index, track) in enumerate(_walk(song)):
        total = position + 1
        if position < offset or nxt is not None:
            continue
        try:
            tags = parse_stored(track.get_data(KEY, _MISSING))
            if not tags:
                continue
            entry = {"scope": scope, "route": [index], "name": track.name, "tags": tags}
        except Exception:
            continue  # an odd track must not hide the others
        size = _size(entry)
        # the first entry of a request always goes out, so every request makes progress
        if entries and used + size > BUDGET_BYTES:
            nxt = position
            continue
        entries.append(entry)
        used += size
    result = {"total": total, "offset": offset, "tracks": entries}
    if nxt is not None:
        result["next"] = nxt
    return result


def _validate_tags(tags):
    if not isinstance(tags, list):
        raise OpError("bad_request", "tags must be a list")
    seen = []
    for tag in tags:
        if not isinstance(tag, str) or not tag or len(tag) > MAX_TAG_CHARS:
            raise OpError("bad_request", "a tag must be a text of 1 to %d characters" % MAX_TAG_CHARS)
        if not TAG_PATTERN.match(tag):
            raise OpError("bad_request", "a tag may only contain a-z, 0-9, _ and -")
        if tag not in seen:
            seen.append(tag)
    if len(seen) > MAX_TAGS:
        raise OpError("bad_request", "at most %d tags per track" % MAX_TAGS)
    if _size(seen) > MAX_STORED_BYTES:
        raise OpError("bad_request", "the tags are too long")
    return seen


def _mark_modified(song, track):
    """Toggle the track's colour index and put it back, in one undo step. True when it worked."""
    begin = getattr(song, "begin_undo_step", None)
    end = getattr(song, "end_undo_step", None)
    opened = False
    if callable(begin) and callable(end):
        try:
            begin()
            opened = True
        except Exception:
            opened = False
    index = None
    try:
        index = track.color_index
        track.color_index = index + 1 if index < 69 else index - 1
        track.color_index = index
        return track.color_index == index
    except Exception:
        return False
    finally:
        try:
            if index is not None and track.color_index != index:
                track.color_index = index  # never leave a changed colour behind
        except Exception:
            pass
        if opened:
            try:
                end()
            except Exception:
                pass


def tags_set(song, args):
    scope, route = parse_target(args)
    if len(route) != 1:
        raise OpError("bad_request", "tags take track routes (length 1)")
    expect = args.get("expectName")
    if not isinstance(expect, str):
        raise OpError("bad_request", "expectName is required for a change")
    tags = _validate_tags(args.get("tags"))
    track = resolve(song, scope, route)[0]
    if track.name != expect:
        raise OpError("stale", "name differs")
    try:
        track.set_data(KEY, json.dumps(tags, separators=(",", ":"), ensure_ascii=False))
    except Exception as e:
        raise OpError("unsupported", "set_data failed: %s: %s" % (type(e).__name__, e))
    try:
        back = parse_stored(track.get_data(KEY, _MISSING))
    except Exception as e:
        raise OpError("unsupported", "get_data failed after the write: %s: %s" % (type(e).__name__, e))
    if back != tags:
        raise OpError("failed", "Live did not keep the tags")
    marked = _mark_modified(song, track)
    return {"name": track.name, "tags": back, "marked": marked}
