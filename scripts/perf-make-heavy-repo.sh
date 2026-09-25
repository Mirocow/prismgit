#!/bin/sh
# Creates a HEAVY synthetic repo for UI perf profiling:
#  - 1200 tracked files across nested dirs
#  - 200 modified files, 40 untracked, 10 staged
#  - one big file (2000 lines) with a ~400-line diff
#  - 3000 commits of history
#  - several branches
set -e
ROOT="${1:-/tmp/prismgit-perf-repos}"
REPO="$ROOT/heavy-repo"
rm -rf "$ROOT"
mkdir -p "$REPO"
cd "$REPO"
git init -q -b main
git config user.email perf@local
git config user.name "Perf Bot"
git config core.filemode false

# 1) 1200 tracked files in nested dirs
mkdir -p src/a src/b/c/d src/e/f lib test docs
i=0
while [ $i -lt 1200 ]; do
  d=$(( i % 6 ))
  case $d in
    0) p=src/a ;; 1) p=src/b/c/d ;; 2) p=src/e/f ;; 3) p=lib ;; 4) p=test ;; 5) p=docs ;;
  esac
  printf 'line1 %s\nline2 %s\nline3 %s\nline4\nline5\nline6\nline7\nline8\n' "$i" "$i" "$i" > "$p/file$i.ts"
  i=$(( i + 1 ))
done
git add -A
git commit -qm "initial 1200 files"

# 2) 3000 commits of history (fast, tiny)
i=0
while [ $i -lt 3000 ]; do
  printf '%s\n' "$i" >> history.log
  git add history.log
  git commit -qm "commit $i"
  i=$(( i + 1 ))
done

# 3) branches
git branch -q feature/alpha
git branch -q feature/beta
git branch -q hotfix/one
git checkout -q -b feature/gamma main
printf 'gamma\n' > gamma.txt
git add gamma.txt
git commit -qm "gamma work"
git checkout -q main

# 4) 200 modified tracked files
i=0
while [ $i -lt 200 ]; do
  printf 'MODIFIED extra line %s\nmore content\n' "$i" >> "src/a/file$i.ts"
  i=$(( i + 1 ))
done

# 5) big file with big diff
{
  i=0
  while [ $i -lt 2000 ]; do printf 'big line %s with some padding text to make lines realistic length here\n' "$i"; i=$(( i+1 )); done
} > src/a/bigfile.ts
git add src/a/bigfile.ts
git commit -qm "add bigfile"
# now modify 400 lines across the big file
sed -i 's/^big line 1[0-9][0-9] /CHANGED-XXX /' src/a/bigfile.ts
sed -i 's/^big line 5[0-9][0-9] /CHANGED-YYY /' src/a/bigfile.ts
sed -i 's/^big line 9[0-9][0-9] /CHANGED-ZZZ /' src/a/bigfile.ts

# 6) 10 staged files
i=0
while [ $i -lt 10 ]; do
  printf 'staged change %s\n' "$i" >> "src/b/c/d/file$i.ts"
  git add "src/b/c/d/file$i.ts"
  i=$(( i + 1 ))
done

# 7) 40 untracked files
i=0
while [ $i -lt 40 ]; do
  printf 'untracked %s\n' "$i" > "src/e/f/newfile$i.ts"
  i=$(( i + 1 ))
done

# 8) make the repo "remote-less" so polling doesn't hit network
git remote remove origin 2>/dev/null || true
echo "HEAVY REPO READY: $REPO"
git -C "$REPO" rev-list --count HEAD
git -C "$REPO" status --porcelain | wc -l
