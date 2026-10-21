"""The operation list. `hello` reports exactly these names.

Each handler is `fn(song, args) -> dict` and may raise protocol.OpError. They
import nothing from Live, so they are tested with fakes (tests/remote-script).
Adding an op: handler here, typed function in src/ableton/bridgeOps.ts, a test
on each side, 0001 §4 first, and VERSION in protocol.py goes up. An op that changes or deletes
something goes into WRITES (the protocol layer then demands the access token before the handler
runs) and requires `expectName`.
"""

from .chains import chain_set, chains
from .select import select
from .tags import tags_all, tags_set
from .tracks import track_facts

OPS = {
    "chain_set": chain_set,
    "chains": chains,
    "select": select,
    "track_facts": track_facts,
    "tags_all": tags_all,
    "tags_set": tags_set,
}

# Ops that change something: refused without the access token (protocol.handle_request).
WRITES = frozenset(["chain_set", "tags_set"])
