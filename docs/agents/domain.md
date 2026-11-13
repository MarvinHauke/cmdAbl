# Domain Docs

How the engineering skills use cmdAbl's domain documentation. The repo has a single context.

## Before exploring, read these

- **`docs/feature-plans/GLOSSARY.md`:** the shared language, with the terms to use and the terms to avoid.
- **The numbered plans** that touch the area (`docs/feature-plans/NNNN-*.md`): find them through the index in
  `docs/feature-plans/README.md`. They are this repo's decision records. There is no `docs/adr/`.

## Use the glossary's vocabulary

When your output names a domain concept (a ticket, a refactor proposal, a test name), use the glossary's
term. Don't use a synonym it lists under "avoid". A missing term is a signal: either you are inventing
language, or there is a real gap. Note a gap for `/domain-modeling`, which adds it to the existing glossary.

## Flag plan conflicts

If your output contradicts a decision in a plan, say so openly instead of silently overriding it:

> _Contradicts 0018 (live pages), but worth reopening because…_

## Don't create

Don't create a root `GLOSSARY.md`, a `GLOSSARY-MAP.md` or `docs/adr/`. New terms go into
`docs/feature-plans/GLOSSARY.md`, and decisions go into the plans (owned by the architect).
