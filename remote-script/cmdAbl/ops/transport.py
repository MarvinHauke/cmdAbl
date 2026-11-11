"""`transport` and `loop_set`: the play state, the bar grid and the arrangement loop (plan 0013 "Stamps").

transport   Args: {} (a read; no token).
            Result: {playing, session, pos, time, barStart, barLen, loop: {on, start, length}}.
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
        "loop": _loop(song),
    }


def _restore(song, prev):
    """Put the loop back as it was after a failed write; never raises."""
    try:
        song.loop_length = prev["length"]
        song.loop_start = prev["start"]
        song.loop_length = prev["length"]
        song.loop = prev["on"]
    except Exception:
        pass


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
    try:
        song.loop_start = start
        song.loop_length = length
        song.loop = on
        got = _loop(song)
    except Exception as e:
        _restore(song, prev)
        raise OpError("failed", "Live refused the loop: %s: %s" % (type(e).__name__, e))
    if got["on"] != on or abs(got["start"] - start) > 1e-6 or abs(got["length"] - length) > 1e-6:
        _restore(song, prev)
        raise OpError("failed", "Live did not keep the loop")
    return {"loop": got}
