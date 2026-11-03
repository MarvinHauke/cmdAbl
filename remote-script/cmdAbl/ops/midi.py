"""midi_listen, midi_last: the MIDI ops (plan 0018). They need the surface's MidiService, so they
take a context as third argument (`wants_context`, see cmdabl.py); the logic is in ../midi.py."""

from ..protocol import OpError


def _service(ctx):
    midi = getattr(ctx, "midi", None)
    if midi is None:
        raise OpError("failed", "MIDI is not available")
    return midi


def midi_listen(song, args, ctx):
    """Which controls the script forwards; the caller becomes the target of pushed events. Asks Live to rebuild the MIDI map."""
    result = _service(ctx).op_listen(args, getattr(ctx, "peer", None))
    ctx.rebuild_map()
    return result


def midi_last(song, args, ctx):
    """The newest MIDI messages after `since` (a seq): [[seq, type, channel, number, value, t], …]."""
    return _service(ctx).op_last(args)


midi_listen.wants_context = True
midi_last.wants_context = True
