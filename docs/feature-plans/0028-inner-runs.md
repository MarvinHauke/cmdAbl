# Inner runs: modules and pages run command lines

**Status:** Decided (user, 2026-11-12, grilling Q1–Q9); to build in 0.1.8. First user: `tag -l` Enter
(`tag.listEnter`, [0010](0010-tag-editing.md)). Unifies the page runs of [0018](0018-midi-mapping.md).

**Parent:** [0004](0004-command-platform.md)
**Depends on:** 0018 "Page runs" (the engine it generalizes), 0005 (command tree).

## Context

A module could not run a command line: `tag -l` wants Enter on a tag row to run `find #drums`, and richer
module pages will need this more often (user). Page runs (0018, 0.1.7) already run allowed lines from a
live page through the normal command path. This plan makes that one engine, reachable from a module too.

## Decisions (user, 2026-11-12)

1. **Any time while its command runs** (Q1 b): a module may run lines after its own page or list closes,
   and also to combine other commands. Not kept for later: once the calling command has returned, the call
   is refused.
2. **The allowlist is declared on the command node** (Q2 b), e.g. `runs: ["find", "tag", "mute", "solo"]`:
   readable in `man` and in review, checked at activation. A call (or a page's `run` list) can only narrow
   it, never widen it. Entries are command paths, matched against the **parsed** command path after aliases
   are resolved, never the first typed word (reviewer). An entry with an option (`tag -e`) is not a path: core
   warns and drops it at activation.
3. **Other modules' commands are allowed** if they are on the list (Q3). Options and arguments are free for
   now; finer entries (an option or argument limit, e.g. `tag -e` yes, `tag -r` no) come when a case needs
   them (user: "may become a problem later"). Known today: with `tag` on its list, `tag -l` could reach
   `tag -r` or `tag --set 0`; accepted, because `tag.listEnter` offers only four fixed presets.
4. **Never runnable by another module:** commands that act outside the Live Set, such as `pakabl install` and
   `remove` and `cmdabl setup`, are marked on their node, and core refuses them in any allowlist (Q5; user:
   "I don't want to allow pakabl to install by itself").
5. **Depth 1** (Q4): a line run this way cannot run further lines. Discuss again when a feature needs more.
6. **Lines from settings obey the allowlist too** (Q5): `tag.listEnter` stays a choice of four presets
   until settings have a text kind, and then the text is still checked against the list.
7. **The result goes back to the caller** (Q6): `api.commands.run(line)` resolves with the inner line's
   `CommandResult`; the module returns it or merges it into its own. Core shows nothing on its own, so
   nothing appears twice, and there is no second path for presenting results.
8. **Undo** (Q7): each inner line makes its own undo steps, as page runs do today. **Open, to tackle soon
   (user):** one undo step for a whole batch of commands (a typed line, a chain, an Apply) may be more
   fitting than one per command. Needs its own spike: what the SDK's `withinTransaction` can span (dialogs,
   Remote Script writes) and whether a script op can group writes.
9. **History and log** (Q8): inner lines never enter the palette history; the log shows each one, marked
   with its caller (`run: find #drums -> 0 (from tag -l)`).
10. **One engine** (Q9; user: "as few parallel engines as possible"): page runs become inner runs whose caller
    is a page. Same parse, allowlist check, headless rules, logging and tests. `livePage(…, { run })`
    keeps its shape and narrows the command's `runs`.

## Rules carried over from page runs

- Normal command path: parse, resolve, errors caught, the log.
- Inside a headless run (map binding, page run, chain part), an inner line runs headless too: a part that
  would ask gives exit 4. From a palette line, its dialogs go through the queue.
- A line not on the list: exit 2 to the caller, a warn line in the log, nothing run.

## Open

- The gear inside an inner run (reviewer): `tag -l` → Enter → `tag -e fx` opens the editor while the palette
  line is still `tag -l`, so the gear would run `tag -l` again. To decide with the user.
- One undo step per batch (decision 8).
