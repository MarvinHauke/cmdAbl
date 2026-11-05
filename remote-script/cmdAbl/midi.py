"""MIDI in on the script's input port (plan 0018, spike).

What the script forwards (`forward_midi_cc` / `_note` / `_pitchbend` in `build_midi_map`), what it
remembers (a ring buffer of the last messages) and the two ops that go with it:

- `midi_listen {controls}`  which controls to forward (WRITES: it changes what Live does with the
                            port) and, as a side effect, where events are pushed to;
- `midi_last {since}`       the newest messages (the pull side, also for `--learn`).

No Live import here: `Live.MidiMap` is handed in by the surface, so everything is unit-tested.
Controls Live refuses to hand over (mapped with Cmd+M, or taken by another script) are reported as
`blocked` in the `midi_listen` reply (the result of the previous map build: Live builds the new map
later) and as a pushed `midi_blocked` event whenever the set changes.

Only the controls `midi_listen` names are forwarded (default: none). `monitor: true` forwards
everything for a short time (learn / `midi monitor`): the ring buffer then sees every message,
while only the listed controls are pushed. Live gives forwarded messages to the script only, so
while monitoring, other uses of the port (track input, Cmd+M) are paused, and every message is also pushed (marked `monitor`); it ends by itself
after `seconds` (default 30, at most 120) in case the extension went away.
"""

import time

from .protocol import OpError

CAPACITY = 50
MAX_CONTROLS = 256
MAX_REPLY_BYTES = 3500  # midi_last stays below the 4096-byte reply cap
MONITOR_DEFAULT_S = 30
MONITOR_MAX_S = 120
STATUS_INTERVAL_S = 0.05  # at most ~20 status bar updates a second
STATUS_PREFIX = "cmdAbl \u00b7 "

STATUS_NOTE_OFF = 0x80
STATUS_NOTE_ON = 0x90
STATUS_CC = 0xB0
STATUS_PITCHBEND = 0xE0

KINDS = ("cc", "note", "pb")


def parse_message(midi_bytes):
    """A raw MIDI message -> {type, channel (1-16), number, value}, or None (sysex, clock, short, junk).

    A note-on with velocity 0 is a note-off. Pitch bend has number 0 and the 14-bit value.
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
            return {"type": "note_off", "channel": channel, "number": number, "value": value}
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


def status_text(msg):
    """The status bar line for a message: 'cmdAbl · CC48 ch1 = 127', 'N36 ch10 on 100', 'N36 ch10 off', 'PB ch1 = 8192'."""
    t, ch, n, v = msg["type"], msg["channel"], msg["number"], msg["value"]
    if t == "cc":
        body = "CC%d ch%d = %d" % (n, ch, v)
    elif t == "note_on":
        body = "N%d ch%d on %d" % (n, ch, v)
    elif t == "note_off":
        body = "N%d ch%d off" % (n, ch)
    else:
        body = "PB ch%d = %d" % (ch, v)
    return STATUS_PREFIX + body


def control_label(kind, ch, n):
    """The control as the mapping syntax writes it: CC51/ch1, N60/ch2, PB/ch1."""
    if kind == "pb":
        return "PB/ch%d" % (ch + 1)
    return "%s%d/ch%d" % ("CC" if kind == "cc" else "N", n, ch + 1)


MAX_BLOCKED = 64


def control_key(msg):
    """The (kind, channel0, number) a parsed message belongs to, as `expand` writes controls."""
    kind = {"cc": "cc", "note_on": "note", "note_off": "note", "pb": "pb"}[msg["type"]]
    return (kind, msg["channel"] - 1, None if kind == "pb" else msg["number"])


class MidiService(object):
    """The listened set, the monitor window, the ring buffer and the push target. One per surface."""

    def __init__(self, clock=time.time, capacity=CAPACITY):
        self._clock = clock
        self._capacity = capacity
        self._buffer = []
        self._seq = 0
        self.spec = "none"
        self._wanted = set()
        self._monitor_until = 0.0
        self._status = True  # show messages in Live's status bar while a monitor window is open
        self._status_last = 0.0
        self._status_pending = None
        self._status_off = False
        self.peer = None  # (host, port) of the extension that last called midi_listen
        # Controls Live did not give to the script (the user mapped them with Cmd+M, or another script has them):
        # None = the forward calls do not say; a list = the listened controls that were refused in the last build.
        self.blocked = []
        self._blocked_sent = []
        self.forward_errors = 0

    def monitoring(self):
        return self._monitor_until > 0.0 and self._clock() < self._monitor_until

    def tick(self):
        """Main thread, every update_display: True once when the monitor window just ended (the map must be rebuilt)."""
        if self._monitor_until > 0.0 and self._clock() >= self._monitor_until:
            if self._status:
                self._status_off = True
            self._monitor_until = 0.0
            self._status_pending = None
            return True
        return False

    # -- the status bar (main thread): the surface shows what these return -----------------------

    def status_for(self, msg):
        """The text to show for a message now, or None (no window, status off, or throttled: the latest waits for status_flush)."""
        if not (self._status and self.monitoring()):
            return None
        text = status_text(msg)
        now = self._clock()
        if now - self._status_last >= STATUS_INTERVAL_S:
            self._status_last = now
            self._status_pending = None
            return text
        self._status_pending = text
        return None

    def status_flush(self):
        """Every update_display: 'monitor off' once after a window with status ended, else the throttled latest value."""
        if self._status_off:
            self._status_off = False
            self._status_pending = None
            return STATUS_PREFIX + "monitor off"
        if self._status_pending is not None and self._status and self.monitoring():
            now = self._clock()
            if now - self._status_last >= STATUS_INTERVAL_S:
                text, self._status_pending, self._status_last = self._status_pending, None, now
                return text
        return None

    # -- Live's callbacks ------------------------------------------------

    def build_map(self, midi_map, script_handle, map_handle):
        """Forward the listened controls (all of them while monitoring). `midi_map` is `Live.MidiMap`. Returns how many.

        The forward calls should answer with a bool (False = Live refused: the control is mapped elsewhere). A listened
        control that was refused goes into `self.blocked` (while monitoring, any refused control does); when no call answers with a bool, `blocked` is None (unknown).
        """
        count = 0
        refused, others = [], []
        answered = False
        self.forward_errors = 0
        for kind, ch, n in expand("all" if self.monitoring() else self.spec):
            try:
                if kind == "cc":
                    ok = midi_map.forward_midi_cc(script_handle, map_handle, ch, n)
                elif kind == "note":
                    ok = midi_map.forward_midi_note(script_handle, map_handle, ch, n)
                else:
                    ok = midi_map.forward_midi_pitchbend(script_handle, map_handle, ch)
            except Exception:
                self.forward_errors += 1
                ok = False
            count += 1
            if isinstance(ok, bool):
                answered = True
                if not ok:
                    (refused if (kind, ch, n) in self._wanted else others).append(control_label(kind, ch, n))
        # Listened controls come first, so a cap never hides one; while monitoring, every refused control counts
        # (the monitor shows what Live keeps for itself), otherwise only the listened ones.
        found = refused + (others if self.monitoring() else [])
        self.blocked = found[:MAX_BLOCKED] if (answered or count == 0) else None
        return count

    def take_blocked_change(self):
        """(True, blocked) once when the blocked set differs from the one last reported, else (False, None)."""
        if self.blocked == self._blocked_sent:
            return False, None
        self._blocked_sent = list(self.blocked) if self.blocked is not None else None
        return True, self.blocked

    def receive(self, midi_bytes):
        """One incoming message -> the stored event (with seq and the receive time in ms), or None.

        Every parsed message goes into the ring; `wanted` says whether it is also pushed.
        """
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

    def wanted(self, msg):
        return control_key(msg) in self._wanted

    # -- the ops -----------------------------------------------------------

    def op_listen(self, args, peer):
        spec = parse_controls(args.get("controls"))
        monitor = args.get("monitor", False)
        if not isinstance(monitor, bool):
            raise OpError("bad_request", "monitor must be true or false")
        seconds = args.get("seconds", MONITOR_DEFAULT_S)
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not 1 <= seconds <= MONITOR_MAX_S:
            raise OpError("bad_request", "seconds must be 1-%d" % MONITOR_MAX_S)
        status = args.get("status", True)
        if not isinstance(status, bool):
            raise OpError("bad_request", "status must be true or false")
        was_showing = self._status and self.monitoring()
        self.spec = spec
        self._wanted = set(expand(spec))
        self._monitor_until = self._clock() + seconds if monitor else 0.0
        self._status = status
        self._status_pending = None
        if was_showing and not (status and monitor):
            self._status_off = True  # a window that showed values was ended early: say so once
        if monitor and status:
            self._status_off = False  # a new window opened before the old "monitor off" was shown
        if peer is not None:
            self.peer = peer
        return {"count": len(expand("all" if monitor else spec)), "monitor": monitor, "blocked": self.blocked}

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
