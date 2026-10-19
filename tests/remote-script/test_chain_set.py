import json
import unittest

from fake_live import FakeChain, FakeDevice, FakeSong, FakeTrack
from cmdAbl import protocol
from cmdAbl.ops import OPS, WRITES
from cmdAbl.ops.chains import MAX_SET_TARGETS, chain_set, chains
from cmdAbl import access_token as token_mod
import os
import stat
import tempfile

TOKEN = "t" * 32


def song_with_rack():
    chains_ = [FakeChain("Kick"), FakeChain("Snare")]
    rack = FakeDevice("Drum Rack", chains=chains_, drum=True)
    return FakeSong(tracks=[FakeTrack("Vermona", devices=[rack])]), chains_


def ask(song, op, args, token=TOKEN, given=None, with_token=True):
    a = dict(args)
    if with_token:
        a["token"] = TOKEN if given is None else given
    data = json.dumps({"v": 1, "id": "i", "op": op, "args": a}).encode()
    ops = {n: (lambda args, fn=fn: fn(song, args)) for n, fn in OPS.items()}
    reply, _ = protocol.handle_request(data, ops, WRITES, token)
    return json.loads(reply)


class ChainSet(unittest.TestCase):
    def test_set_mute_and_solo_with_read_back(self):
        song, cs = song_with_rack()
        r = ask(song, "chain_set", {"targets": [
            {"scope": "regular", "route": [0, 0, 1], "expectName": "Snare", "mute": True},
            {"scope": "regular", "route": [0, 0, 0], "expectName": "Kick", "solo": True, "mute": False},
        ]})
        self.assertTrue(r["ok"])
        self.assertEqual(r["result"]["chains"], [
            {"name": "Snare", "mute": True, "solo": False},
            {"name": "Kick", "mute": False, "solo": True},
        ])
        self.assertTrue(cs[1].mute)
        self.assertTrue(cs[0].solo)

    def test_several_targets_are_one_undo_step(self):
        song, cs = song_with_rack()
        song.undo_steps = []
        ask(song, "chain_set", {"targets": [
            {"route": [0, 0, 0], "expectName": "Kick", "mute": True},
            {"route": [0, 0, 1], "expectName": "Snare", "mute": True},
            {"route": [0, 0, 9], "expectName": "x", "mute": True},
        ]})
        self.assertEqual(song.undo_steps, ["begin", "end"])  # also closed when a target failed

    def test_stale_changes_nothing_and_errors_are_entries(self):
        song, cs = song_with_rack()
        r = ask(song, "chain_set", {"targets": [
            {"route": [0, 0, 0], "expectName": "Old", "mute": True},
            {"route": [0, 0, 9], "expectName": "x", "mute": True},
            {"route": [0, 0], "expectName": "x", "mute": True},
            {"route": [0, 0, 0], "mute": True},
            {"route": [0, 0, 0], "expectName": "Kick"},
            {"route": [0, 0, 0], "expectName": "Kick", "mute": "yes"},
            {"route": [0, 0, 1], "expectName": "Snare", "mute": True},
        ]})
        codes = [e.get("error", {}).get("code") for e in r["result"]["chains"]]
        self.assertEqual(codes, ["stale", "out_of_range", "bad_request", "bad_request", "bad_request", "bad_request", None])
        self.assertFalse(cs[0].mute)
        self.assertTrue(cs[1].mute)

    def test_read_back_differs_is_failed(self):
        song, cs = song_with_rack()
        cs[0].ignore_writes = True
        r = ask(song, "chain_set", {"targets": [{"route": [0, 0, 0], "expectName": "Kick", "mute": True}]})
        self.assertEqual(r["result"]["chains"][0]["error"]["code"], "failed")

    def test_request_shape(self):
        song, _ = song_with_rack()
        for args in ({}, {"targets": []}, {"targets": [{"route": [0, 0, 0]}] * (MAX_SET_TARGETS + 1)}):
            r = ask(song, "chain_set", args)
            self.assertEqual(r["error"]["code"], "bad_request")

    def test_chains_reply_carries_mute_and_solo_only_when_on(self):
        song, cs = song_with_rack()
        cs[1].mute = True
        cs[0].solo = True
        e = chains(song, {"targets": [{"route": [0, 0]}]})["racks"][0]["chains"]
        self.assertEqual(e[0], {"name": "Kick", "solo": True})
        self.assertEqual(e[1], {"name": "Snare", "mute": True})


class Token(unittest.TestCase):
    def test_writing_op_needs_the_token(self):
        song, cs = song_with_rack()
        args = {"targets": [{"route": [0, 0, 0], "expectName": "Kick", "mute": True}]}
        for kw in ({"with_token": False}, {"given": "wrong"}, {"given": ""}):
            r = ask(song, "chain_set", args, **kw)
            self.assertEqual(r["error"]["code"], "forbidden")
        self.assertFalse(cs[0].mute)
        self.assertEqual(ask(song, "chain_set", args, token=None)["error"]["code"], "forbidden")  # no token exists
        self.assertTrue(ask(song, "chain_set", args)["ok"])

    def test_through_the_surface_a_write_without_token_is_forbidden(self):
        from test_surface import surface

        song, cs = song_with_rack()
        msg = json.dumps({"v": 1, "id": "s", "op": "chain_set", "args": {"targets": [{"route": [0, 0, 0], "expectName": "Kick", "mute": True}]}}).encode()
        s = surface(song, [(msg, ("h", 1))])
        s._drain_socket()
        self.assertEqual(s._socket.sent[0][0]["error"]["code"], "forbidden")
        self.assertFalse(cs[0].mute)

    def test_a_token_that_cannot_be_encoded_is_just_wrong(self):
        data = json.dumps({"v": 1, "id": "i", "op": "w", "args": {"token": "\ud800"}}).encode()
        reply, _ = protocol.handle_request(data, {"w": lambda a: {}}, {"w"}, TOKEN)
        self.assertEqual(json.loads(reply)["error"]["code"], "forbidden")

    def test_reads_and_select_need_no_token(self):
        song, _ = song_with_rack()
        self.assertTrue(ask(song, "chains", {"targets": [{"route": [0, 0]}]}, with_token=False)["ok"])
        self.assertTrue(ask(song, "select", {"route": [0], "expectName": "Vermona"}, with_token=False)["ok"])

    def test_the_token_never_reaches_a_handler_or_a_reply(self):
        seen = []
        data = json.dumps({"v": 1, "id": "i", "op": "w", "args": {"token": TOKEN, "x": 1}}).encode()
        reply, _ = protocol.handle_request(data, {"w": lambda a: seen.append(dict(a)) or {}}, {"w"}, TOKEN)
        self.assertEqual(seen, [{"x": 1}])
        self.assertNotIn(TOKEN.encode(), reply)
        wrong, _ = protocol.handle_request(data.replace(TOKEN.encode(), b"nope"), {"w": lambda a: {}}, {"w"}, TOKEN)
        self.assertNotIn(TOKEN.encode(), wrong)

    def test_token_file_is_private_and_outside_the_script_folder(self):
        with tempfile.TemporaryDirectory() as home:
            token = token_mod.create_token(home, "darwin")
            self.assertEqual(len(token), 32)
            path = token_mod.token_path(home)
            self.assertEqual(
                path,
                os.path.join(home, "Library", "Application Support", "Ableton", "Extensions Data", "marvinhauke.cmdabl", "bridge-token"),
            )
            self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(path)).st_mode), 0o700)
            self.assertEqual(open(path).read(), token)
            self.assertNotEqual(token_mod.create_token(home, "darwin"), token)  # new per start
            self.assertEqual(os.listdir(os.path.dirname(path)), ["bridge-token"])  # no temp file left behind

    def test_extension_id_follows_manifest_json(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "..", "manifest.json")) as f:
            manifest = json.load(f)
        self.assertEqual(token_mod.EXTENSION_ID, ("%s.%s" % (manifest["author"], manifest["name"])).lower())

    def test_the_old_token_file_is_removed_best_effort(self):
        with tempfile.TemporaryDirectory() as home:
            old = token_mod.legacy_token_path(home)
            os.makedirs(os.path.dirname(old))
            with open(old, "w") as f:
                f.write("a" * 32)
            token_mod.create_token(home, "darwin")
            self.assertFalse(os.path.exists(old))
            self.assertFalse(os.path.exists(os.path.dirname(old)))  # the emptied folder goes too
        with tempfile.TemporaryDirectory() as home:
            self.assertTrue(token_mod.create_token(home, "darwin"))  # nothing to remove: no error

    def test_no_token_off_macos_or_when_the_write_fails(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertIsNone(token_mod.create_token(home, "win32"))
            self.assertFalse(os.path.exists(os.path.join(home, "Library")))
            blocker = os.path.join(home, "Library")
            open(blocker, "w").close()  # a file where the directory must go
            self.assertIsNone(token_mod.create_token(home, "darwin"))

    def test_script_folder_is_not_used(self):
        here = os.path.dirname(token_mod.__file__)
        self.assertFalse(token_mod.token_path().startswith(here))


class Ops(unittest.TestCase):
    def test_hello_lists_chain_set_and_it_is_a_writing_op(self):
        self.assertIn("chain_set", OPS)
        self.assertEqual(set(WRITES), {"chain_set"})


if __name__ == "__main__":
    unittest.main()
