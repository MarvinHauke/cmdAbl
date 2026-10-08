# CI

[`ci.yml`](../../.github/workflows/ci.yml) checks that cmdAbl builds and packages. It never
publishes anything and never changes a version.

**Runs on:** every pull request, every push to `features` or `main`, weekly (to catch
dependency drift), and manually (Actions → CI → Run workflow).

**Steps:** check that `package.json` and `manifest.json` have the same version → `npm ci` →
`npm run package` → upload the built `.ablx` as the artifact `cmdabl-ablx`.

## Getting a built `.ablx` from CI

Open a green run in the Actions tab → **Artifacts** → `cmdabl-ablx`.

## Reading the results

| Result | Meaning |
|---|---|
| Green | Type-check, bundle and packaging all worked |
| Red at "Check … versions match" | `package.json` and `manifest.json` differ — bump both to the same value |
| Red at `npm run package` | A real build/type error — see the log |
| `action_required` | GitHub holds runs triggered by bot-created PRs (e.g. the pakabl index PR) until someone clicks **Approve and run**. Optional for PRs that only change generated JSON. |

Releasing is a separate workflow — see [Releasing cmdAbl](release-cmdabl.md).
