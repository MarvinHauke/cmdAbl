"""`param_display`: Live's own display text for values of a mixer parameter, without moving it.

Args: {scope, route (length 1), param, values: [number], expectName?}
  `param` is "volume" for now; "pan" and the sends can join the table in `_param` later.
Result: {strings: [text]} in the order of `values`, each text
  `DeviceParameter.str_for_value(value)` of the track's parameter ("-6.0 dB", "-inf dB").
It reads only: `str_for_value` computes the text, the fader does not move. A value must be a
finite number inside the parameter's `min`..`max`. At most MAX_VALUES values per call (the reply
must stay under the 4 KB datagram cap); the caller sends chunks.
"""

import math

from ..protocol import OpError
from ..routes import parse_target, resolve

MAX_VALUES = 64


def _param(track, name):
    """The parameter object for `name`; raises bad_request for an unknown one."""
    if name == "volume":
        return track.mixer_device.volume
    raise OpError("bad_request", "param must be one of: volume")


def param_display(song, args):
    scope, route = parse_target(args)
    if len(route) != 1:
        raise OpError("bad_request", "param_display takes track routes (length 1)")
    name = args.get("param")
    if not isinstance(name, str):
        raise OpError("bad_request", "param is required")
    values = args.get("values")
    if not isinstance(values, list) or not values:
        raise OpError("bad_request", "values must be a non-empty list of numbers")
    if len(values) > MAX_VALUES:
        raise OpError("bad_request", "at most %d values per call" % MAX_VALUES)
    for v in values:
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise OpError("bad_request", "values must be finite numbers")
    expect = args.get("expectName")
    if expect is not None and not isinstance(expect, str):
        raise OpError("bad_request", "expectName must be a string")
    track = resolve(song, scope, route)[0]
    if expect is not None and track.name != expect:
        raise OpError("stale", "name differs")
    param = _param(track, name)
    try:
        low, high = param.min, param.max
    except Exception as e:
        raise OpError("failed", "cannot read the range of %s: %s: %s" % (name, type(e).__name__, e))
    for v in values:
        if v < low or v > high:
            raise OpError("bad_request", "values must be between %s and %s" % (low, high))
    strings = []
    for v in values:
        try:
            strings.append(str(param.str_for_value(float(v))))
        except Exception as e:
            raise OpError("failed", "str_for_value failed: %s: %s" % (type(e).__name__, e))
    return {"strings": strings}
