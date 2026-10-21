# cmdAbl

**A command palette for Ableton Live.** Press `:` while Live is focused, type a command, and it acts on your Set.

![Screen recording of the palette: mute drums mutes the drum tracks, solo !#drums solos the other tracks, and mute --pick #drums opens a pick list where rows are marked and Enter applies](assets/images/hero.gif)

## Why cmdAbl

- **Tags that group your tracks.** `tag /Lead fx synth` tags a track. Then `mute #fx` reaches every `fx` track at
  once, and `mute !#drums` every regular track without the tag. `tag -l` opens the tag board.
- **A pick list you control.** When a name fits more than one object, cmdAbl asks instead of guessing. The buttons
  show the state `Enter` would set, and nothing changes in Live until you press `Enter`.
- **Community extensions, one list.** `pakabl` installs Ableton Live extensions from a curated community list.

[Get started](getting-started.md) walks through the install step by step.

## A short session

Type each line in the palette and press `Enter`:

```
cmdabl setup                  set up the keyboard key and the Remote Script (once, after installing)
goto /Lead                    select the track Lead
mute /Bass                    toggle the mute of the track Bass
mute --set 0 /Bass            make sure Bass is not muted, whatever its state is now
tag /Kick drums               tag the track Kick as drums (do the same for Snare)
mute drums                    mute every track tagged drums
tag -l                        open the tag board
```

## Pages

- [Getting started](getting-started.md): install cmdAbl, set up the key and the Remote Script, and run your first
  commands.
- [Using cmdAbl](using.md): the palette, how names are written, the pick list, pads and chains, `find`, tags, the
  log and the history.
- [Remote Script](remote-script.md): what it does, how to update and check it, and what its messages mean.
- Reference:
    - [Commands](reference/commands.md): every command, generated from the code.
    - [Remote Script](reference/remote-script.md): the operations of the Remote Script.
    - [Live API mapping](reference/live-api.md): how cmdAbl's paths map to the Live Object Model.
- [Architecture](architecture.md): how cmdAbl is built, for people who want to extend it.
- [Guides](guides/README.md): writing a command, releasing cmdAbl, the pakabl index and CI.
- [Known limits](limits.md): what does not work yet, and macOS only for now.
