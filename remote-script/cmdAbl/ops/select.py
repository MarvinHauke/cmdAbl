"""`select`: make an object the selected one in Live, and read it back.

Args: {scope, route, expectName}. `expectName` is the name the extension saw
when it built its tree; if the object at the route has another name the Live
Set changed in between and nothing is selected (`stale`).
Result: {name} of what Live reports as selected after the change. If the
read-back is not the requested object the reply is `failed`.

Optional `showChains: true` (default false): after a successful selection the
track's chains are shown in the Session mixer (`Track.is_showing_chains`) when
the track can show them and does not already. Never folds anything. The reply
then has `is_showing_chains` (the LOM's name): true (shown now or already), false (the write did not
take) or null (the track cannot show chains, or reading failed). It never
turns a successful selection into a failure. View state, not a writing op.

Route length: 1 track, 2 device on the track, 3 chain (selected in its rack's
view), 4+ device inside a chain (see routes.py). For a target nested in
chains, the enclosing chains are shown first, outermost first (best effort). Parent groups are unfolded
first so the object is visible. Live's objects are wrappers, so the read-back compares with
`!=`, never `is not`. A `failed` or `unsupported` device/chain select may already have
selected the track (partial change); the caller must not claim "nothing changed".
"""

from ..protocol import OpError
from ..routes import parse_target, resolve, unfold_parents


def _fail(text):
    return OpError("failed", text)


def _show_chains(track):
    try:
        if not track.can_show_chains:
            return None
        if track.is_showing_chains:
            return True
        track.is_showing_chains = True
        return bool(track.is_showing_chains)
    except Exception:
        return None


def _select_ancestor_chains(view, path):
    """Show every enclosing chain of the target, outermost first (a rack nested in a chain is
    only reachable once the chain around it is the one its rack shows). Best effort: a refusal
    here is not an error, the final read-back of the target decides."""
    for i in range(2, len(path) - 1, 2):
        try:
            view.select_device(path[i - 1])
            path[i - 1].view.selected_chain = path[i]
        except Exception:
            pass


def select(song, args):
    scope, route = parse_target(args)
    expect = args.get("expectName")
    if expect is not None and not isinstance(expect, str):
        raise OpError("bad_request", "expectName must be a string")
    show = args.get("showChains", False)
    if not isinstance(show, bool):
        raise OpError("bad_request", "showChains must be true or false")
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
        _select_ancestor_chains(view, path)
        view.select_device(target)
        if track.view.selected_device != target:
            raise _fail("Live did not select the device")
    else:  # a chain: show it in its rack's view
        rack = path[-2]
        view.selected_track = track
        _select_ancestor_chains(view, path)
        view.select_device(rack)
        try:
            rack.view.selected_chain = target
        except Exception as e:
            raise OpError("unsupported", "cannot select a chain here: %s" % e)
        try:
            selected = rack.view.selected_chain
        except Exception as e:
            raise OpError("unsupported", "cannot read the selected chain: %s" % e)
        if selected != target:
            raise _fail("Live did not select the chain")
    result = {"name": target.name}
    if show:
        result["is_showing_chains"] = _show_chains(track)
    return result
