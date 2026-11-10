# Installation and setup page

**Status:** In Progress (2026-11-05; phase 1 built, user hand check and docs open). Planned with the user in two question rounds (Q1–Q12) on 2026-11-05;
part of 0.1.6, built before 0019 phase 3. Takes over [0019](0019-settings-and-help.md) §6.

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0019](0019-settings-and-help.md) phase 1 (declared settings, the settings page), phase 2
(the help line)

## Context

Installing today takes six steps, three of them in other apps (README "Install",
`docs/getting-started.md`):

1. install Karabiner-Elements (optional; without it only the right-click menu opens the palette);
2. drag the `.ablx` into Live → Settings → Extensions;
3. open the palette from the right-click menu and type `cmdabl setup`. That links the Karabiner rule
   and copies the Remote Script (`src/core/setup/setup.ts`), and answers in plain text with paths and URLs
   (`src/core/setup/command.ts`, `src/core/setup/setupAdvice.ts`);
4. in Karabiner: Complex Modifications → Add predefined rule → cmdAbl → Enable;
5. restart Live;
6. choose **cmdAbl** as Control Surface in Settings → Tempo & MIDI.

Steps 5 and 6 can't be automated: Live has no API to select a control surface, and it only finds new
Remote Scripts when it starts.

**Done** looks like this (user, Q1): you drag the `.ablx` in, and a setup page opens by itself. One row
per step shows ✓ / ! / ✗, with a button where a step needs you. Then you restart Live once and pick the
control surface. Nobody types `cmdabl setup` to install.

## Goals / Non-goals

**Goals**

- `cmdabl setup` becomes a status page (a `notify` page with status rows and action buttons).
- The page opens by itself on first start and when a step needs you, unless switched off.
- The Remote Script is copied with one click on the page (Copy / Update), or automatically when the
  user turns on `setup.autoScript`.
- Karabiner: a clear hint that `:` needs it, and an **Add rule** button that uses Karabiner's own
  import link.
- Each row says what is wrong in one sentence and what to do, with no raw paths or URLs.

**Non-goals**

- Selecting the control surface for the user (impossible, see Context). Restarting Live was a non-goal too; the user
  asked for a **Restart Live** button on 2026-11-10 (spike, ships in 0.1.6 only if clean; see the table).
- Editing Karabiner's `karabiner.json` (Q4: too invasive for another app's config).
- A trigger without Karabiner (Q5): researched on the side (see Open questions), not built here.
- Windows: the rows exist there too (AutoHotkey instead of Karabiner), but only macOS is tested.

## Architecture

### 1. Status rows in `notify` (contract, approved by the user 2026-11-05, Q10)

- `ResultSection` items may be `string` (as today) or
  `{ text, status?: "ok" | "warn" | "fail", action?: { label, command } | { label, url } }`.
  Additive: existing sections of strings keep working.
- The page draws a status mark before the text (✓ green, ! yellow, ✗ red, in the theme's colours) and the
  action as a button at the end of the row.
- **An action button** closes the page with `{ "action": [sectionIndex, itemIndex] }`. Core looks the action up
  **in the result it sent**. It then runs the action's `command` line through the normal run path
  (e.g. `cmdabl setup script`) or opens the `url` with `openUrl`. The page never sends a command
  line, a shell command or a URL; an index that doesn't point at an action is ignored.
- After a command action, core reopens the setup page so the user sees the new state (for `cmdabl
  setup` only: the flow is setup's, not a general notify loop).

### 2. The rows (`src/core/setup/setup.ts`, `setupAdvice.ts`, `builtins.ts`)

`cmdabl setup` gathers the facts and builds one section per area. The facts it uses: the files on
disk, `karabiner_cli`, the Remote Script's `hello`, and the version shipped with the extension.

| Row | ✓ | ! | ✗ | Button |
|---|---|---|---|---|
| Karabiner | "`:` opens cmdAbl" | not installed: "Without Karabiner, `:` doesn't open cmdAbl; only the right-click menu does. Strongly recommended." · installed, rule not added or not enabled | — (never red, Q8) | **Get Karabiner** (url) · **Add rule** (import link, §3) |
| Remote Script | installed and current | missing · older than shipped ("Installed 0.1.14, this cmdAbl brings 0.1.15") | copy failed | **Copy** · **Update** (command `cmdabl setup script`) |
| Live restart | — | the copy on disk is newer than the running script: "Restart Live once to load it" | — | **Restart Live** (macOS, spike 2026-11-10): an Apple Event `quit` to the Live app cmdAbl runs in (Live asks to save; Cancel keeps Live open), a detached helper reopens the same app once that Live has exited (gives up after ~120 s). Refuses headless runs (exit 5: no `cmdabl_run`, no MIDI binding can quit Live); the page closes after it. macOS may ask once for Automation permission. |
| Control surface | the script answers `hello` | installed, Live started after the copy, and no answer: "Choose cmdAbl in Settings → Tempo & MIDI → Control Surface" | — | **How** (docs url) |
| Data folder | writable | — | not writable | none |

- "Live started after the copy": the extension host's start time stands in for Live's start, compared
  with the installed script's file time. That's how the page tells "restart Live" from "select the
  control surface" (the old STATUS item "not installed vs not enabled").
- The texts are short; the help line (0019 §3) shows a longer explanation on hover where useful.

### 3. Karabiner import link

- **Add rule** opens `karabiner://karabiner/assets/complex_modifications/import?url=<encoded url>`
  with `openUrl`. The rule is served by cmdAbl's local server: `GET /karabiner/cmdabl.json` on
  `127.0.0.1:27184`, read-only, the same file as `karabiner/cmdabl.json`. Karabiner then asks "Import" and
  "Enable": two clicks.
- **Verified (step 0, 2026-11-05; Add rule checked by the user in Live: the dialog opens and the page comes back):** Karabiner accepts an `http://127.0.0.1` URL. The link
  `karabiner://karabiner/assets/complex_modifications/import?url=http%3A%2F%2F127.0.0.1%3A27199%2Fkarabiner%2Fcmdabl.json`
  (a temporary server) made Karabiner fetch the file and show its Import dialog with the cmdAbl rule.
  `cmdabl setup karabiner` (link the file) stays as the fallback.
- **Open Karabiner** (user, 2026-11-10): the row "added but not enabled" opens `karabiner://karabiner/` with `openUrl`,
  which brings up the Karabiner-Elements Settings window (checked by hand; it does not pick the Complex Modifications tab).
  `openUrl` allows exactly that string, next to the import link. Clicked in Live 2026-11-10: Karabiner Settings comes up, the page comes back.
- A heading link to the Karabiner website was built and reverted the same day (user): Get Karabiner already covers "not installed".
- **Mock for screenshots and hand checks** (user, 2026-11-10; `a125a9d`): `cmdabl setup --simulate <state>` in development builds only
  (`no-karabiner`, `no-rule`, `rule-off`, `no-script`, `old-script`). It overlays the facts the rows are built from and
  never touches the auto-open state. **The buttons act for real** (e.g. Update under `old-script` copies the Remote Script).
- ✓ is decided as today (the rule is linked or imported) plus, if possible, the rule being enabled
  (read `~/.config/karabiner/karabiner.json`, read-only). If reading that is unreliable, ✓ means
  "imported", and the row says "enable it in Karabiner if `:` doesn't work".

### 4. Opening by itself

- The page opens on its own **on first start** (no `setup.seenVersion` stored yet) and **after an update
  that needs a step from the user**: a new script to copy or load, or a newly failing row. It never opens
  again just because the same yellow row is still there (Q9): core stores which rows were shown.
- The page has a checkbox **"Don't open this page by itself"**. It is the setting `setup.openOnStart`
  (bool, default true), also shown on the settings page in a new **Setup** group.
- **As built (93d4b1d):** the page opens on the **first palette or right-click use** after start (a
  dialog during `activate()` was not assumed safe); the palette follows when the page closes. The facts
  are gathered in the background at activation and reused if under 20 s old. Moving it to `activate()`
  later is one call (`openIfNeeded()`).
- The opening state (`seenVersion`, the shown row signatures) lives in
  `<data folder>/modules/setup/state.json`, not in `settings.json`.
- The checkbox needs one more piece of the contract: a `notify` request may carry
  `toggle?: { label, setting, on }`. The page answers `{ toggle: boolean }` with or without an action,
  and core saves it. It is additive; decided here as part of the approved status-row contract.

### 5. Settings (`setup` group)

| Key | Kind | Default | What |
|---|---|---|---|
| `setup.openOnStart` | bool | true | "Open the setup page by itself" (first start, updates that need a step) |
| `setup.autoScript` | bool | false | "Update the Remote Script by itself": copy a newer script at start without asking, then show "restart Live once" |

`setup.autoScript` covers updates through `pakabl upgrade` and a new `.ablx` alike (user, Q7). A first
install still goes through the page's **Copy** button unless the setting is on.

### 6. `cmdabl setup` subcommands

- `cmdabl setup` shows the page (always, whatever `setup.openOnStart` says).
- `cmdabl setup script` (named after what it sets up, like `karabiner`; was `copy`, user 2026-11-05) copies or updates the Remote Script (the button's command; also usable by hand).
- `cmdabl setup karabiner` links the rule the old way (the fallback).
- Headless (MCP `cmdabl_run`): the rows come back as text lines with their marks, so agents can test
  them without a dialog.

## Open questions

- **A trigger without Karabiner** (Q5, research on the side): Live's own key mapping, a MIDI note
  through 0018 (a MIDI firing can't open a dialog today), macOS Shortcuts or another key tool. The user
  likes `:` through Karabiner; this only matters if something easier exists. Result goes here.
- Whether `karabiner.json` can be read reliably to tell "imported" from "enabled".
- Windows: the AutoHotkey row's texts and button, untested.
- The docs (Getting started, README Install) get rewritten around the page by cmdabl-docs before the
  release.

## Phased rollout

0. **Spike (architect, in Live):** a page opening during activation; Karabiner's import link with a
   `127.0.0.1` URL. Record the results here.
1. **Core:** the status-row and toggle contract in `ui.ts`, the action lookup, `cmdabl setup` rows and
   subcommands, `setup.*` settings, the opening rule, `GET /karabiner/cmdabl.json`. **UI:** the status
   marks, buttons and checkbox in the notify page (`ui/feedback.html`), with the help line.
2. **Docs:** Getting started and README Install around the page (cmdabl-docs).

## Verification

- **Unit:** the row builder from facts (each row's ✓/!/✗ and button); the action lookup (an index
  without an action is ignored, a page can't send a command); the opening rule (first start, update
  needing a step, the same yellow row not reopening, `openOnStart` off); `setup script` against a temp
  folder; the import URL encoding.
- **Browser (fake requests):** the page with every status and button, the checkbox, the help line.
- **Live (MCP):** `cmdabl setup` headless lines; the page via `cmdabl_show`; Copy with an outdated
  copy (the dev link stays untouched); the Karabiner button on a machine with the rule removed (the user
  checks Karabiner's dialog); a fresh start with `setup.seenVersion` removed opens the page.
- **User only:** a real first install from the `.ablx` on a clean user (or a second macOS user), the
  Live restart, the control surface choice.
