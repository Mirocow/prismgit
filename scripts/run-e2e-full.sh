#!/bin/bash
# Full comprehensive E2E run — cross-platform.
#   Linux (headless container): Xvfb + nohup (user requirement):
#     nohup bash scripts/run-e2e-full.sh > /tmp/e2e-full-run.log 2>&1 &
#   macOS: native WindowServer display, no Xvfb needed:
#     nohup bash scripts/run-e2e-full.sh > /tmp/e2e-full-run.log 2>&1 &
cd "$(dirname "$0")/.."
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
else
  xvfb-run -a npx playwright test
fi
STATUS=$?

echo "=================================================="
echo "E2E EXIT CODE: $STATUS — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
exit $STATUS
