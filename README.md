# cmdAbl

A vim-inspired command palette for Ableton Live. Press `:` while Live is focused to open a
keyboard-driven command input with fuzzy filtering, tab completion, and flag arguments.

<!-- screenshot placeholder — add assets/images/palette.png -->
<!-- ![Command palette](assets/images/palette.png) -->

## How it works

cmdAbl registers a persistent HTTP server inside the extension host. Karabiner Elements watches
for `:` while Ableton is frontmost and fires a `curl` request to that server, which opens the
command palette modal. Commands are registered in TypeScript and injected into the UI at open
time, so the palette always reflects the live command set.

### Palette keybindings

| Key | Action |
|-----|--------|
| Type | Filter commands / flags |
| `Tab` | Complete selected item into the input |
| `Enter` | Execute selected command |
| `↑` / `↓` | Navigate the list |
| `Esc` | Close without executing |

### Command syntax

Commands follow a POSIX-style flag pattern:

```
commandName [--flag]
```

Typing a command name followed by a space switches the dropdown into flag-completion mode.

### Built-in commands

| Command | Description |
|---------|-------------|
| `help` | Open the Ableton Live manual in the browser |
| `cmdabl --setup` | Symlink the Karabiner rule and print enable instructions |
| `suggest` | Generate ghost-note suggestions for the selected clip *(coming soon)* |
| `accept` | Accept all ghost-note suggestions *(coming soon)* |
| `clear` | Remove all ghost-note suggestions *(coming soon)* |

## Setup

### 1. Configure the Extension Host path

The path to Ableton Live's Extension Host module is stored in `.env` as `EXTENSION_HOST_PATH`.
The scaffold fills this in automatically; edit it if your install path changes.

### 2. Install dependencies

```sh
npm install
```

### 3. Run the extension

```sh
npm start
```

This type-checks, bundles, and loads the extension into Ableton's Extension Host.

### 4. Set up the `:` keyboard shortcut (optional)

With the extension running, open the palette via right-click → `: cmdAbl` on any clip, track,
clip slot, or scene. Then run:

```
cmdabl --setup
```

This symlinks `karabiner/cmdabl.json` into Karabiner's complex modifications directory.
Afterwards, open **Karabiner-Elements → Complex Modifications → Add rule** and enable
**"Open cmdAbl command palette with ':' when Ableton Live is focused"**.

> **Keyboard layout note:** The rule maps `Shift+Period` (`:` on QWERTZ/German layouts).
> If you use a different layout, edit `karabiner/cmdabl.json` and change `"key_code"` to
> match your key — use Karabiner's Event Viewer to find the correct code.

## Scripts

```sh
npm start          # type-check, build (dev), and run in Live's Extension Host
npm run build      # production bundle (minified)
npm run build:dev  # dev bundle (sourcemaps, not minified)
npm run package    # production build + create a .ablx archive (includes karabiner/)
```

## Development

Extensions must export an `activate(context: ActivationContext)` function. All commands are
registered on the `CommandRegistry` instance in `src/extension.ts`. To add a new command:

```ts
registry.register("mycommand", "description shown in the palette", (flags) => {
  // flags is string[] of everything typed after the command name
});

// with declared flags for tab-completion:
registry.register("mycommand", "description", [
  { name: "--option", description: "what this flag does" },
], (flags) => {
  if (flags.includes("--option")) { /* ... */ }
});
```

## Project structure

```
src/
  extension.ts       main entry point — registers commands, starts HTTP server
  commandRegistry.ts typed command registry with flag support
  httpTrigger.ts     localhost HTTP server for external triggers (Karabiner, etc.)
  setup.ts           Karabiner symlink setup logic
ui/
  interface.html     command palette (self-contained HTML/CSS/JS, inlined at build time)
karabiner/
  cmdabl.json        Karabiner Elements complex modification
assets/
  images/            screenshots for this README
```
