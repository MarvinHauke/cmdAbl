"""`chains`: the real names of the chains of rack devices, for several racks in one reply.

Args: {targets: [{scope, route, offset?}, ...]} — each route addresses a rack
device (even length: track, device, [chain, device]...), at most MAX_TARGETS.
Result: {racks: [entry, ...]} in the order of `targets`; an entry is
  {kind: "rack" | "drum", total, offset, chains: [{name, note?}], next?}
or {error: {code, text}}. `chains` are the rack's own `chains` in order, so the
index of an entry is offset + its position, the same index as the SDK's
`rack.chains` (the extension checks `total` against its own count). The name is
the chain's own `name`, never the name of its first device. `note` is the
chain's `in_note` for drum chains, when Live reports it.

The reply is built under a byte budget shared by all entries: when a rack's
names do not fit, the entry stops early and carries `next` (the offset to ask
for again). That keeps every reply under the 4 KB datagram cap whatever the
names look like.
A single chain name longer than the whole budget is not handled (it would end in
`too_large`); Live names are far shorter.
"""

import json

from ..protocol import OpError
from ..routes import parse_target, resolve

MAX_TARGETS = 20
BUDGET_BYTES = 3600  # of the 4096-byte reply cap; the envelope ({"v":..,"id":..,"ok":..}) uses the rest
STUB_BYTES = 16  # {"next":12345},  — an unanswered rack's entry


def _size(obj):
    return len(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) + 1


def _chain_entry(chain, drum):
    entry = {"name": chain.name}
    if drum:
        note = getattr(chain, "in_note", None)
        if isinstance(note, int) and not isinstance(note, bool):
            entry["note"] = note
    return entry


def _plan(song, target):
    """Validate and resolve one target: ("rack", device, chains, offset, drum) or an error entry."""
    try:
        if not isinstance(target, dict):
            raise OpError("bad_request", "target must be an object")
        scope, route = parse_target(target)
        if len(route) % 2 != 0:
            raise OpError("bad_request", "chains takes device routes (even length)")
        offset = target.get("offset", 0)
        if not isinstance(offset, int) or isinstance(offset, bool) or offset < 0:
            raise OpError("bad_request", "offset must be a non-negative integer")
        device = resolve(song, scope, route)[-1]
        chains = getattr(device, "chains", None)
        if chains is None:
            raise OpError("unsupported", "not a rack device")
        return ("rack", device, chains, offset, bool(getattr(device, "has_drum_pads", False)))
    except OpError as e:
        return {"error": {"code": e.code, "text": e.text}}
    except Exception as e:  # an odd device must not hide the others
        return {"error": {"code": "failed", "text": ("%s: %s" % (type(e).__name__, e))[:100]}}


def chains(song, args):
    targets = args.get("targets")
    if not isinstance(targets, list) or not targets:
        raise OpError("bad_request", "targets must be a non-empty list")
    if len(targets) > MAX_TARGETS:
        raise OpError("bad_request", "at most %d targets per request" % MAX_TARGETS)
    plans = [_plan(song, t) for t in targets]
    # Charge the error entries first; every rack still to come reserves a stub, so the reply
    # always has one entry per target and stays under the cap whatever the names look like.
    budget = BUDGET_BYTES - sum(_size(p) for p in plans if isinstance(p, dict))
    racks_left = sum(1 for p in plans if not isinstance(p, dict))
    entries = []
    first = True
    for plan in plans:
        if isinstance(plan, dict):
            entries.append(plan)
            continue
        _, device, chain_list, offset, drum = plan
        racks_left -= 1
        total = len(chain_list)
        kind = "drum" if drum else "rack"
        available = budget - STUB_BYTES * racks_left
        head = {"kind": kind, "total": total, "offset": offset, "chains": [], "next": total}
        out = []
        used = _size(head)
        if offset < total:
            for position in range(offset, total):
                entry = _chain_entry(chain_list[position], drum)
                size = _size(entry)
                # the first entry of the request always goes out, so every request makes progress
                if (out or not first) and used + size > available:
                    break
                out.append(entry)
                used += size
            if not out:
                stub = {"next": offset}
                entries.append(stub)
                budget -= _size(stub)
                continue
        first = False
        result = {"kind": kind, "total": total, "offset": offset, "chains": out}
        if offset + len(out) < total:
            result["next"] = offset + len(out)
        entries.append(result)
        budget -= _size(result)
    return {"racks": entries}
