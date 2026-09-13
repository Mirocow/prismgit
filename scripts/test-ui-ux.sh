#!/bin/bash
#
# test-ui-ux.sh
# ==============
# Full UI/UX test suite — creates test repos, launches PrismGit Electron,
# and tests every tool through the UI via Chrome DevTools Protocol.
#
# Usage: ./scripts/test-ui-ux.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCREENSHOT_DIR="/home/z/my-project/screenshots"

echo "============================================"
echo "  PrismGit UI/UX Full Test Suite"
echo "============================================"
echo ""

# ── Step 1: Xvfb ───────────────────────────────────────────────────
echo "[1/5] Starting Xvfb..."
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

# ── Step 2: Create test repos ──────────────────────────────────────
echo ""
echo "[2/5] Creating UI test repos..."
bash "$REPO_ROOT/scripts/create-ui-test-repos.sh"

# Also create conflict repos (for the conflict resolution test)
echo ""
echo "[2b/5] Creating conflict test repos..."
bash "$REPO_ROOT/scripts/create-repo-states.sh" 2>/dev/null || true

# ── Step 3: Build ─────────────────────────────────────────────────
echo ""
echo "[3/5] Building PrismGit..."
cd "$REPO_ROOT"
if [ ! -f dist-electron/main.js ]; then
  npm run build 2>&1 | tail -3
fi
echo "  Build ready"

# ── Step 4: Run all e2e tests ─────────────────────────────────────
echo ""
echo "[4/5] Running UI/UX e2e tests..."
mkdir -p "$SCREENSHOT_DIR"

echo ""
echo "--- UI/UX Full Suite ---"
DISPLAY=:99 npx playwright test tests/e2e/ui-ux-full.spec.ts --workers=1 2>&1 | tee /tmp/ui-test.log

echo ""
echo "--- All Repo States ---"
DISPLAY=:99 npx playwright test tests/e2e/all-repo-states.spec.ts --workers=1 2>&1 | tee -a /tmp/ui-test.log

echo ""
echo "--- Conflict Resolution ---"
DISPLAY=:99 npx playwright test tests/e2e/conflict-resolution.spec.ts --workers=1 2>&1 | tee -a /tmp/ui-test.log

# ── Step 5: Summary ───────────────────────────────────────────────
echo ""
echo "[5/5] Summary..."
PASSED=$(grep -c "✓" /tmp/ui-test.log 2>/dev/null || echo "0")
FAILED=$(grep -c "✘" /tmp/ui-test.log 2>/dev/null || echo "0")
SHOTS=$(ls -1 "$SCREENSHOT_DIR"/ui-*.png "$SCREENSHOT_DIR"/conflict-*.png "$SCREENSHOT_DIR"/state-*.png 2>/dev/null | wc -l)

echo ""
echo "============================================"
echo "  UI/UX Test Results"
echo "============================================"
echo "  Passed:      $PASSED"
echo "  Failed:      $FAILED"
echo "  Screenshots: $SHOTS in $SCREENSHOT_DIR/"
echo "============================================"
echo ""
echo "Screenshots by category:"
ls -1 "$SCREENSHOT_DIR"/ui-changes-*.png 2>/dev/null | wc -l | xargs echo "  Changes:"
ls -1 "$SCREENSHOT_DIR"/ui-branches-*.png 2>/dev/null | wc -l | xargs echo "  Branches:"
ls -1 "$SCREENSHOT_DIR"/ui-history-*.png 2>/dev/null | wc -l | xargs echo "  History:"
ls -1 "$SCREENSHOT_DIR"/ui-diff-*.png 2>/dev/null | wc -l | xargs echo "  Diff:"
ls -1 "$SCREENSHOT_DIR"/ui-tags-*.png 2>/dev/null | wc -l | xargs echo "  Tags:"
ls -1 "$SCREENSHOT_DIR"/ui-stash-*.png 2>/dev/null | wc -l | xargs echo "  Stash:"
ls -1 "$SCREENSHOT_DIR"/ui-remotes-*.png 2>/dev/null | wc -l | xargs echo "  Remotes:"
ls -1 "$SCREENSHOT_DIR"/ui-submodules-*.png 2>/dev/null | wc -l | xargs echo "  Submodules:"
ls -1 "$SCREENSHOT_DIR"/ui-sidebar-*.png 2>/dev/null | wc -l | xargs echo "  Sidebar:"
ls -1 "$SCREENSHOT_DIR"/ui-conflict-*.png 2>/dev/null | wc -l | xargs echo "  Conflict:"
ls -1 "$SCREENSHOT_DIR"/state-*.png 2>/dev/null | wc -l | xargs echo "  States:"
ls -1 "$SCREENSHOT_DIR"/conflict-test-*.png 2>/dev/null | wc -l | xargs echo "  Conflict tests:"
