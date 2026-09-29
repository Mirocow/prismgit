#!/usr/bin/env bash
# Creates 3 synthetic repos used by scripts/repo-switch-profile.mjs:
#   heavy-repo  (main)        ~2500 files, 150 commits, dirty worktree
#   medium-repo (develop)      ~400 files, 30 commits, slightly dirty
#   small-repo  (topic-light)   ~30 files, 6 commits, clean
# Usage: bash scripts/make-switch-repos.sh [targetDir]
set -euo pipefail

ROOT="${1:-/tmp/prismgit-switch-repos}"
rm -rf "$ROOT"
mkdir -p "$ROOT"

mk_repo() {
  local dir="$1" branch="$2" nfiles="$3" ncommits="$4" dirty="$5" untracked="$6"
  mkdir -p "$dir"
  cd "$dir"
  git init -q -b "$branch" .
  git config user.email "perf@test.local"
  git config user.name "Perf Test"
  # Create files in per-commit batches so history is spread out.
  local per=$(( nfiles / ncommits + 1 ))
  local remaining="$nfiles"
  local c=0
  local fileno=0
  while [ "$remaining" -gt 0 ]; do
    c=$(( c + 1 ))
    local batch=0
    while [ "$batch" -lt "$per" ] && [ "$remaining" -gt 0 ]; do
      local mod=$(( fileno / 50 ))
      mkdir -p "src/modules/m${mod}"
      printf 'export const f%s = %s;\n// padding line to give the file a realistic size for diff/status walkers\n' "$fileno" "$fileno" > "src/modules/m${mod}/f${fileno}.ts"
      fileno=$(( fileno + 1 ))
      batch=$(( batch + 1 ))
      remaining=$(( remaining - 1 ))
    done
    git add -A
    git commit -q -m "commit ${c}: add batch of ${batch} files"
  done
  # Dirty state: modify N tracked files.
  for f in $(git ls-files | head -n "$dirty"); do
    printf '\n// touched by perf setup\n' >> "$f"
  done
  # Untracked files.
  mkdir -p build-artifacts
  local u=0
  while [ "$u" -lt "$untracked" ]; do
    printf 'untracked %s\n' "$u" > "build-artifacts/u${u}.log.txt"
    u=$(( u + 1 ))
  done
  cd - > /dev/null
}

echo "creating heavy-repo (2500 files / 150 commits / 60 dirty / 300 untracked)..."
mk_repo "$ROOT/heavy-repo"   "main"       2500 150 60  300
echo "creating medium-repo (400 files / 30 commits / 10 dirty / 40 untracked)..."
mk_repo "$ROOT/medium-repo"  "develop"     400  30 10   40
echo "creating small-repo (30 files / 6 commits / clean)..."
mk_repo "$ROOT/small-repo"   "topic-light"  30   6 0    0
echo "done: $ROOT"
