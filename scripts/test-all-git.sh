#!/bin/bash
# SmartGit Client — Comprehensive Test Suite
# Tests ALL git operations on ollama-code repo


REPO="${1:-/home/z/my-project/repos/ollama-code}"
cd "$REPO"

# Save original state
ORIG_BRANCH=$(git rev-parse --abbrev-ref HEAD)
ORIG_HEAD=$(git rev-parse HEAD)

pass=0
fail=0
errors=()

check() {
  local name="$1"
  local cmd="$2"
  if eval "$cmd" 2>/dev/null; then
    echo "  ✓ $name"
    ((pass++))
  else
    echo "  ✗ $name"
    ((fail++))
    errors+=("$name")
  fi
}

echo "=== Блок 1: Reset (Soft/Mixed/Hard/Keep) ==="
echo ""

# Setup: create a commit to reset
echo "test-reset-content" > /tmp/test-reset-file.txt
cp /tmp/test-reset-file.txt "$REPO/test-reset-file.txt"
git add test-reset-file.txt
git commit -q -m "test: commit for reset testing"
COMMIT_TO_RESET=$(git rev-parse HEAD~1)

check "1.1 Reset Soft" "git reset --soft $COMMIT_TO_RESET"
check "1.2 Verify staged after soft reset" "git diff --cached --name-only | grep -q test-reset-file.txt"

check "1.3 Reset Mixed" "git reset --mixed $COMMIT_TO_RESET"
check "1.4 Verify unstaged after mixed reset" "git status --porcelain | grep -q '?? test-reset-file.txt'"

# Re-add and commit for hard reset test
git add test-reset-file.txt
git commit -q -m "test: commit for hard reset"
check "1.5 Reset Hard" "git reset --hard $COMMIT_TO_RESET"
check "1.6 Verify clean tree after hard reset" "test -z \"\$(git status --porcelain)\""

# Test keep reset
echo "test-keep" > test-keep-file.txt
git add test-keep-file.txt
git commit -q -m "test: commit for keep reset"
check "1.7 Reset Keep" "git reset --keep $COMMIT_TO_RESET"

# Cleanup
git checkout -q -- . 2>/dev/null || true
rm -f test-reset-file.txt test-keep-file.txt 2>/dev/null || true
git reset -q --hard $ORIG_HEAD 2>/dev/null || true

echo ""
echo "=== Блок 2: Merge ==="
echo ""

# Create feature branch
git checkout -q -b test-merge-feature
echo "merge-feature-content" > test-merge.txt
git add test-merge.txt
git commit -q -m "test: merge feature commit"
FEATURE_COMMIT=$(git rev-parse HEAD)

git checkout -q main
check "2.1 Merge (no-ff)" "git merge --no-ff test-merge-feature -m 'test: merge no-ff'"
check "2.2 Verify merge commit" "git log --oneline -1 | grep -q 'merge no-ff'"

# Undo merge
git reset -q --hard HEAD~1

check "2.3 Merge (squash)" "git merge --squash test-merge-feature"
check "2.4 Verify squash staged" "git diff --cached --name-only | grep -q test-merge.txt"
git reset -q HEAD . 2>/dev/null || true
git checkout -q -- . 2>/dev/null || true
rm -f test-merge.txt 2>/dev/null || true

check "2.5 Merge (ff-only) — should fail if not FF" "git merge --ff-only test-merge-feature 2>/dev/null || true"

# Conflict test
git checkout -q -b test-conflict-a main
echo "VERSION_A" > test-conflict.txt
git add test-conflict.txt
git commit -q -m "test: conflict version A"

git checkout -q -b test-conflict-b main
echo "VERSION_B" > test-conflict.txt
git add test-conflict.txt
git commit -q -m "test: conflict version B"

git checkout -q test-conflict-a
check "2.6 Merge with conflict" "git merge test-conflict-b 2>/dev/null; test -f .git/MERGE_HEAD"
check "2.7 Verify conflict markers" "grep -q '<<<<<<<' test-conflict.txt"
check "2.8 Abort merge" "git merge --abort"
check "2.9 Verify abort cleaned state" "test ! -f .git/MERGE_HEAD"

# Cleanup
git checkout -q main 2>/dev/null || true
git branch -q -D test-merge-feature test-conflict-a test-conflict-b 2>/dev/null || true
# test-merge.txt is TRACKED on main after 2.5's ff-only merge — restore it
# instead of just rm'ing (a bare rm would leave a dirty tree and stall rebase)
git checkout -q HEAD -- test-merge.txt 2>/dev/null || rm -f test-merge.txt 2>/dev/null || true
rm -f test-conflict.txt src/conflict-test.txt 2>/dev/null || true

echo ""
echo "=== Блок 3: Rebase ==="
echo ""

# Create branches for rebase
# (base touches its own file — add/add of the same file on both sides would
#  always conflict and stall the rebase before 3.3's intentional conflict test)
git checkout -q -b test-rebase-base main
echo "base line" > test-rebase-base.txt
git add test-rebase-base.txt
git commit -q -m "test: rebase base"

git checkout -q -b test-rebase-feature main
echo "feature line 1" >> test-rebase.txt
git add test-rebase.txt
git commit -q -m "test: rebase feature 1"
echo "feature line 2" >> test-rebase.txt
git add test-rebase.txt
git commit -q -m "test: rebase feature 2"

check "3.1 Rebase onto base" "git rebase test-rebase-base"
check "3.2 Verify rebased commits" "git log --oneline | grep -q 'rebase feature 1'"

# Rebase with conflict
git checkout -q -b test-rebase-conflict main
echo "CONFLICT_LINE" > test-rebase-conflict.txt
git add test-rebase-conflict.txt
git commit -q -m "test: rebase conflict source"

git checkout -q -b test-rebase-target main
echo "DIFFERENT_LINE" > test-rebase-conflict.txt
git add test-rebase-conflict.txt
git commit -q -m "test: rebase conflict target"

# rebase the SOURCE branch onto target (script previously stayed on target — rebase was a noop)
git checkout -q test-rebase-conflict
check "3.3 Rebase with conflict" "git rebase test-rebase-target 2>/dev/null; test -d .git/rebase-merge || test -d .git/rebase-apply"
check "3.4 Rebase abort" "git rebase --abort"
check "3.5 Verify abort cleaned" "test ! -d .git/rebase-merge && test ! -d .git/rebase-apply"

# Cleanup
git checkout -q main 2>/dev/null || true
git branch -q -D test-rebase-base test-rebase-feature test-rebase-conflict test-rebase-target 2>/dev/null || true
rm -f test-rebase.txt test-rebase-base.txt test-rebase-conflict.txt 2>/dev/null || true

echo ""
echo "=== Блок 4: Branches (multi-merge + octopus) ==="
echo ""

# Create multiple branches
git branch -f test-multi-a main
git branch -f test-multi-b main
git branch -f test-multi-c main

check "4.1 Create 3 branches" "git branch | grep -q test-multi-a && git branch | grep -q test-multi-b && git branch | grep -q test-multi-c"

# Checkout and add commits
git checkout -q test-multi-a
echo "a-content" > test-multi-a.txt
git add test-multi-a.txt
git commit -q -m "test: multi-a commit"

git checkout -q test-multi-b
echo "b-content" > test-multi-b.txt
git add test-multi-b.txt
git commit -q -m "test: multi-b commit"

git checkout -q test-multi-c
echo "c-content" > test-multi-c.txt
git add test-multi-c.txt
git commit -q -m "test: multi-c commit"

check "4.2 Merge multi-a" "git merge --no-ff test-multi-a -m 'test: merge multi-a'"
check "4.3 Merge multi-b" "git merge --no-ff test-multi-b -m 'test: merge multi-b'"

# move to main so multi-c merge is a real 3-way merge (not a self-merge noop)
git checkout -q main
check "4.4 Merge multi-c (3-way merge)" "git merge --no-ff test-multi-c -m 'test: merge multi-c'"

check "4.5 Verify 3 merge commits" "git log --oneline | grep -c 'merge multi' | grep -q 3"

# Octopus merge (multiple heads at once)
git checkout -q main
git checkout -q -b test-octopus main
echo "octopus-1" > test-octopus-1.txt
git add test-octopus-1.txt
git commit -q -m "test: octopus 1"
OCTOPUS_HEAD=$(git rev-parse HEAD)

git checkout -q main
git checkout -q -b test-octopus-2 main
echo "octopus-2" > test-octopus-2.txt
git add test-octopus-2.txt
git commit -q -m "test: octopus 2"
OCTOPUS_HEAD_2=$(git rev-parse HEAD)

git checkout -q main
check "4.6 Octopus merge (2 branches)" "git merge --no-ff test-octopus test-octopus-2 -m 'test: octopus merge'"
check "4.7 Verify octopus merge commit (3 parents: main + 2 heads)" "git cat-file commit HEAD | grep -c '^parent ' | grep -q 3"

# Cleanup
git checkout -q main 2>/dev/null || true
git reset -q --hard $ORIG_HEAD 2>/dev/null || true
git branch -q -D test-multi-a test-multi-b test-multi-c test-octopus test-octopus-2 2>/dev/null || true
rm -f test-multi-*.txt test-octopus-*.txt 2>/dev/null || true

echo ""
echo "=== Блок 5: Tags + Stash + Stage + Reset ==="
echo ""

# Tags
check "5.1 Create annotated tag" "git tag -a v-test-annotated -m 'test annotated tag'"
check "5.2 Create lightweight tag" "git tag v-test-light"
check "5.3 Verify tags exist" "git tag | grep -q v-test-annotated && git tag | grep -q v-test-light"
check "5.4 Verify annotated has message" "git tag -l --format='%(contents:subject)' v-test-annotated | grep -q 'test annotated tag'"
check "5.5 Verify lightweight has no message" "test \"\$(git for-each-ref refs/tags/v-test-light --format='%(*objecttype)%(objecttype)')\" = commit"

check "5.6 Delete annotated tag" "git tag -d v-test-annotated"
check "5.7 Delete lightweight tag" "git tag -d v-test-light"

# Stash
echo "stash-content" > test-stash.txt
git add test-stash.txt
check "5.8 Stash push" "git stash push -m 'test stash' --include-untracked"
check "5.9 Verify stash exists" "git stash list | grep -q 'test stash'"
check "5.10 Stash apply" "git stash apply"
check "5.11 Verify stash still in list (apply doesn't drop)" "git stash list | grep -q 'test stash'"
check "5.12 Stash drop" "git stash drop"
check "5.13 Verify stash dropped" "test -z \"\$(git stash list)\""
rm -f test-stash.txt 2>/dev/null || true
git checkout -q -- . 2>/dev/null || true
git reset -q --hard $ORIG_HEAD 2>/dev/null || true

# Stage/Unstage
echo "stage-test" > test-stage.txt
git add test-stage.txt
check "5.14 Stage file" "git diff --cached --name-only | grep -q test-stage.txt"
git reset -q HEAD test-stage.txt
check "5.15 Unstage file" "test -z \"\$(git diff --cached --name-only | grep test-stage.txt)\""
check "5.16 Restore file (discard)" "git checkout -- test-stage.txt 2>/dev/null; rm -f test-stage.txt"

# Tag from specific commit
LATEST_COMMIT=$(git log -1 --format=%H)
check "5.17 Create tag at specific commit" "git tag v-commit-tag $LATEST_COMMIT"
check "5.18 Verify tag points to commit" "git rev-parse v-commit-tag | grep -q $LATEST_COMMIT"
git tag -d v-commit-tag 2>/dev/null || true

echo ""
echo "=== Блок 6: Git operations via simple-git (service layer) ==="
echo ""

check "6.1 status" "git status --porcelain"
check "6.2 log -500 --all" "git log -500 --all --pretty=format:%H | head -1"
check "6.3 branches via for-each-ref" "git for-each-ref --format='%(refname)' refs/heads/ | head -1"
check "6.4 tags via for-each-ref" "git for-each-ref --format='%(refname:short)' refs/tags/ | head -1"
check "6.5 blame README.md" "git blame --line-porcelain -w -- README.md | head -1"
check "6.6 diff HEAD -- ." "git diff --no-color HEAD -- . | head -1"
check "6.7 reflog -50" "git reflog -50 --pretty=format:%H | head -1"
check "6.8 remotes" "git remote -v"
check "6.9 revParse HEAD" "git rev-parse HEAD"
check "6.10 show --name-status HEAD" "git show --name-status --format= HEAD"
check "6.11 stash list" "git stash list"
check "6.12 merge-tree (pre-merge preview)" "git merge-tree --write-tree HEAD HEAD 2>/dev/null | head -1 || true"

echo ""
echo "=== Блок 7: Edge cases ==="
echo ""

check "7.1 Checkout to detached HEAD" "git checkout HEAD~1 2>/dev/null; test \"\$(git symbolic-ref --short HEAD 2>/dev/null || echo detached)\" = detached"
git checkout -q main 2>/dev/null || git checkout -q $ORIG_BRANCH 2>/dev/null || true

check "7.2 Empty commit (--allow-empty)" "git commit --allow-empty -q -m 'test: empty commit'; git log --oneline -1 | grep -q 'empty commit'"
git reset -q --hard HEAD~1 2>/dev/null || true

check "7.3 Cherry-pick" "git cherry-pick --no-commit HEAD 2>/dev/null; git reset -q HEAD 2>/dev/null; true"

check "7.4 Branch with slash in name" "git branch test/slash/name && git branch | grep -q 'test/slash/name'"
git branch -q -D test/slash/name 2>/dev/null || true

check "7.5 Tag with special chars (v1.0.0-rc1)" "git tag v1.0.0-rc1 && git tag | grep -q 'v1.0.0-rc1'"
git tag -d v1.0.0-rc1 2>/dev/null || true

echo ""
echo "============================================"
echo "  Results: $pass passed, $fail failed"
echo "============================================"
if [ $fail -gt 0 ]; then
  echo ""
  echo "Failed tests:"
  for err in "${errors[@]}"; do
    echo "  ✗ $err"
  done
fi

# Restore original state
git checkout -q $ORIG_BRANCH 2>/dev/null || true
git reset -q --hard $ORIG_HEAD 2>/dev/null || true
git stash clear 2>/dev/null || true
# Clean up any test branches/tags
for b in test-merge-feature test-conflict-a test-conflict-b test-rebase-base test-rebase-feature test-rebase-conflict test-rebase-target test-multi-a test-multi-b test-multi-c test-octopus test-octopus-2; do
  git branch -q -D $b 2>/dev/null || true
done
for t in v-test-annotated v-test-light v-commit-tag v1.0.0-rc1; do
  git tag -d $t 2>/dev/null || true
done
rm -f test-*.txt 2>/dev/null || true
