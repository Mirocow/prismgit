#!/bin/bash
#
# test-all-repo-states.sh
# =======================
# Creates 5 test repos in different in-progress states, then runs
# e2e tests to verify the banner + buttons + conflict resolution.
#
# Usage: ./scripts/test-all-repo-states.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCREENSHOT_DIR="/home/z/my-project/screenshots"

echo "============================================"
echo "  PrismGit All Repo States E2E Test"
echo "============================================"
echo ""

# ── Step 1: Start Xvfb ──────────────────────────────────────────────
echo "[1/4] Starting Xvfb..."
if pgrep Xvfb > /dev/null 2>&1; then
  echo "  Xvfb already running"
else
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
  mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
  nohup Xvfb :99 -screen 0 1440x900x24 -ac > /tmp/xvfb.log 2>&1 < /dev/null &
  disown
  sleep 3
  pgrep Xvfb > /dev/null && echo "  Xvfb started" || { echo "  FAIL"; exit 1; }
fi

# ── Step 2: Create test repos ───────────────────────────────────────
echo ""
echo "[2/4] Creating test repos..."
bash "$REPO_ROOT/scripts/create-repo-states.sh"

# ── Step 3: Build ──────────────────────────────────────────────────
echo ""
echo "[3/4] Building PrismGit..."
cd "$REPO_ROOT"
if [ ! -f dist-electron/main.js ]; then
  npm run build 2>&1 | tail -3
fi
echo "  Build ready"

# ── Step 4: Run e2e test ──────────────────────────────────────────
echo ""
echo "[4/4] Running all-repo-states e2e test..."
mkdir -p "$SCREENSHOT_DIR"

DISPLAY=:99 npx playwright test tests/e2e/all-repo-states.spec.ts --workers=1 2>&1 | tee /tmp/states-test.log

# Summary
PASSED=$(grep -c "✓" /tmp/states-test.log 2>/dev/null || echo "0")
FAILED=$(grep -c "✘" /tmp/states-test.log 2>/dev/null || echo "0")
SHOTS=$(ls -1 "$SCREENSHOT_DIR"/state-*.png 2>/dev/null | wc -l)

echo ""
echo "============================================"
echo "  Results: $PASSED passed, $FAILED failed"
echo "  Screenshots: $SHOTS in $SCREENSHOT_DIR/"
echo "============================================"
