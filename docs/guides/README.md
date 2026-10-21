# Guides

Task-oriented manuals for working on cmdAbl. (Design docs live in
[`../feature-plans/`](https://github.com/MarvinHauke/cmdAbl/blob/main/docs/feature-plans/README.md).)

| Guide | Use it when |
|---|---|
| [Writing a command](command-authoring.md) | You add a command or a module, or write its `--help` text |
| [Releasing cmdAbl](release-cmdabl.md) | You want to publish a new cmdAbl version |
| [pakabl index](pakabl-index.md) | An extension has a new version, or you want to add one to `pakabl list` |
| [CI](ci.md) | You want to know what runs on a PR / push and what the results mean |

## The workflows at a glance

| Workflow file | Runs | Does | You do |
|---|---|---|---|
| `.github/workflows/ci.yml` | PRs, pushes to `features`/`main`, weekly, manually | Tests, checks the reference pages, and builds and packages the `.ablx` as a run artifact. Never releases. | Read the result |
| `.github/workflows/docs.yml` | PRs that touch `docs/` or `mkdocs.yml`; pushes to `main` that touch them | Builds the docs site with `mkdocs build --strict` (the check `docs-build`) and, on `main`, deploys it to GitHub Pages | Fix a broken link it reports |
| `.github/workflows/package-release.yml` | Push to `main` | Publishes a GitHub Release `v<version>` **only if** that version isn't released yet | Bump the version to release |
| `.github/workflows/pakabl-index.yml` | Daily + manually | Crawls approved sources and opens a PR with the refreshed `pakabl/index.json` | Merge the PR |
| `.github/workflows/secret-scan.yml` | PRs, pushes, weekly, manually | Scans for secrets with gitleaks | Remove a secret it finds |
