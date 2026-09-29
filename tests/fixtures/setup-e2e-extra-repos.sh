#!/bin/bash
# Creates the EXTRA e2e fixture repos used by the CDP-driven specs:
#
#   tests/e2e/ui-ux-full.spec.ts          → $BASE/ui-test/{changes,branches/work,history,diff,tags,stash,remotes/work,submodules}
#   tests/e2e/all-repo-states.spec.ts     → repo states (detached, unborn, empty…)
#   tests/e2e/conflict-resolution.spec.ts → $BASE/conflict-test-{1,2,3} (mid-merge conflicts)
#   tests/e2e/10-history-merge-tags.spec.ts
#   tests/e2e/11-search-pull.spec.ts      → $BASE/test-lab (octopus merge + tags + origin remote)
#
# Everything is self-sufficient and offline (bare remotes via the file
# protocol). Called by tests/e2e/global-setup.ts before every run, so the
# suite never depends on leftovers from a previous session.
#
# Env:
#   PRISMGIT_TEST_REPOS — base dir (default $TMPDIR/prismgit-repos; playwright.config.ts
#                         sets /tmp/prismgit-e2e-repos)
set -e
BASE="${PRISMGIT_TEST_REPOS:-${TMPDIR:-/tmp}/prismgit-repos}"
UI="$BASE/ui-test"
mkdir -p "$BASE" "$UI"

q() { git "$@" >/dev/null 2>&1; }           # quiet git
commit() { q add -A && q commit -m "$1"; }

init_repo() { # init_repo <path> [branch]
  rm -rf "$1"; mkdir -p "$1"; cd "$1"
  q init -q -b "${2:-main}"
  q config user.name "Test User"
  q config user.email "test@test.com"
  q config commit.gpgsign false
}

# ─────────────────────────────────────────────────────────────────────────────
# 1) ui-test/changes — modified + deleted + untracked + one STAGED file
#    Assertions depend on: a.txt modified, c.py deleted, newfile.go untracked,
#    b.txt staged (index), and enough untouched files for a realistic list.
# ─────────────────────────────────────────────────────────────────────────────
init_repo "$UI/changes"
printf 'line one\nline two\nline three\n' > a.txt
printf 'stable\n' > b.txt
printf 'print("c")\n' > c.py
printf 'readme\n' > README.md
commit "base commit"
printf 'line one\nline two CHANGED\nline three\n' > a.txt   # modified (unstaged)
rm c.py                                                     # deleted (unstaged)
printf 'package main\n' > newfile.go                        # untracked
printf 'staged content\n' > b.txt && q add b.txt            # staged modification

# ─────────────────────────────────────────────────────────────────────────────
# 2) ui-test/branches/work — main + feature/alpha + feature/beta + hotfix/urgent
# ─────────────────────────────────────────────────────────────────────────────
init_repo "$UI/branches/work"
printf 'main base\n' > README.md && commit "main base"
q checkout -q -b feature/alpha
printf 'alpha\n' > alpha.txt && commit "alpha work"
q checkout -q main
q checkout -q -b feature/beta
printf 'beta\n' > beta.txt && commit "beta work"
q checkout -q main
q checkout -q -b hotfix/urgent
printf 'urgent\n' > hotfix.txt && commit "urgent fix"
q checkout -q main
printf 'more main\n' >> README.md && commit "main second commit"

# ─────────────────────────────────────────────────────────────────────────────
# 3) ui-test/history — linear history + a merge commit for the graph
# ─────────────────────────────────────────────────────────────────────────────
init_repo "$UI/history"
for i in $(seq 1 12); do printf "content %s\n" "$i" > "file$i.txt"; commit "commit $i"; done
q checkout -q -b feature/graph
printf 'graph feature\n' > graph.txt && commit "graph feature work"
q checkout -q main
printf 'divergent\n' > diverge.txt && commit "main diverges"
q merge -q --no-ff -m "Merge branch 'feature/graph' into main" feature/graph

# ─────────────────────────────────────────────────────────────────────────────
# 4) ui-test/diff — one modified file with a multi-line change
# ─────────────────────────────────────────────────────────────────────────────
init_repo "$UI/diff"
printf 'export const config = {\n  port: 3000,\n  host: "localhost",\n};\n' > config.ts
printf 'helper\n' > helper.ts
commit "base config"
printf 'export const config = {\n  port: 8080,\n  host: "0.0.0.0",\n  debug: true,\n};\n' > config.ts

# ─────────────────────────────────────────────────────────────────────────────
# 5) ui-test/tags — v1.0.0 lightweight + v1.1.0 annotated (+ a few more)
# ─────────────────────────────────────────────────────────────────────────────
init_repo "$UI/tags"
printf 'v1\n' > release.txt && commit "release 1"
q tag v1.0.0
printf 'v2\n' > release.txt && commit "release 2"
q tag -a v1.1.0 -m "annotated release 1.1.0"
printf 'v3\n' > release.txt && commit "release 3"
q tag v1.2.0

# ─────────────────────────────────────────────────────────────────────────────
# 6) ui-test/stash — two stash entries (one with a message)
# ─────────────────────────────────────────────────────────────────────────────
init_repo "$UI/stash"
printf 'base\n' > s.txt && commit "base"
printf 'wip change 1\n' > s.txt && q stash -q
printf 'wip change 2\n' > s.txt && q stash push -q -m "second wip"

# ─────────────────────────────────────────────────────────────────────────────
# 7) ui-test/remotes/work — origin + upstream (file-protocol bare remotes)
# ─────────────────────────────────────────────────────────────────────────────
rm -rf "$UI/remotes"
mkdir -p "$UI/remotes"
q clone -q --bare "$UI/branches/work" "$UI/remotes/origin-bare.git"
q clone -q --bare "$UI/tags" "$UI/remotes/upstream-bare.git"
q clone -q "$UI/remotes/origin-bare.git" "$UI/remotes/work"
cd "$UI/remotes/work"
q remote add upstream "$UI/remotes/upstream-bare.git"
q fetch -q upstream || true
q branch --set-upstream-to=origin/main main 2>/dev/null || true

# ─────────────────────────────────────────────────────────────────────────────
# 8) ui-test/submodules — one repo + one submodule at sub/
#    (sub source is a BARE repo kept outside the parent so it survives the
#    parent's own dir shuffle)
# ─────────────────────────────────────────────────────────────────────────────
rm -rf "$UI/sub-src.git" "$UI/.sub-temp" "$UI/submodules"
init_repo "$UI/.sub-temp"
printf 'sub module content\n' > inner.txt && commit "sub base"
q clone -q --bare "$UI/.sub-temp" "$UI/sub-src.git"
rm -rf "$UI/.sub-temp"
init_repo "$UI/submodules"
printf 'outer\n' > outer.txt && commit "outer base"
q -C "$UI/submodules" -c protocol.file.allow=always submodule add -q "$UI/sub-src.git" sub 2>/dev/null || \
  q -C "$UI/submodules" submodule add -q "$UI/sub-src.git" sub
q -C "$UI/submodules" commit -q -m "add submodule sub" 2>/dev/null || true

# ─────────────────────────────────────────────────────────────────────────────
# 9) conflict-test-1/2/3 — repos frozen MID-MERGE with real conflicts
# ─────────────────────────────────────────────────────────────────────────────
mk_conflict_repo() { # <path> <files…>
  local R="$1"; shift
  init_repo "$R"
  for f in "$@"; do mkdir -p "$(dirname "$R/$f")"; printf 'original line 1\noriginal line 2\noriginal line 3\n' > "$R/$f"; done
  commit "base state"
  q checkout -q -b feature
  for f in "$@"; do printf 'original line 1\nFEATURE changed this line\noriginal line 3\n' > "$R/$f"; done
  commit "feature side"
  q checkout -q main
  for f in "$@"; do printf 'original line 1\nMAIN changed this line\noriginal line 3\n' > "$R/$f"; done
  commit "main side"
  q merge feature >/dev/null 2>&1 || true   # leaves MERGE_HEAD + stages 1/2/3
}

mk_conflict_repo "$BASE/conflict-test-1" "config.ts"
mk_conflict_repo "$BASE/conflict-test-2" "file1.ts" "file2.py" "file3.go"
mk_conflict_repo "$BASE/conflict-test-3" "src/components/Button.tsx"

# ─────────────────────────────────────────────────────────────────────────────
# 10) test-lab — octopus merge + tag decorations + grep-able content + origin
#     Used by 10-history-merge-tags.spec.ts and 11-search-pull.spec.ts.
#
#     History shape:
#       c0 ── c1 ──────────────── octopus merge (4 parents, msg
#         ╲ x-branch commit        "merge: octopus x+y+z", annotated v-ui-test)
#          ╲ y-branch commit
#           ╲ z-branch commit
#     ^1..<merge> therefore lists the three branch commits — exactly what the
#     History "Merged commits" panel must show.
# ─────────────────────────────────────────────────────────────────────────────
init_repo "$BASE/test-lab"
printf '# test-lab\n' > README.md
mkdir -p src/lib
cat > src/lib/util.ts <<'EOF'
export function utilSlug(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}
export const UTIL_TOKEN = 'prismgit-util-token';
EOF
commit "chore: base"
q tag v0.100
printf 'more base\n' >> README.md && commit "chore: more base"
q tag v0.500

q checkout -q -b branch-x
printf 'x content\n' > x.txt && commit "chore: x branch commit"
q checkout -q main
q checkout -q -b branch-y
printf 'y content\n' > y.txt && commit "chore: y branch commit"
q checkout -q main
q checkout -q -b branch-z
printf 'z content\n' > z.txt && commit "chore: z branch commit"
q checkout -q main
# Integration commit on main AFTER the branches diverged — WITHOUT it git
# would fast-forward through branch-x and produce a 3-parent merge whose
# ^1..<merge> lists only y+z. With it, the octopus has 4 parents and
# ^1..<merge> lists ALL THREE branch commits (what the History "Merged
# commits" panel + the merged-FILES diff must show).
printf 'integration point\n' > integrate.txt && commit "chore: main integration point"
q merge -q -m "merge: octopus x+y+z" branch-x branch-y branch-z
q tag -a v-ui-test -m "annotated ui test tag on the octopus merge"

# origin remote with fetched remote branches (Pull dialog remote selector)
rm -rf "$BASE/test-lab-origin.git"
q clone -q --bare "$BASE/test-lab" "$BASE/test-lab-origin.git"
q remote add origin "$BASE/test-lab-origin.git"
q fetch -q origin || true

# ─────────────────────────────────────────────────────────────────────────────
# 11) all-repo-states fixtures (all-repo-states.spec.ts):
#     detached HEAD, unborn branch, bare repo, empty dir, conflicted
#     (conflict-test-1), submodules (ui-test/submodules) — plus the five
#     IN-PROGRESS states the RepoStateBanner exercises:
#     state-merge / state-cherry-pick / state-rebase / state-revert /
#     state-bisect.
# ─────────────────────────────────────────────────────────────────────────────
init_repo "$BASE/state-detached"
printf 'detached\n' > d.txt && commit "d1"
q checkout -q -b side && printf 'side\n' > s.txt && commit "d2 side"
DETACHED_SHA=$(git -C "$BASE/state-detached" rev-parse HEAD~1)
q -C "$BASE/state-detached" checkout -q --detach "$DETACHED_SHA"

init_repo "$BASE/state-unborn"
q checkout -q -b other
printf 'unborn\n' > u.txt && q add -A && q commit -q -m "only on other"
# Point HEAD back at the never-committed main branch — the app must handle
# an unborn HEAD (no commits) while other refs exist. The index keeps u.txt,
# which shows as a staged new file (realistic first-repo state).
git symbolic-ref HEAD refs/heads/main

rm -rf "$BASE/state-bare.git"
q clone -q --bare "$BASE/test-lab" "$BASE/state-bare.git"

rm -rf "$BASE/state-empty"
mkdir -p "$BASE/state-empty"

# state-merge — mid-merge with conflict (MERGE_HEAD present)
mk_conflict_repo "$BASE/state-merge" "file.txt"

# state-cherry-pick — cherry-pick stopped on conflict (CHERRY_PICK_HEAD)
init_repo "$BASE/state-cherry-pick"
printf 'line 1\nline 2\nline 3\n' > file.txt && commit "cp base"
q checkout -q -b source
printf 'line 1\nSOURCE line 2\nline 3\n' > file.txt && commit "source change to pick"
PICK_SHA=$(git -C "$BASE/state-cherry-pick" rev-parse HEAD)
q checkout -q main
printf 'line 1\nMAIN line 2\nline 3\n' > file.txt && commit "main change conflicts with pick"
git -C "$BASE/state-cherry-pick" cherry-pick "$PICK_SHA" >/dev/null 2>&1 || true

# state-rebase — rebase stopped on conflict (rebase-merge dir present)
init_repo "$BASE/state-rebase"
printf 'line 1\nline 2\nline 3\n' > file.txt && commit "rb base"
q checkout -q -b topic
printf 'line 1\nTOPIC line 2\nline 3\n' > file.txt && commit "topic change"
q checkout -q main
printf 'line 1\nMAIN line 2\nline 3\n' > file.txt && commit "main diverged"
q checkout -q topic
git -C "$BASE/state-rebase" rebase main >/dev/null 2>&1 || true

# state-revert — revert stopped on conflict (REVERT_HEAD present)
init_repo "$BASE/state-revert"
printf 'line 1\nline 2\nline 3\n' > file.txt && commit "rv base"
printf 'line 1\nCHANGED line 2\nline 3\n' > file.txt && commit "change to revert"
REVERT_SHA=$(git -C "$BASE/state-revert" rev-parse HEAD)
printf 'line 1\nCHANGED AGAIN line 2\nline 3\n' > file.txt && commit "later change conflicts"
git -C "$BASE/state-revert" revert --no-edit "$REVERT_SHA" >/dev/null 2>&1 || true

# state-bisect — bisect session in progress (detached at candidate)
init_repo "$BASE/state-bisect"
printf 'good\n' > b.txt && commit "bisect: good commit"
printf 'bad\n'  > b.txt && commit "bisect: bad commit"
q bisect start
q bisect bad
q bisect good HEAD~1

echo "[setup-e2e-extra-repos] fixtures ready under $BASE"
