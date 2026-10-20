# cmdAbl

**A command palette for Ableton Live.** Type a command and act on your Set: by name, by tag, or from a list.

[![Latest release](https://img.shields.io/github/v/release/MarvinHauke/cmdAbl)](https://github.com/MarvinHauke/cmdAbl/releases/latest)
[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-blue)](https://marvinhauke.github.io/cmdAbl/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![macOS · Live 12 (Extensions beta)](https://img.shields.io/badge/macOS%20%C2%B7%20Live%2012%20%28Extensions%20beta%29-lightgrey)](https://marvinhauke.github.io/cmdAbl/limits/)

📖 **Documentation:** https://marvinhauke.github.io/cmdAbl/

🚀 **[Get started](https://marvinhauke.github.io/cmdAbl/getting-started/)**: install cmdAbl and run your first commands.

![Screen recording: solo Bass, Audio, 808 bass is typed and runs in the palette; Bass, 1 Audio and the Bass Drum pad turn solo](docs/assets/images/demo.gif)

## Why cmdAbl

<!-- GIF to come: docs/assets/images/picklist.gif -->

### A pick list you control

When a name fits more than one object, `mute`, `solo` and `arm` ask instead of guessing. Mark the rows you mean
with `Tab`. Each row shows its state in Live's colours, a speaker for mute, `S` for solo or a record dot for arm,
and marked rows are highlighted. A dashed ring marks each button that Enter would change, and Live does not change
until you press Enter.

<!-- GIF to come: docs/assets/images/tags.gif -->

### Tags that group your tracks

Tag tracks by what they are: `tag /Lead fx synth`. After that, `mute #fx` reaches every track tagged `fx` at once,
`mute !#drums` every regular track without the tag, and `mute drums` works too when no track name matches it. Tags are saved
with the Set, and they need the [Remote Script](https://marvinhauke.github.io/cmdAbl/remote-script/).

<!-- GIF to come: docs/assets/images/pakabl.gif -->

### Community extensions, one list

pakabl installs Ableton Live extensions from a curated list of community repositories. Run `pakabl update` once,
then `pakabl list` shows each extension with an Install button. Restart Live after a change.

![The pakabl extension index window: a scrollable list of extensions, each with its name, version and an Install button](docs/assets/images/pakabl-list.png)

## Install

1. **Install the extension.** Download the latest `.ablx` from the
   [Releases page](https://github.com/MarvinHauke/cmdAbl/releases/latest). In Live, open **Settings → Extensions**,
   and drag the file onto the box or click **Choose file**.
2. **Run `cmdabl setup`.** Open the palette (right-click a clip, track, clip slot or scene and choose **: cmdAbl**),
   type `cmdabl setup` and press Enter. Then enable cmdAbl's rule in Karabiner-Elements for the `:` key.
3. **Turn on the Remote Script.** Restart Live. Then open **Settings → Tempo & MIDI → MIDI** and choose **cmdAbl**
   under **Control Surface**.

[Getting started](https://marvinhauke.github.io/cmdAbl/getting-started/) explains each step, with screenshots.

## Develop

The Ableton Extensions SDK is licensed for building extensions, not for redistribution, so it is not in this
repository. The [Architecture](https://marvinhauke.github.io/cmdAbl/architecture/) page explains the code, and
`docs/feature-plans/` holds the design plans.

```sh
npm install              # dependencies (the SDK tarballs go into vendor/, see the Architecture page)
npm test                 # unit tests
npm run build            # type-check and production bundle
npm run package          # build the .ablx
npm run docs:reference   # regenerate the reference pages from the code
```

## Contributing

- [Writing a command](docs/guides/command-authoring.md)
- [pakabl index](docs/guides/pakabl-index.md): getting an extension onto the community list
- [CLAUDE.md](CLAUDE.md): how the agents that work on this repository are organised

## License

MIT. See [LICENSE](LICENSE).
