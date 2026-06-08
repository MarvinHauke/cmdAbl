# pakabl — an extension/package system for cmdAbl

**Status:** In Progress — pivoted from the plan as written (updated 2026-06-08) — triggered
by a vision doc for "pakabl," a package manager that would let users install third-party
extensions that register new commands and providers into cmdAbl's palette.

**Where things stand — the shipped design diverged from this plan's central architecture.**
`src/modules/pakabl/index.ts` implements `pakabl install/uninstall/update/upgrade/list`
against the curated index (`pakabl/index.json`, `CURATED_INDEX_URL`) — but it works by
**downloading and unpacking complete, independently-built `.ablx` packages** into Live's
extensions directory and telling the user to restart Live to load them
(`downloadAndUnpack`/`installedManifest`), *not* by dynamically loading third-party code into
cmdAbl's own process and registering it through `CommandRegistry`/`Provider` as the `CmdAblAPI`
facade below describes. This sidesteps Step 0's load-bearing question ("can the Extension Host
load code at runtime?") entirely — installed extensions run as their own separate Live
extensions, indistinguishable from one a user installed by hand, rather than as in-process
pakabl-API citizens of cmdAbl's palette. The "indistinguishable in the palette" goal and the
`CmdAblAPI`/`ableton-cue-templates` porting analysis below describe a design that was not
pursued; if pakabl returns to that direction later, treat Steps 0–1 as still open. The curated
allowlist mechanism (Step 2's trust model) *did* ship, just pointed at `.ablx` downloads
instead of source loads.

## Context

cmdAbl's command palette is built on two small, general interfaces — `CommandRegistry`
(`src/commandRegistry.ts`) and `Provider`/`PaletteItem` (`src/types.ts:70-73`, wired together
in `extension.ts:18-21`) — that already support "register a command" and "contribute
searchable palette items" uniformly, regardless of where they came from. Right now the only
things that register through them are cmdAbl's own built-ins (`help`, `cmdabl`,
`createCommandProvider`, `createObjectProvider`).

The pitch behind "pakabl" is to open that same surface to third-party code: install an
extension, and its commands/providers show up in the palette exactly like cmdAbl's own —
*"Installing an extension = calling `activate(api)`. No special UI handling required.
Everything becomes searchable automatically."* That's the right framing, and it costs almost
nothing to support architecturally — `CommandRegistry`/`Provider` are already shaped for it.

What makes this a real design problem rather than a small addition is **how code gets onto
the user's machine and into the running extension at all**. cmdAbl ships as a single esbuild
bundle (`build.ts`, `bundle: true, format: "cjs", platform: "node"`, entry `src/extension.ts`
→ `dist/extension.js`) packaged into an `.ablx` zip. Nothing in cmdAbl today loads code that
wasn't compiled into that bundle at build time — so the foundational question this plan has to
answer first is **whether the Extension Host can run code loaded at runtime at all**, before
any API or installer design matters.

"Done" for this plan is staged deliberately (see Phased rollout): a spike that answers the
loading question, then a loader + API proven with hand-trusted code, then bounded remote
install — each phase only attempted once the one before it is proven solid.

## Goals / Non-goals

**Goals**
- Let third-party code register commands and palette providers through the same
  `CommandRegistry`/`Provider` surface cmdAbl's own built-ins use — indistinguishably, from
  the user's point of view, in the palette.
- Real remote installation (`pakabl install <name>`) — not just a folder the user populates by
  hand; a loader alone isn't a package manager.
- Bound the "what code can run inside Live" risk to a level appropriate for a host that drives
  a creative tool people keep open with unsaved work — without building a full
  signing/sandboxing system that v1 doesn't need.
- `pakabl list`/`search` so the system is discoverable and self-describing from the palette
  itself (the doc's "Discovery" idea — typing "eq" surfacing "EQ Tools — install via pakabl").

**Non-goals (for this plan)**
- An open marketplace / arbitrary-repo installs (`pakabl install <owner>/<repo>`) — deferred
  until a curated list has proven the loader and install flow are solid (see Phased rollout,
  Step 2 vs. the doc's original v0).
- Sandboxing, code signing, ratings, auto-updates — the doc's own Phase 4. Not worth designing
  before the foundation exists.
- Designing pakabl as reusable infrastructure for *other* Ableton extensions — see
  §Architecture for why this is a cmdAbl-internal feature, not standalone infra.

## Architecture

### Where pakabl lives: inside cmdAbl, not a separate repo

Build it as a module within this repo (e.g. `src/pakabl/`). It needs direct access to
internals that only make sense in cmdAbl's context — `CommandRegistry`, the
`providers: Provider[]` array, the `PaletteItem`/`Provider` contracts. Most other Ableton
extensions don't have a command palette to plug into, so there's no real "shared
infrastructure" case to justify cross-repo versioning/build overhead yet. If a genuine reuse
case appears later (a second palette-style extension), extracting the proven loader+API at
that point is a far better-informed decision than guessing at the boundary now.

### The `CmdAblAPI` is a thin facade over what already exists

This is the most important architectural fact for this plan: **the registration surface the
doc describes already exists in cmdAbl** — pakabl's job is to expose a controlled facade over
it, not invent new registration machinery.

- `api.registerCommand(...)` → `CommandRegistry.register(...)` (`src/commandRegistry.ts:19-32`)
  — already takes name/description/flags/handler, exactly the `Command` shape the doc needs.
- `api.registerProvider(...)` → push onto `providers: Provider[]`
  (`extension.ts:18-21`; `Provider = { getItems(): PaletteItem[] | Promise<PaletteItem[]> }`,
  `src/types.ts:70-73`) — already snapshot-based and merged uniformly at palette-open time
  (`extension.ts:111`).

An externally-loaded extension calling these ends up in exactly the same registry/array as
`help`, `cmdabl`, and `createObjectProvider` — which is what makes "indistinguishable in the
palette" essentially free once loading itself works.

### The open question everything else depends on: can we load code at runtime?

`@ableton-extensions/sdk` (`node_modules/@ableton-extensions/sdk/dist/index.d.mts`) exposes no
module-loader, no `fs`, no dynamic-import API — only the LOM data model, `commands`, `ui`,
`environment` (paths as strings), and `resources`. Taken alone, that looks like dynamic
loading might not be possible.

But cmdAbl already runs as genuine, unsandboxed Node.js (`"type": "module"`, esbuild
`platform: "node"`) and freely uses raw Node built-ins the SDK never wraps: `node:dgram` (raw
UDP sockets, `src/ableton/bridge.ts`), `node:http` (an HTTP server, `src/httpTrigger.ts`), and
`node:child_process` (arbitrary process spawning, `src/setup.ts`, `extension.ts:11`). A
process that can already open sockets and spawn arbitrary executables is not meaningfully
sandboxed — so `node:fs` and a dynamic `require()`/`import()` of an absolute path almost
certainly work too. Nobody has needed them yet: `setup.ts` shells out to `cp -R`/`mkdir -p`
for file management rather than using `fs`, which reads as a stylistic/cross-platform choice,
not evidence of a missing capability.

Still — "almost certainly" is exactly the situation that deserves a five-minute spike before
an architecture gets built on top of it (see Phased rollout, Step 0; mirrors how `0002`
flagged `show_message` as unconfirmed and planned to spike it rather than assume).

### Where extension code lives on disk

`context.environment.storageDirectory` (`Environment.storageDirectory`, `index.d.mts:748` —
"per-extension directory for persistent storage," unused anywhere in cmdAbl today) is the one
real filesystem path the SDK already hands an extension. A sibling `extensions/` directory
there is the natural home — `<storageDirectory>/extensions/<id>/` — analogous to how
`setup.ts` manages the Remote Script directory (`src/setup.ts:137-148`), just inside cmdAbl's
own sandboxed storage instead of Live's shared User Library.

### Worked example: porting `ableton-cue-templates`

To keep this plan grounded in something concrete rather than staying abstract, we picked a
real, public extension as pakabl's first install target and `CmdAblAPI` design pressure-test:
[`xmllint/ableton-cue-templates`](https://github.com/xmllint/ableton-cue-templates) — "drop
genre-specific cue point templates," 33 templates across 6 genre families. It's built on the
same `@ableton-extensions/sdk`/`manifest.json`/`build.ts`/`.ablx` shape as cmdAbl itself, so
it's a realistic stand-in for "what third-party extensions actually look like" — and, usefully,
it immediately exposes the gap between the doc's narrow `CmdAblAPI` sketch and what a real
extension needs.

`ableton-cue-templates`'s `activate()` (`src/extension.ts:530`) registers two internal
commands and wires them up two ways an extension can surface in Live *outside* a palette:

- `context.ui.showModalDialog(modalUrl, 480, 620)` (`extension.ts:584`) — its actual UI is a
  custom HTML picker (genre → template → "drop"), not a list of palette items.
- `context.commands.registerContextMenuAction(scope, "Drop Cue Template…", CMD_DROP)`
  (`extension.ts:646,650`) — it's reachable via Live's right-click menus, not (only) the
  palette.

A `CmdAblAPI` that's *only* `registerCommand`/`registerProvider` into cmdAbl's existing
registry (the doc's original sketch — see §"The `CmdAblAPI` is a thin facade") cannot host
this without a real rewrite: dropping its picker UI for a multi-step palette flow, and losing
its context-menu entry point entirely. That's adaptation work far beyond "wrap it in
`activate(api)`," and would defeat the appeal of picking a real, working extension as the
target in the first place.

The more promising shape — worth designing toward rather than discovering by accident — is a
`CmdAblAPI` that **adds** `registerCommand`/`registerProvider` (the palette-integration value)
**on top of** a passthrough to the extension's own `ExtensionContext` (or a curated slice of
it: `ui`, `dataModel`, maybe `commands.registerContextMenuAction`). That way `activate(api)`
for an existing SDK extension is close to a drop-in — register its palette-facing bits through
`api`, keep calling `api.context.ui.showModalDialog(...)` (or similar) for the rest — while
*new* extensions written for pakabl can lean entirely on the palette-only surface if they want
to. See the related open question below; this worked example is what should settle it, in
either direction, once Step 1's loader exists to actually try it against.

### Installation mechanics, once Step 2 is reached

`src/setup.ts` already shells out via `spawnSync`/`spawn` (`node:child_process`) for
cross-platform file operations — proof that calling external tools from inside the Extension
Host works. `pakabl install` extends that same pattern to `git clone` / `npm install` / an
optional build step, landing the result in `<storageDirectory>/extensions/<id>/` and handing
it to the loader.

## Open questions

- **Does runtime code-loading actually work in the Extension Host?** (Phased rollout, Step 0
  — the load-bearing question; its answer determines whether the rest of this plan proceeds as
  written or pivots to a build-time "monorepo of providers" model or a separate
  bridge-communicated process.)
- **How wide should `CmdAblAPI` be — palette-only, or a passthrough to `ExtensionContext`?**
  Surfaced concretely by the `ableton-cue-templates` worked example above: a narrow
  `registerCommand`/`registerProvider`-only API can't host its modal-picker UI or
  context-menu integration without a real rewrite, while a wider API that also exposes `ui`/
  `dataModel`/etc. makes porting close to a drop-in but dilutes "lives in the palette" as the
  thing that makes pakabl extensions feel native. Resolve this empirically once Step 1's
  loader exists — try porting the worked example both ways and see which one actually feels
  right, rather than designing it on paper.
- How does an extension declare its manifest/entry point — exactly the doc's `package.json`
  `cmdabl` field, or something simpler for v1 (a flat `cmdabl-extension.json`)? Worth deciding
  once Step 1's loader exists and has an opinion from real use.
- What does `pakabl remove`/reload-without-restart need from the host — can a loaded module be
  unloaded/replaced in a running Node process, or does removal always require a restart?
  Genuinely uncertain; defer until Step 1 surfaces it.
- How does the curated list (Step 2) get distributed and updated — bundled JSON that ships
  with cmdAbl releases, or fetched from a URL at runtime? The latter is more flexible but adds
  a network dependency to `pakabl search`/`install`; bundled JSON is simpler and matches "a
  small, maintained list" for v1.

## Phased rollout

Re-sequenced from the original vision doc around actual risk and dependency order — each step
only makes sense once the one before it is proven:

### Step 0 — Spike: can the Extension Host load code at runtime at all?

Write the smallest possible probe: from `activate()`, dynamically `import()`/`require()` a
hand-placed file at an absolute path under `context.environment.storageDirectory`, and confirm
it actually executes inside Live (a log line, or a throwaway palette command it registers).
This single experiment determines pakabl's entire shape:
- **Works** → pakabl can be a real runtime loader, roughly as the vision doc describes.
- **Doesn't** → "extensions" has to mean something else: source-level plugins woven into the
  build (still gives `activate(api)` ergonomics, resolved at build time instead of runtime),
  or a separate companion process talked to over the existing UDP-bridge pattern
  (`bridge.ts`/`cmdabl.py`) instead of in-process loading.

### Step 1 — MVP: local-folder loader + API, no installation automation

Once Step 0 confirms loading works, build the smallest end-to-end loop *without* git, npm, or
networking — those are independent concerns that each add a new failure mode (network,
untrusted builds, version resolution), and bundling them in before the loader itself is proven
just means more to debug at once. (This mirrors how VS Code/Obsidian-style ecosystems actually
started: "drop a folder with a manifest in a known directory," long before any in-app
marketplace.)

- A fixed `<storageDirectory>/extensions/<id>/` directory the user populates by hand (`cp -R`
  a folder there, or a `pakabl link <path>` for local dev — the lowest-risk possible "install").
- A loader that walks it, dynamically imports each entry point (per Step 0's confirmed
  mechanism), and calls `mod.default.activate(api)`.
- `CmdAblAPI.registerCommand`/`registerProvider` as the thin facade described in
  §Architecture — no new registration machinery.
- Ship `pakabl list` only; skip `install`/`remove`/`search` until this loop is proven solid
  with one or two real hand-placed extensions.

### Step 2 — Remote pull, bounded by a curated trusted-providers list

A loader that only ever loads hand-placed folders isn't really a *package manager* — "pakabl"
implies real remote pull. But the original doc's v0 (`pakabl install <owner>/<repo>`, accepting
any string) means running an installer for anything on GitHub — reopening the security problem
(a crash here takes down Live, with unsaved sessions open) before the loader's even proven.

The bounded middle ground: a small, maintained **allowlist** of `{ id, name, repo,
description }` entries — starting with `ableton-cue-templates` (see §"Worked example" — a
real, small, public extension is exactly the kind of thing this list should start with: known,
inspectable, and small enough to fully review before adding) — that `pakabl install <name>`
and `pakabl search <query>` resolve *against*, rather than accepting arbitrary repo strings.

- The list is the trust mechanism for v1 — the same role a Linux distro's default repos (not
  a random PPA) play for `apt install`. No signing/sandboxing needed yet; curation does that
  job.
- `pakabl install <name>` then runs the original doc's flow (clone → `npm install` → optional
  build → move into `<storageDirectory>/extensions/<id>/` → load) — but only for entries on
  the list, collapsing "is this safe to run" into "did we vet this before adding it."
- `pakabl search <query>` becomes useful immediately (search the list, not the internet),
  seeding the doc's Discovery feature without a marketplace backend.
- Growing the list into an open registry (the original doc's Phase 3) is then a much smaller
  step than going from nothing to a registry — the install/search code barely changes; only
  where the list comes from does.

### Step 3+ — registry, ratings, auto-update, sandboxing

The original doc's Phase 3/4, unchanged in spirit — revisit once Steps 0–2 are proven and in
real use; designing this now would be designing for assumptions Steps 0–2 haven't validated.

## Verification

- **Step 0:** the probe extension visibly executes inside Live when loaded from a file placed
  at runtime (not bundled at build time) — a log line or a throwaway palette command appearing.
  Pass/fail decides which branch of Step 0's two outcomes the rest of the plan follows.
- **Step 1:** hand-place one real extension (e.g. a trivial "say hello" command + provider) in
  `<storageDirectory>/extensions/`, reload, and confirm its command and palette items work
  exactly like cmdAbl's own built-ins — the user genuinely cannot tell it came from outside
  `extension.ts`. That indistinguishability is the doc's "Key Design Principle," and the right
  bar for calling the MVP done.
- **Step 2:** with a trusted list whose first entry is `ableton-cue-templates` (ported per
  whichever `CmdAblAPI` shape the worked example settled on), run `pakabl install
  ableton-cue-templates` end-to-end (clone → install → build → load) and confirm its commands
  and/or palette items work — genre/template picker included — exactly as they did before
  porting. Also confirm the negative case — `pakabl install <name-not-on-the-list>` refuses
  cleanly rather than treating an arbitrary string as a repo to clone.
