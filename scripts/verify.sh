#!/usr/bin/env bash
# Local verification: Python tests + coverage.xml, frontend lint, frontend tests, build.
# Needs no Snowflake credentials. Run from repo root:  scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-.venv/bin/python}
[ -x "$PY" ] || PY=python
"$PY" -m pytest
( cd ui/app && npm run lint && npm test && npm run build )
echo "verify: all checks passed (coverage.xml written)"
