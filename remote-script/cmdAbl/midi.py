"""MIDI in on the script's input port (plan 0018, spike).

What the script forwards (`forward_midi_cc` / `_note` / `_pitchbend` in `build_midi_map`), what it
remembers (a ring buffer of the last messages) and the two ops that go with it:

- `midi_listen {controls}`  which controls to forward (WRITES: it changes what Live does with the
                            port) and, as a side effect, where events are pushed to;
- `midi_last {since}`       the newest messages (the pull side, also for `--learn`).

No Live import here: `Live.MidiMap` is handed in by the surface, so everything is unit-tested.
Spike: the default is "all" controls, so the monitor sees everything; a release build starts with
"none" until `midi_listen` asks for controls.
"""

import time

from .protocol import OpError

CAPACITY = 50
MAX_CONTROLS = 256
MAX_REPLY_BYTES = 3500  # midi_last stays below the 4096-byte reply cap
DEFAULT_CONTROLS = "all"

STATUS_NOTE_OFF = 0x80
STATUS_NOTE_ON = 0x90
STATUS_CC = 0xB0
STATUS_PITCHBEND = 0xE0

KINDS = ("cc", "note", "pb")


def parse_message(midi_bytes):
    """A raw MIDI message -> {type, channel (1-16), number, value}, or None (sysex, clock, short, junk).

    A note-on with velocity 0 is a note-off (`vel0` says so). Pitch bend has number 0 and the 14-bit value.
    """
    try:
        if not midi_bytes or len(midi_bytes) < 2:
            return None
        status = int(midi_bytes[0])
        kind = status & 0xF0
        channel = (status & 0x0F) + 1
        if kind in (STATUS_NOTE_OFF, STATUS_NOTE_ON, STATUS_CC):
            if len(midi_bytes) < 3:
                return None
            number, value = int(midi_bytes[1]) & 0x7F, int(midi_bytes[2]) & 0x7F
            if kind == STATUS_CC:
                return {"type": "cc", "channel": channel, "number": number, "value": value}
            if kind == STATUS_NOTE_ON and value > 0:
                return {"type": "note_on", "channel": channel, "number": number, "value": value}
            msg = {"type": "note_off", "channel": channel, "number": number, "value": value}
            if kind == STATUS_NOTE_ON:
                msg["vel0"] = True
            return msg
        if kind == STATUS_PITCHBEND:
            if len(midi_bytes) < 3:
                return None
            return {"type": "pb", "channel": channel, "number": 0, "value": (int(midi_bytes[2]) & 0x7F) << 7 | (int(midi_bytes[1]) & 0x7F)}
    except (TypeError, ValueError):
        pass
    return None


def parse_controls(controls):
    """The `controls` argument -> "all", "none" or a list of (kind, channel0, number) with None = every one.

    A list holds {"type": "cc"|"note"|"pb", "channel": 1-16 (omitted = all), "number": 0-127 (omitted = all)}.
    Raises OpError(bad_request).
    """
    if controls in ("all", "none"):
        return controls
    if not isinstance(controls, list) or len(controls) > MAX_CONTROLS:
        raise OpError("bad_request", "controls must be \"all\", \"none\" or a list of at most %d entries" % MAX_CONTROLS)
    out = []
    for c in controls:
        if not isinstance(c, dict) or c.get("type") not in KINDS:
            raise OpError("bad_request", "each control needs a type: cc, note or pb")
        channel, number = c.get("channel"), c.get("number")
        if channel is not None and (isinstance(channel, bool) or not isinstance(channel, int) or not 1 <= channel <= 16):
            raise OpError("bad_request", "channel must be 1-16")
        if number is not None and (isinstance(number, bool) or not isinstance(number, int) or not 0 <= number <= 127):
            raise OpError("bad_request", "number must be 0-127")
        out.append((c["type"], None if channel is None else channel - 1, number))
    return out


def expand(controls):
    """parse_controls() output -> the (kind, channel0, number) triples to forward (number None for pitch bend)."""
    if controls == "none":
        return []
    if controls == "all":
        controls = [("cc", None, None), ("note", None, None), ("pb", None, None)]
    seen, out = set(), []
    for kind, channel, number in controls:
        for ch in (range(16) if channel is None else [channel]):
            if kind == "pb":
                items = [None]
            else:
                items = range(128) if number is None else [number]
            for n in items:
                key = (kind, ch, n)
                if key not in seen:
                    seen.add(key)
                    out.append(key)
    return out


class MidiService(object):
    """The forwarded set, the ring buffer and the push target. One per surface."""

    def __init__(self, clock=time.time, capacity=CAPACITY):
        self._clock = clock
        self._capacity = capacity
        self._buffer = []
        self._seq = 0
        self.spec = DEFAULT_CONTROLS if DEFAULT_CONTROLS in ("all", "none") else parse_controls(DEFAULT_CONTROLS)
        self.peer = None  # (host, port) of the extension that last called midi_listen

    # -- Live's callbacks ------------------------------------------------

    def build_map(self, midi_map, script_handle, map_handle):
        """Forward the chosen controls. `midi_map` is `Live.MidiMap`. Returns how many were forwarded."""
        count = 0
        for kind, ch, n in expand(self.spec):
            if kind == "cc":
                midi_map.forward_midi_cc(script_handle, map_handle, ch, n)
            elif kind == "note":
                midi_map.forward_midi_note(script_handle, map_handle, ch, n)
            else:
                midi_map.forward_midi_pitchbend(script_handle, map_handle, ch)
            count += 1
        return count

    def receive(self, midi_bytes):
        """One incoming message -> the stored event (with seq and the receive time in ms), or None."""
        t = self._clock() * 1000.0
        msg = parse_message(midi_bytes)
        if msg is None:
            return None
        self._seq += 1
        msg["seq"] = self._seq
        msg["t"] = round(t, 3)
        self._buffer.append(msg)
        del self._buffer[: -self._capacity]
        return msg

    # -- the ops -----------------------------------------------------------

    def op_listen(self, args, peer):
        spec = parse_controls(args.get("controls"))
        self.spec = spec
        if peer is not None:
            self.peer = peer
        return {"count": len(expand(spec)), "all": spec == "all"}

    def op_last(self, args):
        since = args.get("since", 0)
        if isinstance(since, bool) or not isinstance(since, int) or since < 0:
            raise OpError("bad_request", "since must be a non-negative integer (a seq)")
        rows = [
            [m["seq"], m["type"], m["channel"], m["number"], m["value"], m["t"]]
            for m in self._buffer
            if m["seq"] > since
        ]
        # Rows are [seq, type, channel, number, value, t]; the oldest go first when the reply would not fit.
        while rows and len(repr(rows)) > MAX_REPLY_BYTES:
            rows.pop(0)
        return {"last": self._seq, "messages": rows}
