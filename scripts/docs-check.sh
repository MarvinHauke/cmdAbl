#!/usr/bin/env bash
# Local docs check, the same steps CI runs: check that the committed command reference matches
# the code (never writes), then build the site with --strict (fails on broken links).
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v mkdocs >/dev/null 2>&1; then
  echo 'mkdocs is missing. Install it: pip install "mkdocs-material==9.*" "mkdocs<2"' >&2
  exit 1
fi

npm run docs:reference -- --check
mkdocs build --strict
