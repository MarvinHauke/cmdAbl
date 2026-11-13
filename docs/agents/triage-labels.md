# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps them to the strings used in this repo.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

The tracker is `docs/feature-plans/STATUS.md` (see `issue-tracker.md`). A label is written as a bracketed tag at
the start of a STATUS item, e.g. `- [ready-for-agent] jump's log line prints raw floats…`.
