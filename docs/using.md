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

- **A full path is a target of its own.** `/Lead` is one target. Live's default track names carry their number,
  and cmdAbl keeps it: the track shown as "2 808 Core Kit" is `2-808 Core Kit`, and "1 Audio" is `1-Audio`. A path
  with spaces needs no quotes when it is the only target: `goto /2-808 Core Kit`. Among several targets, quote it:
  `solo /Bass "/2-808 Core Kit"`. `goto "/2-808 Core Kit"` works too.
- **`#2` picks a sibling with the same name.** Two tracks called Bass appear as `/Bass` and `/Bass#2`. A quoted or
  `/` text is still a target of its own, and that target can be ambiguous: `/Bass` asks when two tracks are named Bass.
- **Other words must match the path, and one must match the name.** For `mute`, `solo`, `arm`, `goto` and `lom`,
  every word you type must occur in the object's path, and at least one must occur in the object's own name.
  A word that is exactly the name of a top-level track is that track's full path, so it names the track even when
  other names contain it: `mute bass` names the track Bass, not the Bass Drum pad. This does not hold for objects
  further down: there a word matches every name that contains it. `mute lead` names the track Lead, not the devices
  and chains below it. `mute 808 snare` names the Snare Drum pad
  of the 808 kit: only that object holds both words in its path, and one of them in its own name.
- **Words typed together win when they match.** If they match exactly one object, the command runs on it without a
  question. If they match several, one pick list offers exactly those objects. Only when they match nothing together
  is each word its own target. A word that matches several objects then asks once, with one pick list: `mute drum`
  asks in a Set with the pads "Bass Drum" and "Snare Drum".
- **This can surprise.** In a Set with a group Drums that holds a track Kick, `mute drums kick` means the Kick, because
  the words match one object together. To mean both the group and the track, write `mute drums, kick`.
- **A comma always names several targets.** `mute bass, lead` names the track Bass and the track Lead.
- **`find` is a search.** It is looser on purpose: `find 808` lists everything whose path contains the word, the 808
  track and everything below it. `-t`, `-d` and `-c` narrow the list to tracks, devices or chains, and `-L` limits how
  far below a matching object the results go.

When a name matches more than one object, cmdAbl asks. It never picks one for you.

### Dash rules

- A word that starts with `-` is read as an option. `mute /Bass -6dB` is therefore an error, because `-6dB`
  is not a known option. Quote the name, or put `--` before it: `mute -- /Bass -6dB`.
- A lone `-` is an ordinary word. A track called `Hi - Hat` can be typed without quotes.
- `--` ends the options. Everything after it is a name.

## The pick list

The pick list opens when a name matches more than one object, or when nothing matches and cmdAbl has close
suggestions.

- **Filter.** Type to narrow the rows. `Space` types a space.
- **Move.** `↑` and `↓` move through the rows. In a list where you can mark several rows, the first arrow
  only enters the list, so `↓` and then `Space` marks the first row.
- **Mark.** In a list where you can mark rows, such as the list of `mute`, `solo` or `arm`, `Tab` marks a row, and so
  does `Space` once you are in the list. Only the marked rows are targets. The row under the cursor is not a
  target until you mark it.
- **Choose.** In a list where you can mark rows, `Enter` runs the command on the marked rows. With nothing marked,
  `Enter` runs nothing and the list stays open, and the hint asks you to mark a row. In a list where you pick one
  row, such as `goto` or "did you mean", `Enter` takes the row under the cursor.
- **Cancel.** `Esc` closes the list. Nothing runs and nothing is remembered.

The line above the filter shows the command that `Enter` will run, with the exact paths of the objects. You
can read it before you confirm.

**State buttons.** The lists of `mute`, `solo` and `arm` show a button at the right of each row, as Live's mixer does:
a speaker for mute, lit when the track is audible; an `S` for solo; a record dot for arm. When a row's state
cannot be read, it has no button. Once you mark rows, their buttons show the state that `Enter` would set. A dashed
ring marks each button that would change. Live does not change until you press `Enter`.

**One list per command.** If several of your names are ambiguous, you get one list for all of them, with the
matches of the whole pattern first. Answer it once.

**"Did you mean" in a mixed list.** If some of your names match several objects and one word is mistyped, its
suggestions join that list. Each suggestion row is tagged with its word and a question mark, for example `"bsas"?`. Only the marked
rows run, as in any multi-select list. `Esc` ends the command with the plain "nothing matches" answer. A word that
nothing fits at all fails at once, without a list.

**"Did you mean" alone.** When no name matches, the list shows the closest names instead. Nothing runs from that
list unless you choose a row. `Esc` gives the plain "nothing matches" answer. For `mute`, `solo` and `arm` this list
takes marks like any other multi-select list. For `goto`, `find` and `lom` it takes one row.

## Pads, chains and folding

Drum Rack pads and the chains of other racks are objects too. Their path goes through the track and the rack:

- `/2-808 Core Kit/808 Core Kit/Snare Drum` is the Snare Drum pad of the Drum Rack on the track `2-808 Core Kit`.
- `mute 808 snare` finds the same pad, because the two words name only that object.

Use `find` to list everything that matches a pattern:

- `find 808` lists every track, device and chain whose path contains `808`: the 808 track and everything below it.
- `find 808 -L 0` lists only the objects named `808`: the track and its Drum Rack.
- `find -c snare` lists only chains and drum pads.
- `find -t bass` lists only tracks, and `find -d 808` only devices.
- `next` and `prev` step through the last `find` list.

Selecting a pad or a chain does not change how the track is shown. Add `--unfold` to `goto` or `find` to show the
track's chains as columns in the Session mixer. Live stores this view state with the Set, so the Set counts as
changed. cmdAbl never folds the chains back. To fold them again, do it in Live.

## Tags

A tag marks what a track is, such as `fx` or `drums`. One command then reaches every track with that tag:
`mute #fx` mutes all tracks tagged `fx`, at once and without a list.

- `tag` lists every tag and the tracks that carry it.
- `tag /Lead` opens a list of tags, with buttons that show which ones Lead has. Mark the tags to switch with `Tab`,
  then press `Enter`.
- `tag /Lead fx synth` switches `fx` and `synth` on for Lead, or off where they are on.
- `tag --set 1 /Bass fx` makes sure Bass has `fx`. `tag --set 0 /Bass fx` removes it.
- `mute #fx, #drums` acts on the tracks tagged `fx` and the tracks tagged `drums`, together.
- `mute !#drums` acts on every regular track without the tag `drums`, untagged ones included. It never acts on the
  main track, and return tracks only when you name them by path.
- `mute drums` acts like `#drums` when `drums` is a tag and no track name matches it. A track such as "Drums Bus"
  brings up a list instead, with the tagged tracks first.
- `mute #` opens a list of the Set's tags. Mark the tags to act on.
- `mute --pick drums` shows every match in a list, and only the marked rows run.

**Adding a tag.** In the tag list of `tag <target>`, type a name that no tag matches exactly. The list then shows
`+ new tag "<name>"` as its last row.

- If that row is the only one, type the name and press `Enter` to add it.
- Otherwise press `↓` to reach the row, then `Enter`.
- Tags you marked before still come along.

In a Set without tags, the empty list says "type a new tag".

**Rules.**

- Tag names use lowercase letters, digits, `-` and `_`.
- Tags are stored in the Live Set. They are saved with the Set, copied by Cmd+D, and kept when a track is renamed.
  Regular, return and main tracks can carry tags.
- Tags need the Remote Script 0.1.5. After you update cmdAbl, run `cmdabl setup` once, then restart Live.
- Commands that act on one object, such as `goto`, and destructive commands still ask when a tag matches several
  tracks.
- Cmd+Z does not undo a tag change. The result prints the reverse command, for example
  `undo: tag --set 0 /Lead fx`. Each change also leaves an invisible step in Live's undo list, so Cmd+Z may need
  several presses, and Live asks you to save when you close the Set.
- A comma list before tag names is not supported yet: `tag /Lead, /Bass fx` fails. Use `#tag`, `!#tag` or `--pick`.

## Read a command's page

`<command> --help` and `man <command>` show the same page inside Live, offline: summary, usage, options, arguments
and examples. `man` adds notes and a web link to the command's section, and it finds a command by its words, so you
can name a subcommand too: `man history clear` or `man cmdabl setup`.

- `man ableton` opens the Live manual; `man ableton <words>` searches it for the words.
- `man cmdabl` opens the cmdAbl documentation.
- The web manuals need an internet connection. The command page does not.
- An unknown command answers with close matches under "Did you mean".

## Look up a Live Object Model path

`lom <target>` shows the Live Object Model path of a track, device or chain, and links to the Live Object Model
reference page for its kind. Use it when you write a script, or to check what cmdAbl sees. The
[Live API mapping](reference/live-api.md) shows how cmdAbl's ports and Remote Script operations map to the
Live Object Model.

## List the Set with `find -L`

`find -L <n>` lists the Set from the top: tracks, their devices, and the tracks inside groups.
Without a pattern, `find` needs `-L` or one of `-t`, `-d` or `-c`; a bare `find` is an error.

- `find -L 1` lists the top-level tracks.
- `find -L 2` lists the tracks and their devices.
- `find -t` lists all tracks.
- `find 808 -L 1` also lists what sits one level below those objects, such as the pads of the Drum Rack.

`-L` takes a whole number from 0 to 12 with a pattern, and from 1 without one. `find` needs the [Remote Script](remote-script.md). The
[command reference](reference/commands.md) has the full usage.

## Toggles, and what they do not do

- `mute`, `solo` and `arm` **toggle** each object they name: a muted track is unmuted, an unmuted one is muted.
- `--set 1` makes every named object muted, soloed or armed, whatever its state. `--set 0` switches them off. An
  object already in the wanted state counts as done. For example, `mute --set 1 /Bass, /Lead` mutes both, and
  `solo --set 0 /Bass` unsolos the Bass track. The history shows the option as `--set 0`; typing `--set=0` works too.
- `mute` and `solo` work on tracks, rack chains and Drum Rack pads. Chains and pads need the Remote Script
  and macOS.
- `arm` works on tracks only. Return, main and group tracks cannot be armed, and cmdAbl reports them as failed.

**Exclusive arm and solo are not applied.** If Live's "Exclusive" setting is on for arm or solo, cmdAbl does
not follow it. `arm /Bass /Lead` arms both tracks. `arm /Bass` does not disarm other tracks. Name every track you want
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

cmdAbl remembers the last 20 commands that worked and that had arguments. They appear at the top of the empty
palette, newest first.

- `↑` and `↓` choose a remembered line, and `Enter` runs it again.
- `Tab` puts the line into the prompt, so you can edit it first.

**What a remembered line keeps.**

- An object target (a track, a device, a chain or a pad) is kept by its full path. A rerun therefore never asks
  again, even if a later track has the same name.
- A tag target (`#fx`, `!#drums` or a bare tag word such as `mute drums`) and `--pick` are kept as you typed them.
  A rerun resolves them again: a track tagged since then is included, and `--pick` opens the list again.
- A `#` that you picked from the tag list is kept as the `#name` tags you chose.

**In memory only.** The history is kept in memory. It is gone when cmdAbl restarts. A history that survives
restarts is planned for 0.1.2.

### Clear, forget and restore

The `history` command manages the list. It has three subcommands:

- **`history clear`** removes all entries after a question. Removed entries can be brought back with
  `history restore` until cmdAbl restarts. `history clear --force` (or `-f`) asks nothing and drops the removed
  entries too, so they cannot be restored.
- **`history forget`** removes the newest entry without asking, for example after a mistyped command. `history forget -n 3`
  removes the newest three. `-n` takes a whole number from 1 to 20.
- **`history restore`** puts back the entries that the last `clear` or `forget` removed, until cmdAbl restarts.
  Without `-n` it restores everything that last removal took out. `history restore -n 2` brings back the two most
  recently removed entries. Entries keep their original order, and an entry that is already in the history again is
  not added twice.

The [command reference](reference/commands.md) has the full usage.
