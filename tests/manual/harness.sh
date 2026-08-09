#!/usr/bin/env bash
# Monet GUI harness launcher.
#
#   scripts/…: ./tests/manual/harness.sh <scenario.mjs> [--headed] [extra harness flags]
#
# --headed needs an X server; this wraps the run in xvfb-run when one is available so a real
# (non-headless) Chromium can be used. Everything runs in a single process tree, because
# detached processes do not survive between agent shell calls.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${CHROME_PATH:=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1 || true)}"
export CHROME_PATH

if [[ " $* " == *" --headed "* ]] && command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a --server-args="-screen 0 1600x1000x24" node tests/manual/harness.mjs "$@"
fi
exec node tests/manual/harness.mjs "$@"
