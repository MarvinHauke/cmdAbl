"""cmdAbl bridge — a minimal Live Remote Script.

The Extensions SDK cannot change Live's selection, so cmdAbl ships this
companion Remote Script. It listens on a local UDP socket and applies
selection commands from the extension to the Live Set (the LOM exposes
`song.view.selected_track`, which the SDK does not).
"""

from .cmdabl import cmdAbl


def create_instance(c_instance):
    return cmdAbl(c_instance)
