#!/bin/bash
# Full comprehensive E2E run — cross-platform.
#   Linux (headless container): Xvfb + nohup (user requirement):
#     nohup bash scripts/run-e2e-full.sh > /tmp/e2e-full-run.log 2>&1 &
#   macOS: native WindowServer display, no Xvfb needed:
#     nohup bash scripts/run-e2e-full.sh > /tmp/e2e-full-run.log 2>&1 &
cd "$(dirname "$0")/.."
SCRIPT_TMP="$(mktemp -d)"
echo "=== FULL E2E RUN — $(date -u '+%Y-%m-%d %H:%M:%S UTC') ==="
echo "OS: $(uname -s) | HEAD: $(git rev-parse HEAD)"
echo "=================================================="

# Self-heal: ensure the Playwright chromium binaries exist (the headless
# shell is a SEPARATE download from the full browser since 1.49 — a plain
# `npx playwright install chromium` covers both; without this the
# accessibility specs die with "Executable doesn't exist ... chrome-headless-shell").
# Fast no-op when binaries are already present.
echo "Ensuring Playwright chromium binaries…"
npx playwright install chromium 2>/dev/null || npx playwright install chromium || true

# Run the ENTIRE e2e suite. On Linux under Xvfb (auto display); on macOS
# Electron renders through the native WindowServer — xvfb-run does not
# exist there and is not needed. The webServer (vite renderer-only) is
# started by playwright for accessibility.test.ts.
if [ "$(uname -s)" = "Darwin" ]; then
  npx playwright test
elif command -v xvfb-run >/dev/null 2>&1 && command -v xauth >/dev/null 2>&1; then
  # xvfb-run REQUIRES xauth; minimal containers ship Xvfb without it
  # ("xvfb-run: error: xauth command not found"). Fall back to a manual
  # Xvfb on a private display when xauth is missing.
  xvfb-run -a npx playwright test
else
  echo "xvfb-run unavailable (no xauth?) — starting Xvfb manually on :99"
  Xvfb :99 -screen 0 1920x1080x24 > "$SCRIPT_TMP/xvfb.log" 2>&1 &
  XVFB_PID=$!
  sleep 2
  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "FATAL: Xvfb failed to start on :99 (see $SCRIPT_TMP/xvfb.log)"
    exit 1
  fi
  DISPLAY=:99 npx playwright test
  STATUS=$?
  kill "$XVFB_PID" 2>/dev/null
  exit $STATUS
fi
STATUS=$?

echo "=================================================="
echo "E2E EXIT CODE: $STATUS — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
exit $STATUS
