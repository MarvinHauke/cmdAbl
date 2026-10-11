"""`select`: make an object the selected one in Live, and read it back.

Args: {scope, route, expectName}. `expectName` is the name the extension saw
when it built its tree; if the object at the route has another name the Live
Set changed in between and nothing is selected (`stale`).
Result: {name} of what Live reports as selected after the change. If the
read-back is not the requested object the reply is `failed`.

Route length: 1 track, 2 device on the track, 3 chain (selected in its rack's
view), 4+ device inside a chain (see routes.py). Parent groups are unfolded
first so the object is visible. Live's objects are wrappers, so the read-back compares with
`!=`, never `is not`. A `failed` or `unsupported` device/chain select may already have
selected the track (partial change); the caller must not claim "nothing changed".
"""

from ..protocol import OpError
from ..routes import parse_target, resolve, unfold_parents


def _fail(text):
    return OpError("failed", text)


def select(song, args):
    scope, route = parse_target(args)
    expect = args.get("expectName")
    if expect is not None and not isinstance(expect, str):
        raise OpError("bad_request", "expectName must be a string")
    path = resolve(song, scope, route)
    target = path[-1]
    if expect is not None and target.name != expect:
        raise OpError("stale", "expected %r, found %r" % (expect, target.name))
    track = path[0]
    unfold_parents(track)
    view = song.view
    if len(route) == 1:
        view.selected_track = track
        if view.selected_track != track:
            raise _fail("Live did not select the track")
    elif len(route) % 2 == 0:  # a device
        view.selected_track = track
        view.select_device(target)
        if track.view.selected_device != target:
            raise _fail("Live did not select the device")
    else:  # a chain: show it in its rack's view
        rack = path[-2]
        view.selected_track = track
        view.select_device(rack)
        try:
            rack.view.selected_chain = target
        except Exception as e:
            raise OpError("unsupported", "cannot select a chain here: %s" % e)
        if rack.view.selected_chain != target:
            raise _fail("Live did not select the chain")
    return {"name": target.name}
