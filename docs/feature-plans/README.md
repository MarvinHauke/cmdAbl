# Feature plans

This folder holds design docs for non-trivial cmdAbl features — written *before* (and updated
during) implementation so the architecture gets thought through once, in writing, rather than
rediscovered in code review or three months later when extending it.

Add a plan here when a feature touches multiple parts of the system (extension ↔ webview ↔
bridge ↔ Remote Script), introduces a new abstraction, or is large enough that "what should
this look like in six months" is worth answering up front. Skip it for bug fixes, copy
tweaks, or single-file changes — those don't need a design doc, just a commit message.

## Conventions

- **Numbering**: `NNNN-kebab-case-title.md`, numbers assigned sequentially in the order plans
  are created (not the order features ship). This gives a stable reading/reference order —
  "see 0001" always points at the same doc.
- **Status**: every plan starts `Draft`, and its front-matter status line is updated as work
  progresses: `Draft → In Progress → Shipped` (or `Superseded by NNNN` if a later plan
  replaces it). Update the table below to match.
- **Template**: copy [`TEMPLATE.md`](TEMPLATE.md) as a starting point — it lists the section
  headings these plans use and what goes in each.
- **Living documents**: a plan isn't a contract frozen at design time. As implementation
  surfaces new constraints, edit the doc — that's the point of keeping it in the repo next to
  the code instead of in a chat transcript.

## Index

| # | Title | Status | Summary |
|---|---|---|---|
| [0001](0001-path-addressed-objects-and-commands.md) | Path-addressed objects & Linux-style commands | Draft | Address any Live object (tracks, devices, Drum Rack chains, …) by path (`/vermona/kick`), drive them with Linux-style commands (`mute`, `rm`, `select`, …) supporting flags and multiple targets, and a bidirectional bridge so the palette can read data the Extensions SDK doesn't expose. |
| [0002](0002-command-feedback-pattern.md) | Structured command-feedback pattern | Draft | Give every command a structured, exit-code-like result (`CommandResult`) rendered through one consistent policy — replacing today's scattered modal/console/throw mix — and generalize it to multi-target commands' partial-success reporting. |
| [0003](0003-pakabl-extension-system.md) | pakabl — extension/package system | Draft | Let third-party code register commands and palette providers through cmdAbl's existing `CommandRegistry`/`Provider` surface; staged as spike (can the host load code at runtime?) → local-folder loader/API MVP → bounded remote install via a curated trusted-providers list. |
