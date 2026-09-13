#!/bin/bash
#
# test-conflict-resolution.sh
# ===========================
# End-to-end test: create git repos with merge conflicts, then resolve
# them through the PrismGit Electron UI via Chrome DevTools Protocol.
#
# Prerequisites:
#   - PrismGit built (npm run build)
#   - Xvfb installed (for headless display)
#   - Playwright + Chromium installed (npx playwright install chromium)
#
# Usage:
#   ./scripts/test-conflict-resolution.sh
#
# What it does:
#   1. Starts Xvfb on :99 (if not already running)
#   2. Creates 3 test git repos with different conflict types
#   3. Runs the Playwright e2e test (tests/e2e/conflict-resolution.spec.ts)
#   4. Screenshots are saved to /home/z/my-project/screenshots/
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCREENSHOT_DIR="/home/z/my-project/screenshots"
TEST_REPOS=("/tmp/conflict-test-1" "/tmp/conflict-test-2" "/tmp/conflict-test-3")

echo "============================================"
echo "  PrismGit Conflict Resolution E2E Test"
echo "============================================"
echo ""

# ── Step 1: Start Xvfb ──────────────────────────────────────────────
echo "[1/4] Starting Xvfb on :99..."
if pgrep Xvfb > /dev/null 2>&1; then
  echo "  Xvfb already running (PID $(pgrep Xvfb))"
else
  rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
  mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
  nohup Xvfb :99 -screen 0 1440x900x24 -ac -nolisten tcp > /tmp/xvfb.log 2>&1 < /dev/null &
  disown
  sleep 3
  if pgrep Xvfb > /dev/null 2>&1; then
    echo "  Xvfb started (PID $(pgrep Xvfb))"
  else
    echo "  ERROR: Xvfb failed to start. Check /tmp/xvfb.log"
    exit 1
  fi
fi

# ── Step 2: Create test repos with conflicts ───────────────────────
echo ""
echo "[2/4] Creating test repos with merge conflicts..."

# === Repo 1: Simple content conflict in config.ts ===
rm -rf /tmp/conflict-test-1 && mkdir -p /tmp/conflict-test-1 && cd /tmp/conflict-test-1
git init -b main -q && git config user.email "test@test.com" && git config user.name "Test"
cat > config.ts << 'EOF'
export const config = {
  version: "1.0.0",
  debug: false,
  port: 3000
};
EOF
git add . && git commit -q -m "initial commit"
git checkout -b feature -q
cat > config.ts << 'EOF'
export const config = {
  version: "2.0.0",
  debug: true,
  port: 8080,
  newFeature: true
};
EOF
git add . && git commit -q -m "feature: update config v2"
git checkout main -q
cat > config.ts << 'EOF'
export const config = {
  version: "1.5.0",
  debug: false,
  port: 3000,
  mainOnly: true
};
EOF
git add . && git commit -q -m "main: bump to 1.5.0"
git merge feature 2>/dev/null || true
echo "  ✓ Repo 1: /tmp/conflict-test-1 (content conflict in config.ts)"

# === Repo 2: Multiple file conflicts (3 files) ===
rm -rf /tmp/conflict-test-2 && mkdir -p /tmp/conflict-test-2 && cd /tmp/conflict-test-2
git init -b main -q && git config user.email "test@test.com" && git config user.name "Test"
echo "line1" > file1.ts && echo "line2" > file2.py && echo "line3" > file3.go
git add . && git commit -q -m "initial"
git checkout -b feature-branch -q
echo "MAIN-BRANCH-CHANGE-1" > file1.ts
echo "FEATURE-CHANGE-2" > file2.py
echo "line3-unchanged" > file3.go
git add . && git commit -q -m "feature changes"
git checkout main -q
echo "MAIN-CHANGE-1" > file1.ts
echo "line2-unchanged" > file2.py
echo "MAIN-CHANGE-3" > file3.go
git add . && git commit -q -m "main changes"
git merge feature-branch 2>/dev/null || true
echo "  ✓ Repo 2: /tmp/conflict-test-2 (3 files with conflicts)"

# === Repo 3: Conflict in nested file (src/components/Button.tsx) ===
rm -rf /tmp/conflict-test-3 && mkdir -p /tmp/conflict-test-3 && cd /tmp/conflict-test-3
git init -b main -q && git config user.email "test@test.com" && git config user.name "Test"
mkdir -p src/components
cat > src/components/Button.tsx << 'EOF'
export function Button({ label }: { label: string }) {
  return <button>{label}</button>;
}
EOF
git add . && git commit -q -m "initial: add Button component"
git checkout -b refactor -q
cat > src/components/Button.tsx << 'EOF'
export function Button({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick}>{label}</button>;
}
EOF
git add . && git commit -q -m "refactor: add onClick handler"
git checkout main -q
cat > src/components/Button.tsx << 'EOF'
export function Button({ label, disabled }: { label: string; disabled: boolean }) {
  return <button disabled={disabled}>{label}</button>;
}
EOF
git add . && git commit -q -m "main: add disabled prop"
git merge refactor 2>/dev/null || true
echo "  ✓ Repo 3: /tmp/conflict-test-3 (conflict in src/components/Button.tsx)"

# ── Step 3: Build PrismGit (if needed) ──────────────────────────────
echo ""
echo "[3/4] Building PrismGit..."
cd "$REPO_ROOT"
if [ ! -f dist-electron/main.js ] || [ ! -f dist/index.html ]; then
  npm run build 2>&1 | tail -3
  echo "  Build complete"
else
  echo "  Build already exists — skipping (use 'npm run build' to rebuild)"
fi

# ── Step 4: Run Playwright e2e test ─────────────────────────────────
echo ""
echo "[4/4] Running conflict resolution e2e test..."
mkdir -p "$SCREENSHOT_DIR"

DISPLAY=:99 npx playwright test tests/e2e/conflict-resolution.spec.ts --workers=1 2>&1 | tee /tmp/test-output.log

# Extract results
PASSED=$(grep -c "✓" /tmp/test-output.log || echo "0")
FAILED=$(grep -c "✘" /tmp/test-output.log || echo "0")
SCREENSHOTS=$(ls -1 "$SCREENSHOT_DIR"/conflict-test-*.png 2>/dev/null | wc -l)

echo ""
echo "============================================"
echo "  Test Results"
echo "============================================"
echo "  Passed:      $PASSED / 3"
echo "  Failed:      $FAILED"
echo "  Screenshots: $SCREENSHOTS saved to $SCREENSHOT_DIR/"
echo "============================================"
echo ""
echo "Screenshots:"
ls -1 "$SCREENSHOT_DIR"/conflict-test-*.png 2>/dev/null | head -20
echo ""
echo "Done. View screenshots in $SCREENSHOT_DIR/"
