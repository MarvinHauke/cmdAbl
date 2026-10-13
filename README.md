# cmdAbl

A command palette for Ableton Live. Press `:` while Live is focused, type a command such as `mute drums`
or `goto /Opal Lead`, and cmdAbl runs it on the open Set. Commands take the names of tracks, devices, rack
chains and Drum Rack pads, and a pick list asks when a name matches more than one object.

📖 **Documentation:** https://marvinhauke.github.io/cmdAbl/ — start with [Getting started](https://marvinhauke.github.io/cmdAbl/getting-started/).

cmdAbl is built on the Ableton Extensions SDK, with a small Remote Script for what the SDK cannot do.
It supports macOS only for now.

## Install

1. **Install the extension.** Download the latest `.ablx` from the
   [Releases page](https://github.com/MarvinHauke/cmdAbl/releases/latest) and drop it onto the Extensions
   page in Live's settings. If an older cmdAbl is installed, remove it first and restart Live.
2. **Set up the `:` key.** The key needs [Karabiner-Elements](https://karabiner-elements.pqrs.org) and
   cmdAbl's rule. Open the palette (right-click a clip, track, clip slot or scene and choose **: cmdAbl**),
   type `cmdabl setup` and press Enter. Then enable the rule in Karabiner-Elements.
3. **Turn on the Remote Script.** Restart Live. Then open **Settings → Link, Tempo & MIDI → MIDI**, and under
   **Control Surface** choose **cmdAbl**. Leave Input and Output at *None*.

The [Getting started](https://marvinhauke.github.io/cmdAbl/getting-started/) page explains each step, the
messages you may see, and what works without the Remote Script.

## Develop

```sh
npm install          # dependencies
npm start            # type-check, build and run in Live's Extension Host (Developer Mode on)
npm test             # unit tests
npm run build        # type-check and production bundle
npm run package      # build the .ablx
npm run docs:reference   # regenerate the reference pages (commands, Remote Script, Live API) from the code
```

The architecture of cmdAbl is described on the [Architecture](https://marvinhauke.github.io/cmdAbl/architecture/)
page. Design plans are in `docs/feature-plans/`. The team of agents that works on this repository, and the
workflow they follow, is described in [CLAUDE.md](CLAUDE.md).

## Contributing

- Writing a command or a module: [Writing a command](docs/guides/command-authoring.md).
- Getting an extension onto pakabl's list of community extensions: [pakabl index](docs/guides/pakabl-index.md).

## License

MIT. See [LICENSE](LICENSE).
