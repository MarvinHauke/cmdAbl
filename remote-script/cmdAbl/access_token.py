"""The access token for writing operations (0001 §9).

(Not called `token.py`: that would shadow Python's standard `token` module, which
`traceback` needs, whenever this folder is on `sys.path`.)

Created when the script starts, a new one per Live start, written to
`~/Library/Application Support/Ableton/Extensions Data/marvinhauke.cmdabl/bridge-token`
(directory 0700, file 0600): the one tree outside its bundle that the installed,
sandboxed Extension Host may read (the host runs with Node's permission model;
the old place, `~/Library/Application Support/cmdAbl/`, was refused). The
directory name is the extension's id (author.name from manifest.json). Outside
the repository in every setup, never inside the script's own folder (a
development install links that folder into the repo). The value is never logged
and never put in a reply. Other platforms: no token, writing
operations are refused with `forbidden` (0.1.0 is macOS-only).
"""

import os
import secrets
import sys


# The extension's id: lower-case author + "." + name from manifest.json (a test checks it).
EXTENSION_ID = "marvinhauke.cmdabl"


def token_path(home=None):
    home = home or os.path.expanduser("~")
    return os.path.join(home, "Library", "Application Support", "Ableton", "Extensions Data", EXTENSION_ID, "bridge-token")


def legacy_token_path(home=None):
    """Where 0.1.0 and 0.1.1 wrote the token (unreadable for the installed host)."""
    home = home or os.path.expanduser("~")
    return os.path.join(home, "Library", "Application Support", "cmdAbl", "bridge-token")


def _remove_legacy(home):
    # Best effort: a stale token in a place nobody reads any more is just clutter.
    path = legacy_token_path(home)
    try:
        os.unlink(path)
    except OSError:
        return
    try:
        os.rmdir(os.path.dirname(path))
    except OSError:
        pass


def create_token(home=None, platform=None):
    """Write a fresh token file and return the token, or None (not macOS, or the write failed)."""
    if (platform or sys.platform) != "darwin":
        return None
    path = token_path(home)
    directory = os.path.dirname(path)
    try:
        os.makedirs(directory, mode=0o700, exist_ok=True)
        os.chmod(directory, 0o700)
        token = secrets.token_hex(16)
        tmp = path + ".tmp"
        try:
            os.unlink(tmp)  # never write into a leftover file with other permissions
        except FileNotFoundError:
            pass
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            os.write(fd, token.encode("ascii"))
        finally:
            os.close(fd)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
        _remove_legacy(home)
        return token
    except Exception:
        return None
