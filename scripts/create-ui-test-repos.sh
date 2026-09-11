#!/bin/bash
#
# create-ui-test-repos.sh
# ========================
# Creates test git repositories for UI/UX e2e testing.
# Each repo targets a specific PrismGit tool/feature.
#
set -euo pipefail

git config --global user.email "test@test.com" 2>/dev/null || true
git config --global user.name "Test User" 2>/dev/null || true
BASE="/tmp/ui-test"

# ── 1. Changes: modified/staged/untracked/deleted/renamed ─────────
echo "[1/8] Creating ui-changes..."
rm -rf "$BASE/changes" && mkdir -p "$BASE/changes" && cd "$BASE/changes"
git init -b main -q
echo "line1" > a.txt && echo "line2" > b.ts && echo "line3" > c.py
mkdir -p src/components
echo "export const Button = () => null" > src/components/Button.tsx
git add . && git commit -q -m "initial commit"
# Modified
echo "modified line" >> a.txt
# Staged
echo "new staged" > staged.ts && git add staged.ts
# Untracked
echo "untracked" > newfile.go
# Deleted
rm c.py
# Renamed (unstaged)
mv b.ts renamed.ts
echo "  ✓ changes repo (modified + staged + untracked + deleted + renamed)"

# ── 2. Branches: multiple local + remote-tracking ─────────────────
echo "[2/8] Creating ui-branches..."
rm -rf "$BASE/branches" && mkdir -p "$BASE/branches" && cd "$BASE/branches"
# Create a bare remote
git init -q --bare origin.git
git clone -q origin.git work && cd work
echo "v1" > file.txt && git add . && git commit -q -m "commit 1"
git push -q origin main
git checkout -b feature/alpha -q && echo "alpha" > alpha.txt && git add . && git commit -q -m "alpha"
git checkout -b feature/beta -q && echo "beta" > beta.txt && git add . && git commit -q -m "beta"
git checkout -b hotfix/urgent -q && echo "hotfix" > hotfix.txt && git add . && git commit -q -m "hotfix"
git checkout main -q
git push -q origin feature/alpha feature/beta hotfix/urgent
git tag v1.0.0
git tag -a v1.1.0 -m "annotated release 1.1"
echo "  ✓ branches repo (4 branches + 2 tags + remote)"

# ── 3. History: rich commit graph with merges ────────────────────
echo "[3/8] Creating ui-history..."
rm -rf "$BASE/history" && mkdir -p "$BASE/history" && cd "$BASE/history"
git init -b main -q
for i in $(seq 1 5); do
  echo "line $i" > "file$i.txt" && git add . && git commit -q -m "commit $i — main"
done
git checkout -b feature -q
for i in $(seq 6 8); do
  echo "line $i" > "file$i.txt" && git add . && git commit -q -m "commit $i — feature"
done
git checkout main -q
git merge --no-ff feature -m "merge feature into main" -q
for i in $(seq 9 10); do
  echo "line $i" > "file$i.txt" && git add . && git commit -q -m "commit $i — main after merge"
done
echo "  ✓ history repo (10 commits + merge)"

# ── 4. Diff: staged + unstaged changes in multiple files ───────────
echo "[4/8] Creating ui-diff..."
rm -rf "$BASE/diff" && mkdir -p "$BASE/diff" && cd "$BASE/diff"
git init -b main -q
cat > config.ts << 'EOF'
export const config = {
  version: "1.0.0",
  debug: false,
  port: 3000,
  features: {
    auth: true,
    cache: false
  }
};
EOF
git add . && git commit -q -m "initial"
# Unstaged changes
cat > config.ts << 'EOF'
export const config = {
  version: "2.0.0",
  debug: true,
  port: 8080,
  features: {
    auth: true,
    cache: true,
    newFeature: true
  }
};
EOF
# Staged changes in another file
echo "new file" > newmodule.ts && git add newmodule.ts
echo "  ✓ diff repo (unstaged + staged changes)"

# ── 5. Tags: lightweight + annotated ───────────────────────────────
echo "[5/8] Creating ui-tags..."
rm -rf "$BASE/tags" && mkdir -p "$BASE/tags" && cd "$BASE/tags"
git init -b main -q
for i in $(seq 1 3); do
  echo "v$i" > file.txt && git add . && git commit -q -m "commit $i"
  git tag "v$i.0.0"
  git tag -a "v$i.1.0" -m "annotated tag $i.1.0"
done
echo "  ✓ tags repo (6 tags: 3 lightweight + 3 annotated)"

# ── 6. Stash: multiple stashes ────────────────────────────────────
echo "[6/8] Creating ui-stash..."
rm -rf "$BASE/stash" && mkdir -p "$BASE/stash" && cd "$BASE/stash"
git init -b main -q
echo "line1" > file.txt && git add . && git commit -q -m "init"
echo "change 1" > file.txt && git stash -q
echo "change 2" > file.txt && git stash -q
echo "change 3" > file.txt && git stash -q
echo "  ✓ stash repo (3 stashes)"

# ── 7. Remotes: multiple remotes + ahead/behind ──────────────────
echo "[7/8] Creating ui-remotes..."
rm -rf "$BASE/remotes" && mkdir -p "$BASE/remotes" && cd "$BASE/remotes"
git init -q --bare origin.git
git init -q --bare upstream.git
git clone -q origin.git work && cd work
echo "v1" > f.txt && git add . && git commit -q -m "c1"
git push -q origin main
git remote add upstream ../upstream.git
echo "v2" > f.txt && git add . && git commit -q -m "c2"
echo "  ✓ remotes repo (2 remotes: origin + upstream)"

# ── 8. Submodules ─────────────────────────────────────────────────
echo "[8/8] Creating ui-submodules..."
rm -rf "$BASE/submodules" && mkdir -p "$BASE/submodules" && cd "$BASE/submodules"
git init -q --bare lib.git
git clone -q lib.git lib-work && cd lib-work
echo "module" > module.ts && git add . && git commit -q -m "module v1"
git push -q origin main
cd "$BASE/submodules"
git init -b main -q
git submodule add -q ../lib.git libs/sub 2>/dev/null
git add . && git commit -q -m "add submodule"
echo "  ✓ submodules repo (1 submodule)"

echo ""
echo "All UI test repos created in $BASE/:"
ls -1 "$BASE/"
echo ""
echo "To run tests: ./scripts/test-ui-ux.sh"
