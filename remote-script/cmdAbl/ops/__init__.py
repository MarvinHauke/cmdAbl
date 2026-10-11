"""The operation list. `hello` reports exactly these names.

Each handler is `fn(song, args) -> dict` and may raise protocol.OpError. They
import nothing from Live, so they are tested with fakes (tests/remote-script).
"""

OPS = {}
