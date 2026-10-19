"""`track_facts`: what the SDK cannot tell about tracks, for several tracks in one reply.

Args: {targets: [{scope, route, expectName?}, ...]} — route of length 1 each,
at most MAX_TARGETS entries (the reply must stay under the 4 KB datagram cap).
Result: {tracks: [entry, ...]} in the order of `targets`; an entry is
  {can_be_armed, is_foldable, is_grouped, arm}   (+ `name` only when no expectName was given)
or {error: {code, text}} for a target that is stale / out of range / malformed
/ unreadable, so one bad target does not hide the facts of the others. Entries
are fixed-size when `expectName` is given (the caller already has the name), so
a Set with long or non-ASCII names cannot push the reply over the datagram cap.

`arm` is null unless `can_be_armed` (reading `arm` raises in the LOM for tracks
that cannot be armed). `is_foldable` is true for group tracks; `is_grouped`
means the track sits inside a group. All three are from the LOM docs and still
to be confirmed in Live for the cases that matter (a MIDI track without an
input device, group tracks, the main track).
"""

from ..protocol import OpError
from ..routes import parse_target, resolve

MAX_TARGETS = 20


def _facts(track, with_name):
    can_be_armed = bool(track.can_be_armed)
    arm = None
    if can_be_armed:
        try:
            arm = bool(track.arm)
        except Exception:
            arm = None
    facts = {
        "can_be_armed": can_be_armed,
        "is_foldable": bool(track.is_foldable),
        "is_grouped": bool(track.is_grouped),
        "arm": arm,
    }
    if with_name:
        facts["name"] = track.name
    return facts


def _one(song, target):
    if not isinstance(target, dict):
        raise OpError("bad_request", "target must be an object")
    scope, route = parse_target(target)
    if len(route) != 1:
        raise OpError("bad_request", "track_facts takes track routes (length 1)")
    expect = target.get("expectName")
    if expect is not None and not isinstance(expect, str):
        raise OpError("bad_request", "expectName must be a string")
    track = resolve(song, scope, route)[0]
    if expect is not None and track.name != expect:
        raise OpError("stale", "name differs")
    return _facts(track, expect is None)


def track_facts(song, args):
    targets = args.get("targets")
    if not isinstance(targets, list) or not targets:
        raise OpError("bad_request", "targets must be a non-empty list")
    if len(targets) > MAX_TARGETS:
        raise OpError("bad_request", "at most %d targets per request" % MAX_TARGETS)
    entries = []
    for target in targets:
        try:
            entries.append(_one(song, target))
        except OpError as e:
            entries.append({"error": {"code": e.code, "text": e.text}})
        except Exception as e:  # an odd track must not hide the others
            entries.append({"error": {"code": "failed", "text": ("%s: %s" % (type(e).__name__, e))[:100]}})
    return {"tracks": entries}
