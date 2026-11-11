"""`transport` and `loop_set`: the play state, the bar grid and the arrangement loop (plan 0013 "Stamps").

transport   Args: {} (a read; no token).
            Result: {playing, session, pos, time, barStart, barLen, songLength, loop: {on, start, length}}.
            songLength = song.song_length in beats (Live counts the current loop's end in it, and refuses a
            loop_start beyond it).
            Times are in beats. `pos` is Song.get_current_beats_song_time() as text ("12.3.1.1").
            `session` is true when any track has a playing clip slot (playing_slot_index >= 0).
            barLen = signature_numerator * 4 / signature_denominator; barStart = floor(time / barLen) * barLen.
            Limit: only the current time signature is used (no signature changes along the timeline).
loop_set    Args: {on: bool, start: number >= 0, length: number > 0}. (A writing op: it needs the token.)
            Result: {loop: {on, start, length}}, read back after the write; `failed` if Live differs.
"""

import math

from ..protocol import OpError


def _loop(song):
    return {"on": bool(song.loop), "start": float(song.loop_start), "length": float(song.loop_length)}


def _session_playing(song):
    for tracks in (song.tracks, song.return_tracks):
        for track in tracks:
            try:
                if track.playing_slot_index >= 0:
                    return True
            except Exception:
                continue  # group and some tracks have no clip slots
    return False


def _pos(song):
    bt = song.get_current_beats_song_time()
    try:
        return "%d.%d.%d.%d" % (bt.bars, bt.beats, bt.sub_division, bt.ticks)
    except Exception:
        return str(bt)


def _song_length(song):
    try:
        return float(song.song_length)
    except Exception:
        return 0.0


def transport(song, args):
    time = float(song.current_song_time)
    bar_len = float(song.signature_numerator) * 4.0 / float(song.signature_denominator)
    return {
        "playing": bool(song.is_playing),
        "session": _session_playing(song),
        "pos": _pos(song),
        "time": time,
        "barStart": math.floor(time / bar_len) * bar_len,
        "barLen": bar_len,
        "songLength": _song_length(song),
        "loop": _loop(song),
    }


def _same(got, want):
    return got["on"] == want["on"] and abs(got["start"] - want["start"]) <= 1e-6 and abs(got["length"] - want["length"]) <= 1e-6


def _write(song, loop):
    """Write start and length. Live refuses a start beyond the song length, which includes the current
    loop's end, so after a plain start-then-length failure it first stretches the loop to end past the
    new start. Returns the error text of the last try, or None when it took."""
    err = None
    tries = (
        (("loop_start", loop["start"]), ("loop_length", loop["length"])),
        (("loop_length", loop["start"] + loop["length"]), ("loop_start", loop["start"]), ("loop_length", loop["length"])),
    )
    for steps in tries:
        try:
            for name, value in steps:
                setattr(song, name, value)
            return None
        except Exception as e:
            err = "%s: %s" % (type(e).__name__, e)
    return err


def _restore(song, prev):
    """Best effort: put the loop back as it was after a failed write; never raises.
    Returns None when the old loop is back, else the reason it could not be put back."""
    err = _write(song, prev)
    try:
        song.loop = prev["on"]
        got = _loop(song)
    except Exception as e:
        return err or "%s: %s" % (type(e).__name__, e)
    if _same(got, prev):
        return None
    return err or "Live reports start %s, length %s" % (got["start"], got["length"])


def _failed(song, prev, why):
    left = _restore(song, prev)
    if left is not None:
        why += "; the old loop could not be put back: %s" % left
    return OpError("failed", why)


def _number(args, key):
    v = args.get(key)
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise OpError("bad_request", "%s must be a number" % key)
    return float(v)


def loop_set(song, args):
    on = args.get("on")
    if not isinstance(on, bool):
        raise OpError("bad_request", "on must be true or false")
    start = _number(args, "start")
    length = _number(args, "length")
    if start < 0:
        raise OpError("bad_request", "start must be 0 or more")
    if length <= 0:
        raise OpError("bad_request", "length must be more than 0")
    prev = _loop(song)
    want = {"on": on, "start": start, "length": length}
    err = _write(song, want)
    if err is not None:
        raise _failed(song, prev, "Live refused the loop: %s" % err)
    try:
        song.loop = on
        got = _loop(song)
    except Exception as e:
        raise _failed(song, prev, "Live refused the loop: %s: %s" % (type(e).__name__, e))
    if not _same(got, want):
        raise _failed(song, prev, "Live did not keep the loop")
    return {"loop": got}
