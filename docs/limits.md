# Known limits

This page lists what cmdAbl cannot do, and what it does differently from what you might expect. Each item says what
to expect and, where there is one, a workaround. Nothing here is a bug report you need to file; the maintainers
already know about each one.

## Platform and Live

- **macOS only.** cmdAbl is tested on macOS only. Chains and Drum Rack pads need macOS as well. The Windows setup has not been tested.
- **The Extensions SDK is in beta.** cmdAbl needs a version of Ableton Live with Extensions support, and is built
  against the Extensions SDK 1.0.0-beta.1.
- **cmdAbl runs in a sandbox.** It may read only Live's Extensions and Extensions Data folders and its temp folder.
  It cannot read the User Library, so it cannot tell a missing Remote Script from an old copy that Live has not loaded
  or one that is not chosen as Control Surface, and says "not running" for all three. Workaround: run `cmdabl setup`
  (it reinstalls the current script), restart Live and choose cmdAbl as Control Surface.
- **pakabl installs may be blocked by a stricter sandbox.** pakabl writes into Live's Extensions folder, which works
  today. Ableton has announced a stricter sandbox for extensions. If it arrives, installing through pakabl may be
  blocked in a later version of Live, and pakabl as a whole may stop working.

## Dialogs

- **Only one dialog is shown at a time.** The SDK does not handle a second dialog while one is open. cmdAbl queues
  dialogs: the next one appears after the previous one closes.
- **Live's window does not respond while a dialog is open.** The dialogs are modal. Close the dialog (`Esc`) to use
  Live again.
- **Dialogs cannot be resized.** A dialog's size is fixed when it opens, and the SDK has no call to change it. cmdAbl
  sizes each dialog from its content, up to a fixed largest size. A longer message scrolls.
- **The palette can, rarely, stop opening.** The cause is not known. If `:` opens nothing and no cmdAbl window is
  visible, you can run `curl -X POST http://127.0.0.1:27184/reset` in a terminal, only when no cmdAbl window is open,
  and then press `:` again. This has not been tested on a real hang: it makes cmdAbl forget the stuck dialog, and Live
  may still not open a new one. If that does not help, disable and re-enable the extension. Restarting Live is the
  safe last step.

## Commands

- **No commands from other extensions.** An extension can only run the commands it registered itself, so cmdAbl
  cannot start a command of another extension.
- **Exclusive arm and solo are not applied.** If Live's "Exclusive" setting is on, cmdAbl does not follow it.
  `arm /Bass /Lead` arms both tracks. Workaround: name every track you want to change.
- **`arm` can only detect a refused track with the Remote Script.** Live can refuse to arm a track, for example a MIDI
  track whose input device is missing, and the SDK reads back "armed" anyway. The check that catches this needs the
  [Remote Script](remote-script.md).
- **The history is kept in memory only.** It is gone when cmdAbl restarts.

## Tags

- **Tags are on tracks only.** Rack chains and Drum Rack pads cannot carry tags.
- **Cmd+Z does not undo a tag change.** Workaround: `cmdabl log --undo` lists the commands that put each change
  back, for example `tag --set 0 /Lead fx`. Each change also leaves an invisible step in Live's undo list.
- **`tag` takes one target.** `tag /Lead, /Bass fx` fails. Workaround: use `#tag`, `!#tag` or `--pick` as the target.

## Pads, chains and racks

- **The first palette open after a start may not list chains.** The palette list may miss the chains of racks until
  the racks have been seen once. Workaround: type the path, which works at once, or use `find`.
- **A renamed pad can answer that the Live Set changed.** A command waits up to 1.5 seconds for the Set's structure to
  refresh. If Live is slow and the wait ends first, a command on the old name answers "the Live Set changed; run the
  command again". Workaround: run the command again.

## Remote Script

- **Selection, tags, notes and chain changes need the Remote Script.** Without it, `goto`, `find`, `next`, `prev`, `tag`, `note` and
  mute or solo of rack chains do not work. See [what works without it](remote-script.md#what-works-without-it).
- **Two copies of Live.** If a second copy of Live starts, its script cannot open the port and writes a new token
  file. The first copy keeps its own token, and its changes are refused. Workaround: restart the first copy.
