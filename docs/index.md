# cmdAbl

cmdAbl is a command palette for Ableton Live. Press `:` while Live is focused and type a command.

![Live's Session view with the cmdAbl palette open: the command prompt above a list of commands with one-line summaries](assets/images/hero.png)

- It runs on the open Set. You name tracks, devices, rack chains and Drum Rack pads by their names or paths.
- Commands select, mute, solo and arm objects, find them, and show their Live Object Model path.
- A pick list asks you when a name matches more than one object. It never guesses.
- It is built on the Ableton Extensions SDK, with a small Remote Script for what the SDK cannot do. macOS only for now.
- Community extensions for Live can be installed with `pakabl`.

## A short session

Type each line in the palette and press `Enter`:

```
cmdabl setup         set up the keyboard key and the Remote Script (once, after installing)
goto /Lead           select the track Lead
mute /Bass           toggle the mute of the track Bass
mute --set 0 /Bass   unmute it, whatever its state is now
find -c snare        list every chain and drum pad whose path contains "snare"
lom /Lead            show the Live Object Model path of the track Lead
```

## Pages

- [Getting started](getting-started.md): install cmdAbl and try the first commands.
- [Using cmdAbl](using.md): the palette, how names are written, the pick list, pads and chains, history.
- [Remote Script](remote-script.md): what it does, how to install, update and check it, and its messages.
- [Command reference](reference/commands.md): every command, generated from the code.
- [Live API mapping](reference/live-api.md): how cmdAbl's paths map to the Live Object Model.
- [Architecture](architecture.md): how cmdAbl is built, for people who want to extend it.
- [Guides](guides/README.md): writing a command, releasing cmdAbl, the pakabl index and CI.
- [Known limits](limits.md): what does not work yet.
