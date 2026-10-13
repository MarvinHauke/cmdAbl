"""Fakes for the Remote Script tests: Live objects and the `_Framework` stub.

Importing this module installs a stub `_Framework.ControlSurface` so the
`cmdAbl` package (which Live loads) can be imported without Live.
"""

import os
import sys
import types

sys.dont_write_bytecode = True  # never leave __pycache__ in the packaged remote-script folder

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "remote-script")
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class _ControlSurface(object):
    def __init__(self, c_instance=None):
        self.logged = []
        self._song = None

    def song(self):
        return self._song

    def log_message(self, text):
        self.logged.append(text)

    def update_display(self):
        pass

    def disconnect(self):
        pass


def _install_stub():
    if "_Framework" in sys.modules:
        return
    framework = types.ModuleType("_Framework")
    module = types.ModuleType("_Framework.ControlSurface")
    module.ControlSurface = _ControlSurface
    framework.ControlSurface = module
    sys.modules["_Framework"] = framework
    sys.modules["_Framework.ControlSurface"] = module


_install_stub()


class FakeDeviceView(object):
    def __init__(self):
        self.selected_chain = None


class FakeDevice(object):
    """A device. A rack (`chains` given) behaves like the LOM: `can_have_drum_pads` is always
    readable, `has_drum_pads` raises (not AttributeError) unless it is a Drum Rack."""

    def __init__(self, name, chains=None, drum=False):
        self.name = name
        self.view = FakeDeviceView()
        self._drum = drum
        if chains is not None:
            self.chains = chains
        self.devices = []

    @property
    def can_have_drum_pads(self):
        return self._drum

    @property
    def has_drum_pads(self):
        if not self._drum:
            raise RuntimeError("has_drum_pads is only available for Drum Racks")
        return True


class FakeChain(object):
    def __init__(self, name, devices=None, in_note=None):
        self.name = name
        self.devices = devices or []
        self.mute = False
        self.solo = False
        self.ignore_writes = False  # simulate Live not applying a change
        if in_note is not None:
            self.in_note = in_note

    def __setattr__(self, key, value):
        if key in ("mute", "solo") and self.__dict__.get("ignore_writes"):
            return
        object.__setattr__(self, key, value)


class FakeTrackView(object):
    def __init__(self):
        self.selected_device = None


class FakeTrack(object):
    def __init__(self, name, devices=None, group=None, foldable=False, can_be_armed=True, arm=False):
        self.name = name
        self.devices = devices or []
        self.group_track = group
        self.is_foldable = foldable
        self.fold_state = 0
        self.view = FakeTrackView()
        self.can_be_armed = can_be_armed
        self._arm = arm
        self.can_show_chains = any(hasattr(d, "chains") for d in self.devices)
        self.is_showing_chains = False

    @property
    def is_grouped(self):
        return self.group_track is not None

    @property
    def arm(self):
        if not self.can_be_armed:
            raise RuntimeError("arm is not available on this track")
        return self._arm


class FakeSongView(object):
    def __init__(self, song):
        self._song = song
        self.selected_track = None
        self.refuse = False  # simulate Live ignoring the selection

    def select_device(self, device):
        if self.refuse:
            return
        for track in self._song.all_tracks():
            if self._contains(track.devices, device):
                track.view.selected_device = device

    def _contains(self, devices, device):
        for d in devices:
            if d is device:
                return True
            for chain in getattr(d, "chains", []):
                if self._contains(chain.devices, device):
                    return True
        return False


class FakeSong(object):
    undo_steps = None  # set to [] to record begin/end calls

    def begin_undo_step(self):
        if self.undo_steps is not None:
            self.undo_steps.append("begin")

    def end_undo_step(self):
        if self.undo_steps is not None:
            self.undo_steps.append("end")

    def __init__(self, tracks=None, returns=None, master=None):
        self.tracks = tracks or []
        self.return_tracks = returns or []
        self.master_track = master or FakeTrack("Master")
        self.view = FakeSongView(self)

    def all_tracks(self):
        return list(self.tracks) + list(self.return_tracks) + [self.master_track]
