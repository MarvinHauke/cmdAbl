# Completion engine

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0005](0005-command-tree-and-module-authoring.md) (the tree and candidate snapshots).

**Status:** Steps 1–2 planned for 0.1.4 (2026-10-22, reviewed; section "0.1.4: argument completion"
below; API additions approved by the user 2026-10-22; built and Live-tested through MCP on
`feat/completion`: core `d0f1337`, `4198526`, `742da98`, `e803fcd`, `c53d6af`; modules `0b980b8`, `514fd39`;
ui `624c889`; docs `bc72468`, `6092d3e`). Drafted 2026-10-08 — replaces the palette's flat fuzzy search with hierarchical,
shell-style completion driven by the command tree.

## Context

`ui/interface.html` has three phases — `command` (Fuse.js over every item, threshold 0.4),
`flag`, and `args` (no completion; Enter passes the literal text). Typing something that
looks like an exact path (`/Sub 37 Midi`) also surfaces loosely related items because
everything is matched in one flat pass. Tab only copies the highlighted item into the input.

The webview cannot call the host while open (it posts one string on close), so the engine runs
entirely client-side over data serialized when the palette opens: the command tree and the
completer snapshots from 0005.

"Done": at every token position the palette offers exactly the valid next things, Tab descends
one level like a shell, and the best single match shows as ghost text.

## Goals / Non-goals

**Goals**
- Complete every position: command → subcommand → options → positional arguments.
- Hierarchical path completion: one segment at a time, Tab descends a level.
- Ghost text for the single best match; dropdown = fuzzy search *within the current level only*.
- Usage hint for the current command (`pakabl install <id>`).

**Non-goals**
- Host-side computation while typing (impossible with the webview channel).
- Changing how commands execute (0005) or report results (0002).
- The `find` command (separate future module that reuses `goto`).

## Architecture

### 1. Inputs (serialized at open)

`{ tree: CommandNode[] (without run), completions: Record<string, Candidate[]>, items: PaletteItem[] }`
where `Candidate = { value, description?, children?: Candidate[] }`; path candidates carry
`children` so descending a level needs no host call.

### 2. Position model

The engine tokenizes the input with the shared tokenizer (0005) and resolves the cursor's token
to one of:

| Position | Candidates | Source |
|---|---|---|
| word 0 | top-level command names + history/Live-object items | tree, providers |
| word n after a group | that group's children | tree |
| token starting with `-` | the leaf's options not yet used (+ `--help`) | tree |
| positional argument i | by `ArgDef.kind` / `complete` key | completers |
| path argument | children of the already-resolved parent segments | path candidates |

### 3. Matching

- Within the candidate set: exact prefix first, then fuzzy (Fuse.js, as today) scoped to that
  set only — never the whole tree.
- Path arguments resolve segment by segment: all but the last segment must match exactly,
  the last is fuzzy-matched against that node's children.
- Names with spaces are auto-quoted when completed.

### 4. Interaction

- **Ghost text**: best match rendered faded after the cursor; `→`/Tab accepts it.
- **Tab** accepts the highlighted candidate and *descends one level* (appends a space after a
  command word, or `/` after a path segment that has children). It never executes.
- **Enter** executes the typed line (parsed by the platform, 0005); with a highlighted
  candidate it first accepts it.
- The existing `mode-badge` shows the current level (`command`, `--option`, `path`).
- A one-line usage hint is built from the leaf's `args`.

### 5. Replaces

`parse()`, `computeItems()`, `resultFor()`, `rawResult()` and the `command|flag|args` modes in
`ui/interface.html`; `PaletteItem.flags` and `FlagDef` become part of the tree (`src/types.ts`).

## Related: pick list, keymap and navigation mode (2026-10-11)

- The **pick list** (`ui/pick.html`) already covers "several things match": it is the platform's
  answer to an ambiguous address and supports multi-select for multi-target commands. The
  completion engine should reuse its row/marking behaviour rather than invent another list.
- **Keymap (planned):** all UI keys go through named actions (`up`, `down`, `confirm`, `cancel`,
  `complete`, `mark`) with defaults plus a user `keymap.json`; a key may also be bound to a
  command line. While a dialog is open every key reaches the webview, not Live; with it closed,
  keys go to Live and only Karabiner/AutoHotkey can intercept them.
- **Navigation mode (planned, spike first):** keep a dialog open like vim's normal mode and map
  single keys to commands (`n` → `next`). The SDK channel only delivers one string on close, so
  this needs the dialog loaded from the local server (`http://127.0.0.1:27184/…`, allowed by the
  SDK) talking to it via `fetch`, guarded by a per-session token.
- **The spike decides two features:** navigation mode and the pick list's follow mode (0007).
  To verify, in this order:
  1. May the dialog page `fetch` `http://127.0.0.1:27184` — from a `data:` page (origin `null`,
     so the server must send CORS headers), or only when the page itself is served from there?
  2. Does the Remote Script (`update_display`, ~10 Hz) process bridge messages while a modal is open?
     **Yes** (measured in Live, 2026-10-11): a `hello` round trip takes 14 ms with no dialog
     and 24 ms with the palette open.
  3. Does Live repaint the selection behind the modal?
  4. On the side: does `window.resizeTo` do anything in the webview? (Expected: no.)
- **Two zones in the pick list (precursor, no spike needed):** the list zone of `ui/pick.html`
  (0007) is where single keys already act instead of typing (`Space` = `mark`). Navigation mode
  extends that zone with more single-key actions (`j`/`k`, `n` → `next`). `Space` is the default
  key for `mark`, `Tab` a second one.

## Target picture: Telescope-style fuzzy finding (user, 2026-10-19)

After `mute drum 2` opened one pick list whose rows are tagged with the word that found them
("drum", "2"), the user said this is how matching should work later, and showed Telescope's
"Find Files" (Neovim) as the model:

- The query matches as a **subsequence** across the whole path (`this` finds
  `remote-script/…/chains.py` via t…h…i…s), not only as whole words.
- The **matched characters are highlighted** in every row.
- A `/` in the query anchors a path part (`src/this` keeps only paths under `src`) — this is
  where it meets the hierarchical completion above.
- Rows are **ranked by score**, best next to the prompt; a counter shows `matches / total`.

Today's precursor: the per-word tags of 0005 "Forgiving target resolution". Open:
- Fuzzy for **targets** too (`mute <text>`), or only for the palette and pick-list filter?
  Exact paths and "a bare word equal to a top-level track name is that track" stay exact.
- One ranked list mixing rows hit by all words and rows hit by one word, all-words first.
- How it fits the level-by-level completion with ghost text (Tab descends a level).
- Highlighting needs match positions per row — a contract addition to `SelectRequest` items;
  ask before building.

## 0.1.4: argument completion (2026-10-22, reviewed by cmdabl-reviewer)

Steps 1–2 of the rollout: completion at every position, not only for command names.

### One function, LSP-shaped

`complete(line, cursor) → { items, replace: {from, to}, usage? }` in core, pure and shared.
- `items`: `{ label, insert, description?, kind }`. Core quotes `insert` (`quoteIfNeeded`), so the
  page never quotes. A path inserts `uniquePath(nodes, node)` (`/Kick#2`), not the bare name.
- **Position:** a new `locate(tokens, cursor, tree)`. It never validates and reuses parse.ts's
  helpers (`findChild`, `startsOption` with NUMBERISH, `effectiveOptions`, `valueNames`). `parse()`
  is not used for completion, because it stops at the first problem; `tokenize` never throws and
  returns the partial last token with its range on an open quote.
- **Positions:** command and subcommand, option, option value, positional argument, `rest`, `#tag`,
  path (whole path for now; segment by segment is step 3).
- **Sources:**
  - the tree (names, options, enum `choices`);
  - core built-ins (Live paths from the object tree, tags from the tag cache, command names);
  - module completers.

  At word 0, commands come first, then history and Live-object rows, as today (§2 table).
- **Caps:** at most about 100 rows per level.
- **The single source of hints:** `usage` replaces today's `CmdMatch.valueHint`, so one hint per
  position. `#ghost` keeps one owner, reused for ghost text later (step 4).

### Module API (additive; user approval needed)

- `api.commands.completer(key, (ctx: { tokens?: string[] }) => Candidate[] | Promise<Candidate[]>)`.
  `ArgDef.complete` and the new **`OptionDef.complete`** name the key (option values like
  `tag -r <old>`, `tag -e <tag>` need it).
- One signature for both transports: the snapshot calls it once at palette open without `tokens`; a
  later server variant may pass the typed tokens.
- Completers are **read-only** (no side effects; the guide says so) and read caches. They never call
  the bridge per call: bridge-backed caches (tags, chain names) refresh once at palette open, as
  `refreshStructure` does.
- Each completer runs under a budget of about 100 ms. A throw or timeout gives no rows and a debug
  log line; it never blocks the palette.
- At activation, an unknown `complete` key is a warning (and a test failure in the module tests).

### Transport: snapshot first

- **0.1.4 ships the snapshot (b).**
  - At palette open, core builds `{ tree (without run), completions, items }`.
  - `complete()` is bundled into the palette and runs there while typing.
  - Measure the payload for a Set with about 300 tracks; cap paths and tags.
- **A completion server (a) is a later enhancement, behind a spike.** The palette would call
  `fetch("http://127.0.0.1:27184/complete")` while typing.
  - **Spike:** can a `data:` page (origin `null`) reach it; how long does the CORS preflight take;
    does Windows WebView2 (Private Network Access) block it?
  - **Security**, if it goes ahead:
    - a random token of at least 128 bits, made at palette open and passed in the page JSON;
    - the token is revoked on close, compared with `timingSafeEqual`, and never logged;
    - it is sent in the `Authorization` header, never in the URL;
    - `Origin: null` is allowed only for `/complete` and only with a valid token;
    - `/open`, `/reset` and the dev routes keep refusing every Origin;
    - the route is read-only, and it needs its own guard because it would exist in release builds.
  - **Page side:** a 50 ms debounce, an AbortController per request, a sequence id, a 150 ms
    timeout, then the snapshot.
  - **Rule change, if it goes ahead:** the dialog rule (`CLAUDE.md`, 0007, the Context above) changes
    in the same change to "the SDK channel returns one string on close; a page may read the local
    trigger server only through token-guarded, read-only routes".

### Keys

- **Tab** takes the highlighted row and descends one level (adds a space after a word).
- **Enter runs the typed line** unless the user moved the selection (the existing `chosen` flag in
  `ui/interface.html`). It never takes the top row on its own: "never pick the first match silently".

### Work

1. **core:**
   - `locate`, `complete`, the candidate model;
   - `api.commands.completer`, `OptionDef.complete`, the key check;
   - the snapshot at palette open, with caps;
   - built-in sources (paths, tags, commands);
   - tests for the edge cases: a bare `-` against `-6`, a cursor inside an open quote, a cursor in the
     middle, `--name=value`, multi-value options, `rest`.
2. **ui:** the palette uses `complete()` at every position: Tab, the usage line, the Enter rule. It
   replaces `parse()`, `computeItems()` and the `args` phase.
3. **modules:** `complete` sources where they're missing (`pakabl install <id>`, `man <command>`,
   `tag -r <old>`, `tag -e <tag>`); the authoring guide via docs.
4. **Test through MCP:** `cmdabl_show("")` plus `cmdabl_keys` and `cmdabl_capture` at each position.

## Open questions

- Prototype ghost text on a plain `<input>` overlay vs. a `contenteditable`; settle by trying.
- How to order history entries relative to commands at word 0 (today: first rows when the
  query is empty).
- Performance with large Sets (hundreds of paths): precomputed per-level indexes vs. building
  Fuse instances lazily per level.

## Phased rollout

1. **Tree-aware dropdown**: command/subcommand/option completion from the tree (no ghost text).
2. **Argument completion** from completer snapshots (enums such as pakabl ids).
3. **Hierarchical paths**: segment-by-segment completion with `children` candidates.
4. **Ghost text** and the usage hint.

## Verification

- Per phase, in a real Live Set via `npm start`: type `pa` → `pakabl`; `pakabl ` → its
  subcommands; `pakabl install ` → installable ids; `mute /ver` → `/vermona`, Tab → `/vermona/`
  and only its children; `mute -` → only valid options.
- Typing an exact path surfaces that one object, not unrelated fuzzy hits.
- A Set with 300+ tracks stays responsive while typing.

## Note (2026-10-21)

Option values got label hints first (`PaletteItem.valueOptions`, core `ec9c567`): the palette shows
`<old>`, `<new>` or `<tag|#>` while the caret is in an option's values. A completer per option value
(for example the tag list for `tag --rename` and `tag --edit`) belongs to this plan.
