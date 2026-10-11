"""The operation list. `hello` reports exactly these names.

Each handler is `fn(song, args) -> dict` and may raise protocol.OpError. They
import nothing from Live, so they are tested with fakes (tests/remote-script).
Adding an op: handler here, typed function in src/ableton/bridgeOps.ts, a test
on each side, 0001 §4 first, and VERSION in protocol.py goes up. `expectName` is optional for `select`;
the first op that changes or deletes something must require it.
"""

from .select import select

OPS = {
    "select": select,
}
