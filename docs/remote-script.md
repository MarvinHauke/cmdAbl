# The Remote Script

cmdAbl has two parts. The extension runs inside Live and handles the palette. The Remote Script is a small
Python script that runs inside Live as well, and does the jobs the Extensions SDK cannot do. This page explains
what it does, how to install and update it, and what its messages mean.

## Why it exists

The Extensions SDK cannot do some things that cmdAbl needs:

- **Select.** The SDK cannot change the track selection, so `goto`, `find`, `next` and `prev` need the Remote
  Script to select a track, a device, a rack chain or a Drum Rack pad.
- **Chains and pads.** The SDK cannot set the mute or solo of a rack chain or a Drum Rack pad, so `mute` and
  `solo` use the Remote Script for them.
- **Facts the SDK does not show.** Live can refuse to arm a track, for example a MIDI track whose input device
  is missing. The SDK reads back "armed" in that case. The Remote Script reads the real state, so `arm` can
  report the track as failed.

The Remote Script talks to the extension over a local socket, and only on your Mac. See
[how the two talk](#how-the-two-talk) below.

## What works without it

Without the Remote Script the palette still opens and most commands run:

- `mute`, `solo` and `arm` work on tracks. `arm` cannot warn about tracks that Live refuses to arm.
- `mute` and `solo` on rack chains and Drum Rack pads do not work.
- `goto`, `find`, `next` and `prev` do not select anything. They answer that the Remote Script is not running.
  In the installed extension this is the expected answer: by the permission list it cannot look into the User Library, so it cannot tell a
  missing or outdated script from a stopped one. A development run (`npm start`) can also answer "not installed"
  or "outdated".
- Picking a row that selects an object in the palette gives the same answer.

## Install it

Run `cmdabl setup` from the palette. It copies the Remote Script into Live's User Library, at
`~/Music/Ableton/User Library/Remote Scripts/cmdAbl`. The command then tells you what to do next.

Then restart Live, and choose **cmdAbl** under **Control Surface** in **Settings → Tempo & MIDI → MIDI**.
Choosing it starts the script; you do not need to restart Live again. The
[Getting started](getting-started.md) page has the steps with screenshots.

## Update it

After you update cmdAbl, run `cmdabl setup` again, then **restart Live**. Live keeps the script it loaded
when it started, so a new copy in the User Library does nothing until Live restarts. `cmdabl setup` checks
the versions and says whether a restart is needed.

The current script is version 0.1.6. An installed 0.1.5 shows as outdated in `cmdabl bridge`: run `cmdabl setup`,
then restart Live.

## Check it

Run `cmdabl bridge` in the palette. It sends one request to the Remote Script and reports the script's version,
the protocol version, the response time, and the operations the script supports. A healthy reply means the
script is installed, running and answering.

## Messages

These are the messages you can get. Each is shown in the palette, with what to do:

| Message | What it means | What to do |
| ------- | ------------- | ---------- |
| *Remote Script not installed; run `cmdabl setup` and restart Live* | The script is not in the User Library. Only a development run (`npm start`) shows this; the installed extension says "not running" instead. | Run `cmdabl setup`, then restart Live. |
| *installed Remote Script is outdated; run `cmdabl setup` and restart Live* | The copy in the User Library is not the version this cmdAbl ships. Only a development run (`npm start`) shows this; the installed extension says "not running" instead. | Run `cmdabl setup`, then restart Live. |
| *Remote Script not running (install it with `cmdabl setup`, restart Live, then enable cmdAbl as a Control Surface in Live's Settings → Tempo & MIDI)* | The script is not answering in Live. The installed extension cannot tell "not installed" from "not enabled", so the message lists the full order. | Run `cmdabl setup` if it is not installed, restart Live, then choose cmdAbl as the Control Surface (Settings → Tempo & MIDI → MIDI). |
| *the Live Set changed; run the command again* | The track or pad moved or was renamed after you typed the command. | Run the command again. |
| *the Remote Script did not answer; check Live* | Live did not reply in time. | Check that Live is running and not busy. Then run the command again. A change may or may not have happened, so look at the Set. |
| *the Remote Script refused the change (access token); restart Live (after `cmdabl setup` if the script was updated)* | The script refused a change, because its access token did not match. | Restart Live. After an update, run `cmdabl setup` first. |
| *cannot read the bridge access token (CODE); restart Live (after `cmdabl setup` if the script was updated)* | The extension cannot read the token file. CODE says why: `ERR_ACCESS_DENIED` (the sandbox refused the path), `ENOENT` (no file: the script has not written one), or `wrong shape` (the file does not hold a valid token). | Restart Live. After an update, run `cmdabl setup` first. |
| *changing chains is available on macOS only (no access token on this platform)* | Chain and pad changes need macOS. | Nothing to do on this platform. |

The Remote Script writes its own messages to Live's log. Open `~/Library/Preferences/Ableton/Live <version>/Log.txt`,
where `<version>` is your Live version. Its lines contain `RemoteScriptMessage: (cmdAbl)`, after the time and level that Live writes in front.

## The access token

Some operations change the Set: they set the mute or solo of a chain, for example. Before the script runs such an
operation, it checks a token that the extension sends with the request.

- **Where it lives.** When Live starts, the script creates a new random token and writes it to
  `~/Library/Application Support/Ableton/Extensions Data/marvinhauke.cmdabl/bridge-token`. The folder is readable
  only by you, and so is the file. The installed extension is sandboxed and may read this folder, so the token
  lives there. The older place, `~/Library/Application Support/cmdAbl/`, is
  removed by the script.
- **When it changes.** Every time Live starts, the token is replaced. If a change is refused, the extension
  reads the file again and tries once more, so a restart of Live is usually all it takes.
- **What to do.** Never share the token file, and never paste its contents anywhere. You do not need to read it.
  If a change is refused, restart Live. After an update, run `cmdabl setup` first.

The token guards against other users on the Mac and against stray messages. It does not guard against programs
you run yourself, which can change your Set in other ways anyway.

Reads and track selection need no token.

## How the two talk

The extension and the Remote Script exchange messages over UDP, on `127.0.0.1`, port `27185`. Only programs on
your own Mac can reach that port, and the script answers only on that address. Each request asks for one
operation and gets one reply. A request that gets no reply within half a second is reported as unanswered.

The full list of operations, with what each does, is in the [Remote Script reference](reference/remote-script.md).
The [Live API mapping](reference/live-api.md) shows how cmdAbl's paths map to the Live Object Model.
It is generated from the code of the cmdAbl version this documentation was built from. The operations your installed
script supports are the ones `cmdabl bridge` lists.
