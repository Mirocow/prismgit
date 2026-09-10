#!/bin/bash
# Creates /home/z/my-project/repos/test-repo fixture expected by
# tests/integration/gitService.real.test.ts.
#
# Invariants the suite relies on:
#   - author "Test User" <test@test.com> on every commit
#   - main: setup commits -> merge commit "Merge feature/auth into main" (2 parents) -> "Latest main commit"
#   - feature/auth: "Add login function" (creates src/auth.js), "Add logout function"
#   - feature/api: "Add API config" (creates src/config.js), "Add API fetch helper" (creates src/api.js)
#   - develop: branched at the MERGE commit (before "Latest main commit"), adds exactly 2 commits
#   - main has exactly 1 commit after develop's branch point ("Latest main commit"):
#     FF-merge test adds +1 empty, no-ff cleanup removes it (no origin remote -> HEAD~1)
#   - main history deep enough for main~3 / HEAD~2 used in tests
#   - local branches >= 5 (main, feature/auth, feature/api, develop, staging)
#   - NO remotes ("remotes > returns empty list", "remote branches = 0")
#   - tags: v1 (lightweight), v1.0.0 (lightweight), v1.0.1 (annotated)
#   - tracked files: src/index.js (contains 'function'), src/version.js, .gitignore, README.md
set -e
# Use PRISMGIT_TEST_REPOS env var or fall back to a cross-platform temp dir.
# Previously hardcoded /home/z/my-project/repos which only works on the
# Linux dev container — macOS doesn't have /home/z.
# Default: $TMPDIR/repos (macOS) or /tmp/repos (Linux)
BASE="${PRISMGIT_TEST_REPOS:-${TMPDIR:-/tmp}/prismgit-repos}"
mkdir -p "$BASE"
REPO="$BASE/test-repo"

rm -rf "$REPO"
mkdir -p "$REPO/src"
cd "$REPO"
git init -q -b main
git config user.name "Test User"
git config user.email "test@test.com"

echo "# Test Repo" > README.md
echo "*.log" > .gitignore
cat > src/index.js <<'EOF'
function hello() {
  return "world";
}
EOF
echo "const VERSION = '1.0.0';" > src/version.js
git add -A
git commit -q -m "Initial commit"
git tag v1

# feature/auth — merged into main
git checkout -q -b feature/auth
echo "export function login() {}" > src/auth.js
git add -A
git commit -q -m "Add login function"
echo "export function logout() {}" >> src/auth.js
git commit -q -am "Add logout function"

# feature/api — never merged
git checkout -q main
git checkout -q -b feature/api
echo "export const config = { api: true };" > src/config.js
git add -A
git commit -q -m "Add API config"
echo "export function fetchHelper() {}" > src/api.js
git add -A
git commit -q -m "Add API fetch helper"

# main: setup commits, merge feature/auth (--no-ff, 2 parents), then "Latest main commit"
git checkout -q main
echo "main setup 1" > src/main1.js
git add -A
git commit -q -m "Main setup 1"
echo "main setup 2" > src/main2.js
git add -A
git commit -q -m "Main setup 2"
echo "main setup 3" > src/main3.js
git add -A
git commit -q -m "Main setup 3"
git merge -q --no-ff feature/auth -m "Merge feature/auth into main"

# develop — branches at the MERGE commit (before "Latest main commit")
git checkout -q -b develop
echo "dev work 1" > develop.txt
git add -A
git commit -q -m "Develop branch commit 1"
echo "dev work 2" >> develop.txt
git commit -q -am "Develop branch commit 2"

# main: the single commit after develop's branch point
git checkout -q main
echo "latest main" >> README.md
git commit -q -am "Latest main commit"

# 5th local branch (no extra commits) + tags on main tip
git checkout -q main
git branch staging
git tag v1.0.0
git tag -a v1.0.1 -m "Release 1.0.1"

echo "test-repo fixture ready at $REPO"
echo "branches: $(git branch | wc -l), tags: $(git tag | wc -l), remotes: $(git remote | wc -l)"
