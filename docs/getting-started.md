# Getting started

cmdAbl is a command palette for Ableton Live. You type a short line such as `mute /Bass`, and cmdAbl
runs it on the Set that is open. This page takes you from installing cmdAbl to your first three
commands.

## What you need

- A Mac. cmdAbl has been tested on macOS only.
- A version of Ableton Live with Extensions support. The Extensions SDK is in beta; cmdAbl is built against
  version 1.0.0-beta.1 of it.
- [Karabiner-Elements](https://karabiner-elements.pqrs.org) (free), for the `:` key. You can still open
  the palette without it, from a context menu (step 4).

## 1. Install the extension

Download the latest `.ablx` file from the
[Releases page](https://github.com/MarvinHauke/cmdAbl/releases/latest). Then open Live's **Settings → Extensions**
and either drag the `.ablx` file onto the box that says "Drag and drop to install", or click **Choose file** and pick
it. `cmdabl` then appears under "Installed Extensions". If an older cmdAbl is installed, remove it first and restart Live.

![Live's Settings → Extensions page: the box for dropping an extension, with a Choose file button, and the list of installed extensions, which includes cmdabl](assets/images/extensions-install.png)

*Settings → Extensions: drag the `.ablx` onto the box, or click Choose file.*

## 2. Run `cmdabl setup`

Open the palette (step 4 below). Type `cmdabl setup` and press `Enter`. The command does two things:

- **Keyboard trigger.** On macOS it links cmdAbl's Karabiner rule into Karabiner-Elements. If
  Karabiner-Elements is not installed, the message says so and nothing is linked. Run the command
  again after you install it.
- **Remote Script.** It copies the companion Remote Script into Live's User Library, in
  `~/Music/Ableton/User Library/Remote Scripts/cmdAbl`. The Remote Script lets cmdAbl select tracks
  and read chains. Step 3 explains how to turn it on.

The command ends with one line of advice. Which line you see depends on what it finds:

- *Installed and running:* nothing to do. If you have just updated cmdAbl, restart Live once.
- *Installed, but Live still runs an older version:* restart Live.
- *Installed, but not running:* restart Live if you have not done so since, then enable cmdAbl as a
  control surface (step 3).
- *Not installed:* run `cmdabl setup` again and read the messages above the advice.
- *An older copy is installed:* read the lines above the advice, then restart Live.

Then enable the keyboard rule. In Karabiner-Elements, open **Complex Modifications → Add predefined rule**,
choose **cmdAbl**, and click **Enable**. The rule opens the palette with `:` (Shift+period, which types `:` on
German (QWERTZ) keyboards) while Ableton Live is focused.

## 3. Turn on the Remote Script in Live

The copied script does not appear in Live's Control Surface list until Live restarts. Do both steps:

1. **Restart Live.** After the restart, cmdAbl appears in the Control Surface list.
2. Open **Settings → Tempo & MIDI → MIDI**. Under **Control Surface**, choose **cmdAbl**. Leave
   Input and Output set to *None*. Choosing it starts the script; you do not need to restart Live again.

Live's log shows `cmdAbl bridge listening on 127.0.0.1:27185` once the link is active. The log is at
`~/Library/Preferences/Ableton/Live <version>/Log.txt`, where `<version>` is your Live version; the Remote Script's
lines contain `RemoteScriptMessage: (cmdAbl)`. To check the link too, see
[Check the Remote Script](#check-the-remote-script) below.

![Live's Settings, Tempo & MIDI page, MIDI section: slot 1 has Control Surface set to cmdAbl and Input and Output set to None](assets/images/control-surface.png)

*Settings → Tempo & MIDI → MIDI: Control Surface set to cmdAbl, Input and Output set to None.*

## 4. Open the palette

There are two ways to open the palette:

- **Keyboard.** With Live focused, press `:` (Shift+period on German keyboards). This needs the
  Karabiner rule from step 2.
- **Context menu.** Right-click a clip, a track, a clip slot or a scene, and choose **: cmdAbl**.

In the palette:

| Key | What it does |
| --- | ------------ |
| Type | filters commands and objects of the Set |
| `Tab` | completes the selected item into the input |
| `Enter` | runs the typed line or the selected item |
| `↑` / `↓` | moves through the list |
| `Esc` | closes the palette without running anything |

![The palette open with the text Sub typed: tracks, devices and chains whose names or paths contain Sub appear as rows, with their track or path in grey](assets/images/palette.png)

*Type part of a name: tracks, devices and chains appear as rows. Enter selects the highlighted one.*

## 5. Try three commands

Start with these three. Type each one in the palette and press `Enter`.

**`help`** lists every command with a one-line summary. Type a command followed by `--help`, for example
`mute --help`, to see its full usage. This works without the Remote Script.

**`goto <track>`** selects a track in Live. A full path such as `goto /Lead` selects one track. Partial names work
too, and `goto` needs the Remote Script.

**`mute <target>`** toggles the mute of a track. It also takes rack chains and Drum Rack pads, which need the
Remote Script and macOS. Type `mute /Bass` once to mute it, and again to unmute it. To set the state without toggling, use `mute --set 1 /Bass` or `mute --set 0 /Bass`. `mute` works on tracks without the Remote Script.

When a name matches more than one object, cmdAbl shows a **pick list** instead of guessing. Type to
filter, press `↑` and `↓` to move, `Enter` to choose and `Esc` to cancel. Commands that take several
tracks, such as `mute`, let you mark more than one row with `Tab`.

![The pick list for mute midi, with two matching tracks, 2-MIDI and 3-MIDI, and the command line above the filter](assets/images/pick-list.png)

*A name that matches two tracks opens the pick list. The line above the filter shows the command that Enter will run.*

## Check the Remote Script

Run `cmdabl bridge` in the palette. It sends one request to the Remote Script and reports the script's
version, the protocol version, the response time and the operations it supports. If the reply says the
script is not installed, outdated or not running, follow the message. Restart Live when the message
says so, then run `cmdabl bridge` again.

## What works without the Remote Script

The palette, `help`, `man`, the history of past commands and the track commands work without the Remote Script:

- `mute`, `solo` and `arm` work on tracks. Return, main and group tracks cannot be armed.
- Track selection does not work. `goto`, `find`, `next` and `prev` report that the Remote Script is not
  running, not installed or outdated, and do not select anything.
- Picking a Live object in the palette does not select it either. It reports the same message.
- `mute` and `solo` on rack chains and Drum Rack pads also need the Remote Script, and they work on
  macOS only.

With the Remote Script, `arm` also reports tracks that Live will not arm, such as a MIDI track whose
input device is unavailable.

## Next steps

- [Architecture](architecture.md) explains how cmdAbl is built, for people who want to extend it.
- [Guides](guides/README.md) cover writing a command, releasing cmdAbl and the pakabl index.

## Install more extensions with pakabl

pakabl installs Ableton Live extensions (`.ablx` files) from cmdAbl's curated list of community repositories.
Run `pakabl update` once to fetch the list. Then `pakabl list` shows the extensions, with buttons to install,
update or remove each one. Update appears only when the list holds a newer version than the installed one. If the
installed version is newer than the list's, the row says so, and cmdAbl never downgrades it. To install the list's
version anyway, even when it is older, use `pakabl upgrade <id>@<version>` with exactly the version the list shows. Restart Live after a change.

![The pakabl extension index window: a scrollable list of extensions, each with its name, version and id, and an Install and a Repo button for each, with a Close button at the bottom](assets/images/pakabl-list.png)

*Install installs the extension. Repo opens its GitHub page.*

Installing through pakabl writes into Live's Extensions folder, which works today. Ableton has announced a
stricter sandbox for extensions. If it arrives, installing through pakabl may be blocked in a later version of
Live. pakabl as a whole may then stop working. See [Known limits](limits.md).
