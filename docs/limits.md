# Known limits

This page lists what cmdAbl cannot do yet, and what it does differently from what you might expect. Each item says
what to expect and, where one exists, what is planned. Nothing here is a bug report you need to file; the
maintainers already know about each one.

## Platform and SDK

- **macOS only.** cmdAbl is tested on macOS only. Chains and Drum Rack pads need macOS as well. The Windows
  setup exists in the code but has not been tested.
- **The Extensions SDK is in beta.** cmdAbl needs a version of Ableton Live with Extensions support. cmdAbl is
  built against the Extensions SDK 1.0.0-beta.1.
- **pakabl installs may be blocked by a stricter sandbox.** pakabl installs Ableton Live extensions by writing
  into Live's Extensions folder. Ableton has announced a stricter sandbox for extensions. If it arrives, installing
  through pakabl may be blocked in a later version of Live, and pakabl as a whole may then stop working. The same
  sandbox could also stop two reads that cmdAbl makes outside its bundle: the installed-script check, which reads
  the Remote Script in the User Library, and the bridge token file. Each of those reads fails softly.
- **Only one dialog is shown at a time.** The SDK does not handle a second dialog while one is open. cmdAbl
  therefore queues dialogs: the next one appears after the previous one closes.
- **Dialogs cannot be resized.** A dialog's size is fixed when it opens, and the SDK has no call to change it.
  cmdAbl sizes each dialog from its content, up to a fixed largest size, and a message longer than that
  scrolls. A resize handle is a candidate for a feature request to Ableton.
- **Only one Extension Host connects at a time.** This is a limit for developers who test cmdAbl in Live: one
  copy runs at a time.

## Commands

- **No commands from other extensions.** An extension can only run the commands it registered itself, so
  cmdAbl cannot start a command of another extension.
- **Exclusive arm and solo are not applied.** If Live's "Exclusive" setting is on, cmdAbl does not follow it.
  `arm /a /b` arms both tracks. Name every track you want to change.
- **`arm` can only detect a refused track with the Remote Script.** Live can refuse to arm a track, for example a
  MIDI track whose input device is missing, and the SDK reads back "armed" anyway. The check that catches this
  needs the [Remote Script](remote-script.md). Without it, cmdAbl cannot tell that the track was not armed.
- **The palette can, rarely, stop opening.** It has not happened again, and its cause is not known. If `:` opens
  nothing and no cmdAbl window is visible, you can try `curl -X POST http://127.0.0.1:27184/reset` in a terminal, and
  then press `:` again. Run the reset only when no cmdAbl window is open. This has not been tested on a real hang: it
  makes cmdAbl forget the stuck dialog, and Live may still not open a new one. If that does not help, try disabling and
  re-enabling the extension. Restarting Live is the safe last step.

## Pads, chains and racks

- **The first palette open after a start may not list chains.** When Live has just started cmdAbl, the palette
  list may miss the chains of racks until the racks have been seen once. Typing a path still works at once,
  and `find` shows them.
- **A renamed pad needs a moment.** cmdAbl sees a renamed pad after its next refresh. Until then, a command on
  the old name answers that the Live Set changed, and you run the command again.
- **Racks nested inside a chain are not covered.** cmdAbl's object tree does not walk into chains. The chains of
  a rack inside another rack's chain are therefore missing from the palette and from `find`.

## Remote Script

- **Selection and chain changes need the Remote Script.** Without it, `goto`, `find`, `next`, `prev` and rack
  chains do not work. See [what works without it](remote-script.md#what-works-without-it).
- **Two copies of Live.** If a second copy of Live starts, its script writes a new token file. The first copy
  keeps its own token, and its changes are refused until it restarts.
