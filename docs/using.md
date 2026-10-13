# Using cmdAbl

This page is for daily use, after [Getting started](getting-started.md). It covers how to type a command,
how to name the objects of your Set, what the pick list asks, and what the palette remembers. The exact
usage of every command is in the [command reference](reference/commands.md). Type `<command> --help` in the
palette for the same text.

## Open the palette

Press `:` with Live focused, or choose **: cmdAbl** from the context menu of a clip, a track, a clip slot or a
scene. Type a command and press `Enter`. `Esc` closes it without running anything.

## Type a command, or pick a row

The palette shows two kinds of rows:

- **Commands**, such as `mute` or `help`.
- **Objects of the Set**: a track, a device, a rack chain or a Drum Rack pad. Picking one of these runs
  `goto` on it, so it selects that object in Live. Selecting needs the [Remote Script](remote-script.md).

If the highlighted row is an object, Enter selects it. If it is a command you did not choose (with `↑` and `↓`,
`Tab` or a click), and what you typed is not only the start of its name, Enter runs the line as you typed it. With
an empty input, Enter runs the highlighted row.

After a command runs, the palette closes. Nothing stays open except a message or a pick list.

## Name the objects

A command takes objects as text. cmdAbl reads that text as follows:

- **A full path is a target of its own.** `/Vermona/Kick` is one target. `#2` picks the second of two
  siblings with the same name: `/Drums/Kick#2`. A name with spaces needs no quotes for one target:
  `goto /Opal Lead`. Quotes or a leading `/` make the text one target of its own, and that target can still be
  ambiguous: `/Drums/Kick` with two siblings named Kick asks.
- **Other words must match the path, and one must match the name.** For `mute`, `solo`, `arm`, `goto`, `lom` and
  `tree`, every word you type must occur in the object's path, and at least one must occur in the object's own
  name. `mute e-piano` names the track E-Piano, not the devices and chains below it. `mute vermona kick` names
  the Kick pad on the track Vermona.
- **Two readings ask once.** If the words typed together name an object, and each word also names something on its
  own, cmdAbl asks once, with one pick list: the joined object first, then each word's. If no object matches the
  words together, each word is its own target: `mute kick snare` mutes the Kick and the Snare.
- **A comma always separates targets.** `mute vermona, kick` names the track Vermona and the Kick.
- **`find` is a search.** It is looser on purpose: `find vermona` lists everything whose path contains the word,
  the track and everything below it. `-t`, `-d` and `-c` narrow the list to tracks, devices or chains.

When a name matches more than one object, cmdAbl asks. It never picks one for you.

### Dash rules

- A word that starts with `-` is read as an option. `mute /Bass -6dB` is therefore an error, because `-6dB`
  is not a known option. Quote the name, or put `--` before it: `mute -- /Bass -6dB`.
- A lone `-` is an ordinary word. A track called `Kick - Sub` can be typed without quotes.
- `--` ends the options. Everything after it is a name.

## The pick list

The pick list opens when a name matches more than one object, or when nothing matches and cmdAbl has close
suggestions.

- **Filter.** Type to narrow the rows. `Space` types a space.
- **Move.** `↑` and `↓` move through the rows. In a list where you can mark several rows, the first arrow
  only enters the list, so `↓` and then `Space` marks the first row.
- **Mark.** `Tab` marks a row, and so does `Space` once you are in the list. Marking several rows runs the
  command on all of them.
- **Choose.** `Enter` runs the command with the marked rows. With nothing marked, the row under the cursor.
- **Cancel.** `Esc` closes the list. Nothing runs and nothing is remembered.

The line above the filter shows the command that `Enter` will run, with the exact paths of the objects. You
can read it before you confirm.

**One list per command.** If several of your names are ambiguous, you get one list for all of them, with the
matches of the whole pattern first. Answer it once.

**"Did you mean".** When nothing matches, the list shows the closest names instead. Nothing runs from that
list unless you choose a row. `Esc` gives the plain "nothing matches" answer.

## Pads, chains and folding

Drum Rack pads and the chains of other racks are objects too. Their path goes through the track and the rack:

- `/Drums/Drum Rack/Kick` is the Kick pad of the Drum Rack on the track `Drums`.
- `mute kick` finds the same pad when `kick` is the only match.

Use `find` to list everything that matches a pattern:

- `find kick` lists every track, device and chain whose path contains `kick`.
- `find -c kick` lists only chains and drum pads.
- `find -t kick` lists only tracks, and `find -d kick` only devices.
- `next` and `prev` step through the last `find` list.

Selecting a pad or a chain does not change how the track is shown. Add `--unfold` to `goto` or `find` to show the
track's chains as columns in the Session mixer. Live stores this view state with the Set, so the Set counts as
changed. cmdAbl never folds the chains back. To fold them again, do it in Live.

## Look up a Live Object Model path

`lom <target>` shows the Live Object Model path of a track, device or chain, and links to the Live Object Model
reference page for its kind. Use it when you write a script, or to check what cmdAbl sees. The
[Live API mapping](reference/live-api.md) shows how cmdAbl's ports and Remote Script operations map to the
Live Object Model.

## See the Set as a tree

`tree` lists the Set as an indented tree: tracks, their devices, and the chains and pads of racks. It shows two
levels by default. `tree /Vermona MIDI` starts at one track, and `-L` sets how many levels to show, from 1 to 12.
A long listing is cut with a hint; pass a path or a smaller `-L`. Chains and pads appear only while the Remote
Script runs. The [command reference](reference/commands.md) has the full usage.

## Toggles, and what they do not do

- `mute`, `solo` and `arm` **toggle** each object they name: a muted track is unmuted, an unmuted one is muted.
- `--set 1` makes every named object muted, soloed or armed, whatever its state. `--set 0` switches them off. An
  object already in the wanted state counts as done. For example, `mute --set 1 /Kick, /Snare` mutes both, and
  `solo --set 0 /Kick` unsolos the Kick.
- `mute` and `solo` work on tracks, rack chains and Drum Rack pads. Chains and pads need the Remote Script
  and macOS.
- `arm` works on tracks only. Return, main and group tracks cannot be armed, and cmdAbl reports them as failed.

**Exclusive arm and solo are not applied.** If Live's "Exclusive" setting is on for arm or solo, cmdAbl does
not follow it. `arm /a /b` arms both tracks. `arm /a` does not disarm other tracks. Name every track you want
explicitly. This is a choice, like Cmd-clicking the buttons in Live.

## What the palette tells you

After a command runs, cmdAbl shows a short message only when there is something to say:

- **It worked.** A successful command with no message shows nothing.
- **It failed.** A message says why, and for several objects it lists each one with a tick or a cross.
- **It could not find the object.** The name matches nothing, and no suggestion helped.
- **It needs the Remote Script.** The Remote Script is missing, outdated or not running. See the
  [Remote Script](remote-script.md) page for what to do.

A name that matches more than one object does not produce an error: the pick list answers it.

## History

cmdAbl remembers the last 20 commands that worked and that had arguments. They appear at the top of the palette,
newest first, so you can run one again.

- A remembered line holds the exact objects, each by its full path. A rerun therefore never asks again, even if
  a later track has the same name.
- The history is kept in memory. It is cleared when the extension reloads, for example when Live restarts.

Use `↑` and `↓` to choose a remembered line and `Enter` to run it again.
