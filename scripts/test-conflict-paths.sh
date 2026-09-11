#!/bin/bash
#
# test-conflict-paths.sh
# =======================
# Tests every conflict resolution path in the PrismGit 3-way merge tool.
#
# Resolution paths tested:
#   1. Take Left (ours)              — use the left/HEAD version
#   2. Take Right (theirs)           — use the right/incoming version
#   3. Both L→R (ours + theirs)     — concatenate ours then theirs
#   4. Both R→L (theirs + ours)     — concatenate theirs then ours
#   5. Reset Hunk                    — restore conflict markers after resolving
#   6. Multi-file: Take Left         — resolve first of 3 conflicted files
#   7. Multi-file: Take Right        — resolve second of 3 conflicted files
#   8. Nested path conflict          — deeply nested src/components/ui/Modal.tsx
#   9. JSON file conflict            — structured JSON with conflict markers
#  10. Abort from banner             — cancel merge via RepoStateBanner Abort button
#
# Usage: ./scripts/test-conflict-paths.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCREENSHOT_DIR="/home/z/my-project/screenshots/conflict-paths"

echo "============================================"
echo "  PrismGit Conflict Resolution Paths Test"
echo "============================================"
echo ""

# ── Step 1: Xvfb ───────────────────────────────────────────────────
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

# ── Step 2: Create conflict scenarios ─────────────────────────────
echo ""
echo "[2/4] Creating conflict scenario repos..."
bash "$REPO_ROOT/scripts/create-conflict-scenarios.sh"

# ── Step 3: Build ─────────────────────────────────────────────────
echo ""
echo "[3/4] Building PrismGit..."
cd "$REPO_ROOT"
if [ ! -f dist-electron/main.js ]; then
  npm run build 2>&1 | tail -3
fi
echo "  Build ready"

# ── Step 4: Run tests ─────────────────────────────────────────────
echo ""
echo "[4/4] Running conflict resolution path tests..."
mkdir -p "$SCREENSHOT_DIR"

# The spec file lives in scripts/ (not tests/e2e/) — copy it temporarily
cp "$REPO_ROOT/scripts/test-conflict-paths.spec.ts" "$REPO_ROOT/tests/e2e/test-conflict-paths.spec.ts"

DISPLAY=:99 npx playwright test tests/e2e/test-conflict-paths.spec.ts --workers=1 2>&1 | tee /tmp/conflict-paths.log

# Clean up temp test file
rm -f "$REPO_ROOT/tests/e2e/test-conflict-paths.spec.ts"

# ── Summary ──────────────────────────────────────────────────────
PASSED=$(grep -c "✓" /tmp/conflict-paths.log 2>/dev/null || echo "0")
FAILED=$(grep -c "✘" /tmp/conflict-paths.log 2>/dev/null || echo "0")
SHOTS=$(ls -1 "$SCREENSHOT_DIR"/path*.png 2>/dev/null | wc -l)

echo ""
echo "============================================"
echo "  Conflict Resolution Path Results"
echo "============================================"
echo "  Passed:      $PASSED / 10"
echo "  Failed:      $FAILED"
echo "  Screenshots: $SHOTS in $SCREENSHOT_DIR/"
echo "============================================"
echo ""
echo "Resolution paths tested:"
echo "  1.  Take Left (ours)         — simple-content"
echo "  2.  Take Right (theirs)      — simple-content"
echo "  3.  Both L→R (ours+theirs)   — multiple-hunks"
echo "  4.  Both R→L (theirs+ours)   — multiple-hunks"
echo "  5.  Reset Hunk               — multiple-hunks"
echo "  6.  Multi-file: Take Left    — multi-file (file_a.ts)"
echo "  7.  Multi-file: Take Right   — multi-file (file_b.py)"
echo "  8.  Nested path               — src/components/ui/Modal.tsx"
echo "  9.  JSON conflict            — package.json"
echo "  10. Abort from banner        — simple-content"
