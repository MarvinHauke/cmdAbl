<!--
Copy this file to NNNN-kebab-case-title.md (next sequential number — check the README index
for the highest one in use) and fill in each section. Delete this comment block once you've
started; the section headings below are the convention, the prose under each is guidance for
what belongs there — replace it with your actual content.

Add a row to docs/feature-plans/README.md's index table pointing at the new file.
-->

# Title

**Status:** Draft (YYYY-MM-DD) — one line on what triggered this plan.

## Context

What's true today, and what's pushing for change? Link the specific files/behaviors that are
relevant (`src/...`, `ui/...`) so a reader can go look at the current state. End with what
"done" looks like in one or two sentences.

## Goals / Non-goals

**Goals** — the specific outcomes this plan commits to.

**Non-goals** — things that are adjacent or tempting but explicitly out of scope *for this
plan*. Naming them prevents scope creep and signals "deferred", not "forgotten".

## Architecture

The actual design: new types/modules, how they connect to existing code (name real files and
functions), and why this shape rather than alternatives you considered. This is the section
most worth re-reading mid-implementation — keep it concrete enough to code from.

## Open questions

Things intentionally left unresolved at design time — naming bikesheds, UX details that are
easier to settle by prototyping, edge cases to decide once you see real data. Not a sign the
plan is incomplete; a record of "decide this when you get there".

## Phased rollout

If the feature is large, break it into shippable increments. Each phase should be a coherent,
testable slice on its own — not "step 1 of 5 that does nothing alone".

## Verification

How to confirm each phase actually works: what to run, what Set/scenario to test against,
what to look for. Concrete enough that future-you (or future-Claude) can execute it without
re-deriving the test plan.
