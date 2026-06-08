# Structured command-feedback pattern

**Status:** Draft (2026-06-07) — triggered by inconsistent ad-hoc feedback in `dispatch()`
plus the realization that 0001's Phase 3 multi-target commands (`mute /a /b /c`) make
*partial* success the normal case, not an edge case.

## Context

cmdAbl's command feedback today is an inconsistent grab-bag, all living in
`src/extension.ts`:

- `showFeedback()` (`extension.ts:24-37`) — a **blocking modal dialog** built from raw HTML
  and shown via `context.ui.showModalDialog`, used for `cmdabl --setup` results and "object no
  longer available" (`extension.ts:50,52,93`).
- `console.warn` / `console.error` / `console.log` (`extension.ts:66,76,86,101,120`) —
  invisible during normal use; only readable in a log the user isn't watching.
- `commandRegistry.ts:41` — `run()` throws a bare `Error` for an unknown command name, which
  `dispatch()` doesn't even catch — it would surface as an unhandled rejection.
- Most command handlers (`CommandHandler = (flags: string[]) => void | Promise<void>`,
  `commandRegistry.ts:9`) return `void`. Success is silent, but only by accident — there's no
  decision recorded anywhere that "no output on success" is the intended behavior.

That's three different feedback "shapes" doing the same job inconsistently, today, with a
single target per command. It gets harder once 0001's Phase 3 lands `mute`/`solo`/`rm`
operating on **multiple paths at once** — exactly the situation a shell handles by reporting
each failure individually (`rm: cannot remove 'b': No such file`) while still returning one
overall exit code. cmdAbl has no shape for that at all right now.

The user's framing — "isnt there a return 0 or 1 for every command which was executed?" — is
the right inspiration: every command should produce a structured outcome, and the palette
should render that outcome consistently, the way a shell consistently reports exit codes and
stderr regardless of which command produced them.

"Done" for this plan is: every `CommandHandler` returns a structured `CommandResult`; a single
`presentResult()` in `dispatch()` renders it (replacing the scattered `showFeedback`/
`console.*`/`throw` call sites); and the shape generalizes to multi-target commands without
redesign when 0001 Phase 3 lands.

## Goals / Non-goals

**Goals**
- Every command produces a structured result — the cmdAbl analogue of a shell exit code —
  instead of `void` / thrown errors / console logging.
- `dispatch()` renders results through one central place with one consistent policy, replacing
  today's scattered `showFeedback`/`console.warn`/`console.error`/`throw` call sites.
- The shape generalizes cleanly to multi-target commands: `mute /a /b /c` where `/b` doesn't
  resolve should still mute `/a` and `/c`, report `/b` as not found, and produce one coherent
  overall result — the same shape `rm` uses when some targets succeed and others don't.
- Routine success stays quiet by default (the shell convention: no output on success);
  failures and noteworthy results are surfaced clearly and distinguishably from confirmations.

**Non-goals**
- A general-purpose logging/telemetry system — this is strictly user-facing feedback for
  commands run from the palette, not a debugging facility.
- Redesigning `showModalDialog` usage for the palette window itself (`openPalette()`,
  `extension.ts:105-125`) — only command-result feedback is in scope.
- The bidirectional bridge upgrade 0001 Phase 4 anticipates for chain names — see §4 below for
  why this plan doesn't need it.

## Architecture

### 1. `CommandResult` — the exit-code analogue

```ts
type TargetOutcome = { path: string; ok: boolean; message?: string };

type CommandResult =
  | { ok: true;  message?: string; details?: TargetOutcome[] }
  | { ok: false; message: string;  details?: TargetOutcome[] };
```

- `ok` is the binary exit-code (cmdAbl has no use for distinct non-zero codes the way POSIX
  does — "did it work" is the only distinction that matters to the palette).
- `message` is the human-readable summary: the stdout-on-success / stderr-on-failure
  analogue. Optional on success (silence is valid output), required on failure (a failure
  without an explanation is useless to the user).
- `details` is what lets multi-target commands report per-target outcomes without losing the
  single overall result a shell gives you — `rm`'s "deleted 2, couldn't find 1" in structured
  form. Add this file to `src/types.ts`, alongside the existing `PaletteItem`/`PaletteResult`
  shapes it'll travel near conceptually (though it never crosses into the webview — it's an
  extension-internal type).

### 2. `CommandHandler` / `CommandRegistry` (`src/commandRegistry.ts`)

- Widen the handler signature to
  `(flags: string[]) => CommandResult | void | Promise<CommandResult | void>`. Handlers that
  return `void`/`undefined` are normalized to `{ ok: true }` — silent success — so trivial
  commands like `help` (`extension.ts:40-42`, currently just `spawn(...)`) don't have to
  manufacture a result they have no opinion about.
- `run()` and `execute()` change from `Promise<void>` to `Promise<CommandResult>`, and always
  resolve — never throw. An unknown command name (`commandRegistry.ts:41`, currently
  `throw new Error(...)`) becomes `{ ok: false, message: 'unknown command: "${name}"' }`,
  mirroring how a shell reports "command not found" as an exit code + stderr line, never a
  crash that takes down the caller.

### 3. Centralized rendering: `presentResult()` in `dispatch()` (`src/extension.ts`)

Replace every `showFeedback`/`console.warn`/`console.error` call inside `dispatch()`
(`extension.ts:71-103`, including the `"that ${result.type} is no longer available"` case at
line 93 and the "unknown item type" warning at line 101) with calls into one function that
applies a single policy:

| Result shape | Treatment |
|---|---|
| `ok: true`, no `message` | Silent — matches shell convention; most commands produce no output on success |
| `ok: true` with `message` | Lightweight confirmation via the channel chosen in §4 |
| `ok: false` | Clearly-marked failure via the channel in §4 — visually distinct from a confirmation (the user must be able to tell "it worked, here's a note" from "it didn't work" at a glance) |
| `details` present | Folded into `message` as a summary (`"muted 2/3 — '/b' not found"`); the per-target list is available for a future richer rendering but a one-line summary is enough for v1 |

`registry.run()`'s result flows into `presentResult` the same way a freshly-resolved
track/device failure would — one path for "command produced a result" regardless of which
branch of `dispatch`'s `switch` produced it.

### 4. Feedback channel — open question, needs a spike

The Extensions SDK exposes only `context.ui.showModalDialog` for UI feedback — confirmed by
grepping `node_modules/@ableton-extensions/sdk/dist/index.d.mts` for notification/toast/status
APIs; nothing else exists. That's a heavyweight, blocking, click-to-dismiss dialog: appropriate
for `cmdabl --setup` output (a one-time, information-dense result worth pausing for), poor for
routine confirmations after every `mute`/`select` (the user would have to dismiss a dialog
after every action — the opposite of "stays quiet on success").

`_Framework.ControlSurface` is widely believed (from community Remote Script conventions) to
expose `self.show_message(text)`, which renders a transient message in Live's own status bar —
**but this is not present in the local `ableton-lom` skill reference** (checked
`references/control-surface.md` and `references/views.md`; only MIDI-forwarding methods like
`send_midi`/`send_receive_sysex`/`register_midi_control` and view-navigation helpers are
documented there, no message/status-bar API). Treat its existence as unconfirmed until spiked.

**Spike plan:** add a fire-and-forget `{"cmd": "show_message", "text": "..."}` case to
`cmdabl.py`'s `_handle()` (mirroring the existing `_select_track`/`_select_device` dispatch at
`cmdabl.py:76-79`), call `self.show_message(text)`, send it from the extension via a new
`bridge.ts` helper, and visually confirm in Live: does text appear in the status bar, how long
does it persist, does it interrupt anything else docked there?

- **If it works:** it's a perfect fit for the existing one-way, fire-and-forget bridge
  (`src/ableton/bridge.ts` ↔ `remote-script/cmdAbl/cmdabl.py`, documented as such in
  `cmdabl.py:1-16`) — no need for 0001 Phase 4's bidirectional request/response upgrade just
  for this. Use it as the lightweight channel for confirmations (`ok: true` with `message`),
  reserving `showFeedback`'s modal for failures and `cmdabl --setup` output, where pausing the
  user's attention is appropriate.
- **If it doesn't exist or doesn't render usefully:** fall back to `showFeedback` for
  everything, but tune it to feel lighter for confirmations than for errors — e.g. a smaller
  dialog, or an auto-dismiss timer for `ok: true` messages while `ok: false` stays
  click-to-dismiss (errors deserve the user's deliberate acknowledgment; confirmations don't).

### 5. Multi-target aggregation helper

The piece that pays for itself once 0001 Phase 3 lands: a small helper —
`runOverTargets<T>(targets: T[], op: (t: T) => Promise<TargetOutcome | void>): Promise<CommandResult>`
or similar — that runs an operation across N resolved targets, collects `TargetOutcome[]`, and
folds them into one `CommandResult` with a summary `message`. This is the natural shared home
for the "some succeed, some fail, report both individually and overall" shape that
`mute`/`solo`/`rm` will all need — write it once here, in this plan's scope, so Phase 3 lands
on solid ground rather than inventing its own ad-hoc aggregation three times.

## Open questions

- Does `ControlSurface.show_message()` (or an equivalent transient/status-bar API) actually
  exist and render usefully? — resolved by the §4 spike; everything about the "lightweight
  channel" decision hinges on this.
- Exactly how much of `details`/per-target info should the v1 rendering surface? A one-line
  summary (`"muted 2/3 — '/b' not found"`) is almost certainly enough to start; whether a
  richer per-target view is ever worth building depends on how often partial failures actually
  happen in practice once Phase 3 ships.
- Should `ok: true` confirmations be configurable (some users may want *more* feedback, not
  less, especially while learning the palette)? Deferred — ship the shell-quiet default first
  and see whether anyone asks for more.

## Phased rollout

- **Phase A — structure & centralization.** Add `CommandResult`/`TargetOutcome` to
  `src/types.ts`, widen `CommandHandler` and `CommandRegistry.run`/`execute`
  (`src/commandRegistry.ts`), and replace `dispatch()`'s scattered feedback calls
  (`src/extension.ts:71-103`) with one `presentResult()`. Still rendered through the existing
  `showFeedback` modal for everything — this phase is a pure consistency/plumbing pass with no
  visible UX change yet, safe to ship and verify in isolation.
- **Phase B — lightweight channel.** Run the `show_message` spike (§4). If viable, add the
  bridge plumbing (`bridge.ts` helper + `cmdabl.py` handler) and switch `presentResult` to use
  it for `ok: true` confirmations, reserving the modal for failures and `--setup` output. If
  not viable, tune `showFeedback` to visually distinguish confirmations from errors instead.
- **Phase C — multi-target aggregation.** Build `runOverTargets` (or equivalent) and have
  0001 Phase 3's `mute`/`solo`/`rm` consume it from day one — this is where the pattern's
  payoff becomes visible to the user (`mute /a /b /c` reporting "muted 2/3 — '/b' not found"
  instead of silently doing nothing for the unresolved target, today's behavior).

## Verification

- **Phase A:** trigger each existing feedback path (`cmdabl --setup`, `cmdabl` with no flag,
  selecting a stale/removed object, typing an unknown command name) and confirm each now
  produces a `CommandResult` that renders through `presentResult` — same visible behavior as
  today (still the modal), but from one code path instead of three.
- **Phase B spike:** send `{"cmd": "show_message", "text": "test"}` from a scratch script or
  temporary bridge call and watch Live's status bar — record whether text appears, how long it
  persists, and whether it's legible/non-disruptive. This single observation determines which
  branch of §4 the plan follows.
- **Phase B integration:** trigger a silent success (no message), a success-with-message, and
  a failure, and confirm each renders through the *intended* channel (silent / lightweight /
  modal respectively) with visually distinguishable tone between confirmation and error.
- **Phase C:** with a Set containing at least one resolvable and one stale/non-existent path,
  run `mute <good-path> <bad-path>` and confirm the good target is muted, the bad one is
  reported by name, and the overall message reads as a coherent single outcome
  (`"muted 1/2 — '<bad-path>' not found"` or similar) — not two independent, disconnected
  messages.
