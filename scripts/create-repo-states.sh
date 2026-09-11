#!/bin/bash
#
# create-repo-states.sh
# =====================
# Creates 5 test git repositories, each in a different in-progress state:
#   1. /tmp/state-merge         — merging (conflict)
#   2. /tmp/state-cherry-pick    — cherry-pick (conflict)
#   3. /tmp/state-rebase        — rebase (conflict)
#   4. /tmp/state-revert         — revert (conflict)
#   5. /tmp/state-bisect         — bisect (in progress)
#
set -euo pipefail

git config --global user.email "test@test.com" 2>/dev/null || true
git config --global user.name "Test User" 2>/dev/null || true

# ── 1. Merge conflict ──────────────────────────────────────────────
echo "Creating /tmp/state-merge..."
rm -rf /tmp/state-merge && mkdir -p /tmp/state-merge && cd /tmp/state-merge
git init -b main -q
echo "line1" > file.txt && git add . && git commit -q -m "init"
git checkout -b feature -q
echo "FEATURE" > file.txt && git add . && git commit -q -m "feature change"
git checkout main -q
echo "MAIN" > file.txt && git add . && git commit -q -m "main change"
git merge feature 2>/dev/null || true
echo "  ✓ merge conflict in file.txt"

# ── 2. Cherry-pick conflict ─────────────────────────────────────────
echo "Creating /tmp/state-cherry-pick..."
rm -rf /tmp/state-cherry-pick && mkdir -p /tmp/state-cherry-pick && cd /tmp/state-cherry-pick
git init -b main -q
echo "line1" > file.txt && git add . && git commit -q -m "init"
git checkout -b feature -q
echo "FEATURE" > file.txt && git add . && git commit -q -m "feature change"
git checkout main -q
echo "MAIN" > file.txt && git add . && git commit -q -m "main change"
# Cherry-pick the feature commit — will conflict
git cherry-pick feature 2>/dev/null || true
echo "  ✓ cherry-pick conflict in file.txt"

# ── 3. Rebase conflict ─────────────────────────────────────────────
echo "Creating /tmp/state-rebase..."
rm -rf /tmp/state-rebase && mkdir -p /tmp/state-rebase && cd /tmp/state-rebase
git init -b main -q
echo "line1" > file.txt && git add . && git commit -q -m "init"
git checkout -b feature -q
echo "FEATURE" > file.txt && git add . && git commit -q -m "feature change"
git checkout main -q
echo "MAIN" > file.txt && git add . && git commit -q -m "main change"
git checkout feature -q
# Rebase onto main — will conflict
git rebase main 2>/dev/null || true
echo "  ✓ rebase conflict in file.txt"

# ── 4. Revert conflict ─────────────────────────────────────────────
echo "Creating /tmp/state-revert..."
rm -rf /tmp/state-revert && mkdir -p /tmp/state-revert && cd /tmp/state-revert
git init -b main -q
echo "line1" > file.txt && git add . && git commit -q -m "init"
echo "CHANGED" > file.txt && git add . && git commit -q -m "change file"
# Create a divergent history so revert conflicts
git checkout -b temp -q
echo "TEMP" > file.txt && git add . && git commit -q -m "temp change"
git checkout main -q
echo "MAIN2" > file.txt && git add . && git commit -q -m "main change 2"
git revert HEAD~1 2>/dev/null || true
echo "  ✓ revert conflict in file.txt"

# ── 5. Bisect in progress ──────────────────────────────────────────
echo "Creating /tmp/state-bisect..."
rm -rf /tmp/state-bisect && mkdir -p /tmp/state-bisect && cd /tmp/state-bisect
git init -b main -q
git config user.email "test@test.com" && git config user.name "Test"
echo "good" > file.txt && git add . && git commit -q -m "commit 1"
echo "good2" > file.txt && git add . && git commit -q -m "commit 2"
echo "good3" > file.txt && git add . && git commit -q -m "commit 3"
echo "bad" > file.txt && git add . && git commit -q -m "commit 4"
echo "bad2" > file.txt && git add . && git commit -q -m "commit 5"
G=$(git rev-parse HEAD~3)
B=$(git rev-parse HEAD)
git bisect start
git bisect bad "$B"
git bisect good "$G"
echo "  ✓ bisect in progress"

echo ""
echo "All 5 repo states created:"
echo "  1. /tmp/state-merge         — merging (conflict)"
echo "  2. /tmp/state-cherry-pick    — cherry-picking (conflict)"
echo "  3. /tmp/state-rebase        — rebasing (conflict)"
echo "  4. /tmp/state-revert         — reverting (conflict)"
echo "  5. /tmp/state-bisect         — bisecting (in progress)"
