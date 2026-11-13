# Issue tracker: feature plans and STATUS

cmdAbl tracks work in the feature plans and in `docs/feature-plans/STATUS.md`, not in GitHub Issues.

## Conventions

- **Spec:** a numbered plan, `docs/feature-plans/NNNN-<slug>.md`. The next number comes from the index in
  `docs/feature-plans/README.md`. The architect (`cmdabl-architect`) writes and owns the plans; other agents
  propose.
- **Ticket:** a step in the plan's "Phased rollout", plus one line in `STATUS.md`:
  - under "Now" while it is in work;
  - under "Small items" or "Backlog" otherwise.
- **Handing a ticket to a builder:** the architect sends it by `SendMessage`, naming the files the builder may touch.
- **Triage state:** a tag at the start of the STATUS line, e.g. `[ready-for-agent]` (see `triage-labels.md`).
- **Comments and open points:** go into the plan's "Open questions".

## When a skill says "publish to the issue tracker"

- A small thing becomes a proposed STATUS line.
- A feature becomes a plan draft.

Either way, send it to the architect, who files it. Agents other than the architect don't edit
`docs/feature-plans/` themselves.

## When a skill says "fetch the relevant ticket"

Read the plan the user or the architect names, and its line in `STATUS.md`.

## Wayfinding operations

Used by `/wayfinder`. The files are temporary, so it works as in the local-markdown convention:

- **Map:** `.scratch/<effort>/map.md`.
- **Child tickets:** `.scratch/<effort>/issues/NN-<slug>.md`, each with `Type:`, `Status:` and `Blocked by:` lines.

When the effort is resolved, the decisions move into the plan (or a new plan) and the `.scratch/<effort>/`
folder is deleted.
