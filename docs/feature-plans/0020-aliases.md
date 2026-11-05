# Aliases

**Status:** Draft (2026-11-05). Moved out of [0008](0008-tags-and-aliases.md) "Aliases" during the 0019
refinement with the user. Built after 0.1.6, as its own release or phase.

**Parent:** [0004](0004-command-platform.md)
**Depends on:** [0019](0019-settings-and-help.md) §7 (the expansion step and default commands),
[0008](0008-tags-and-aliases.md) (the store)

## Context

- Two things are called "alias":
  1. **A command's second name**, written by the module into its node (`aliases: ["bp"]` in the
     command tree). It exists in the platform (completion, `man`), and no command uses it yet.
  2. **A user alias**, a shortcut the user defines (`fxoff` → `mute --set 1 #fx`). Not built.
- 0019 §7 builds the expansion step in core for default commands: a bare command word becomes its
  line from `default_commands.json`, `\<word>` skips it, and the log shows `typed ⇒ ran`. User aliases
  plug in before that step.

## Goals

1. **An `alias` module** (user, 2026-11-05) owns defining, removing and listing user aliases, and its
   own `alias config`. Core only provides the expansion step, so modules still never parse.
2. **One rule for names:** whatever is typed is first turned into the root command; a default belongs to
   the root command only (0019 §7).
3. **The log shows what ran:** `run: fxoff ⇒ mute --set 1 #fx (alias)`. History stores what ran, with the
   typed form next to it.

## Carried over from 0008

- Expanded as the first word before parsing; arguments typed after the alias are appended
  (`m bass` with `m` → `mute` gives `mute bass`). No recursion.
- An alias cannot shadow a built-in command.
- Aliases appear in the palette like commands (subtitle: the line they stand for).

## Open questions (user, 2026-11-05)

- **Syntax:** something closer to bash, `alias fxoff = "mute --set 1 #fx"` (or `<`), instead of
  `alias add fxoff "…"`. Decide before building.
- **Aliases and defaults:** an alias that expands to a bare `mute` would pick up `mute`'s default, which
  can mislead. Option: a user alias always expands as `\mute` (never takes a default). Decide with this
  plan.
- **`palette.expansion`** (full `bp → bypass → bypass #fx` or compact `bp → bypass #fx`) as a setting in
  `alias config`. 0.1.6 always shows the compact form.

## Phased rollout

To be written when the plan is taken up.
