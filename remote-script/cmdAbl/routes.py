"""Turn `{scope, route}` into Live objects (no Live imports; the song is passed in).

A route alternates: track index, device index, chain index, device index, ...
starting in the collection `scope` names (song.tracks / return_tracks / master).
Its length says what it points at: 1 track, 2 device on the track, 3 chain,
4 device in a chain, ... A route that does not exist raises
OpError("out_of_range"); a bad shape raises OpError("bad_request").
"""

from .protocol import OpError

SCOPES = ("regular", "return", "master")


def rack_chains(device):
    """The chains of a rack device, or None when it is not one.

    Guarded: some LOM properties raise something other than AttributeError when they do not
    apply, which getattr's default does not catch.
    """
    try:
        return getattr(device, "chains", None)
    except Exception:
        return None


def tracks_for_scope(song, scope):
    if scope == "return":
        return song.return_tracks
    if scope == "master":
        return [song.master_track]
    return song.tracks


def unfold_parents(track):
    # A track inside a folded Group Track is hidden in the UI even when
    # selected, so walk up the chain of enclosing groups and unfold each.
    group = track.group_track
    while group:
        if group.is_foldable and group.fold_state:
            group.fold_state = 0
        group = group.group_track


def parse_target(args):
    """Validate `scope` and `route` from request args; returns (scope, route)."""
    scope = args.get("scope", "regular")
    route = args.get("route")
    if scope not in SCOPES:
        raise OpError("bad_request", "unknown scope %r" % (scope,))
    if (
        not isinstance(route, list)
        or not route
        or not all(isinstance(i, int) and not isinstance(i, bool) for i in route)
    ):
        raise OpError("bad_request", "route must be a non-empty list of integers")
    return scope, route


def _item(seq, index, what):
    if index < 0 or index >= len(seq):
        raise OpError("out_of_range", "%s %d does not exist" % (what, index))
    return seq[index]


def resolve(song, scope, route):
    """Walk the route (validated by parse_target first). Returns a list of the objects on the way: [track, device, chain, ...]."""
    track = _item(tracks_for_scope(song, scope), route[0], "track")
    path = [track]
    current = track
    for depth, index in enumerate(route[1:], start=1):
        if depth % 2 == 1:  # a device of a track or chain
            current = _item(current.devices, index, "device")
        else:  # a chain of a rack device
            chains = rack_chains(current)
            if chains is None:
                raise OpError("out_of_range", "device has no chains")
            current = _item(chains, index, "chain")
        path.append(current)
    return path
