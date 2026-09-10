#!/usr/bin/env bash
# Install git hooks for smartgit-electron (points core.hooksPath at scripts/git-hooks).
set -e
cd "$(dirname "$0")/.."
git config core.hooksPath scripts/git-hooks
chmod +x scripts/git-hooks/*
echo "[hooks] installed: core.hooksPath = $(git config core.hooksPath)"
echo "[hooks] every 'git push' now runs 'npm run verify' first (skip: SMARTGIT_SKIP_VERIFY=1 git push)"
