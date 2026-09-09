# Testing Strategy — smartgit-electron

## Overview

The project uses a four-layer test pyramid. Every layer answers a different
question, so a bug is caught by the cheapest layer that can see it:

| Layer | Location | What it verifies | Speed | When it runs |
|-------|----------|------------------|-------|--------------|
| **Unit** | `tests/unit/` | Pure logic: parsers (`diffParser`, `conflictParser`, `wordDiff`, `gitGraph`, `graphAncestry`, `branchTree`, `fileTree`), stores (`selectionStore`, `toolbarStore`, `settingsStore`, `toastStore`, `repositoryStore`), utilities | ~1–2 s | Every `npm test`, included in the verify gate |
| **Component** | `tests/components/` | React components in isolation (`DiffViewer`, `ToastContainer`, `WelcomeScreen`) with mocked `window.smartgit` | ~1 s | Every `npm test` |
| **Integration** | `tests/integration/` | `electron/services/git.ts` against **real git repositories** — the whole IPC service layer without Electron | ~10–20 s | Every `npm test` |
| **E2E** | manual / CDP driver | The real Electron app under xvfb: boot, pages, toolbars, dialogs, console errors | ~1–2 min | Before releases / after large UI changes (recreate the CDP driver when needed — see git history `f1de064`) |

## Commands

```bash
npm test                 # unit + component + integration (vitest run)
npm run test:unit        # only tests/unit + tests/components
npm run test:integration # only tests/integration
npm run test:watch       # watch mode during development
npm run test:coverage    # with v8 coverage report

npm run verify           # typecheck + ALL tests + production build  ← the gate
npm run hooks:install    # activate the pre-push hook (one time per clone)
```

## The verify gate (pre-push hook)

`scripts/git-hooks/pre-push` runs `npm run verify` **before every push**.
A push with failing typecheck, tests, or build is aborted — global changes
physically cannot land without passing the whole gate.

- Install once per clone: `npm run hooks:install` (sets `core.hooksPath`).
- Emergency bypass (use sparingly): `SMARTGIT_SKIP_VERIFY=1 git push`.

## Integration test suites

1. **`gitService.workflows.test.ts`** — fully self-contained: builds its own
   disposable environment (working repo + bare remote in a tmpdir) inside
   `beforeAll`, so it runs on any machine and in CI without setup scripts.
   Covers the workflow families: reset (soft/mixed/hard/keep, resetFile),
   rebase (clean/conflict+continue/skip/abort), merge (ff-only rejection,
   squash, strategy=ours, conflict+continueMerge, mergeTree preview),
   stash (push/apply/pop/drop/branch/include-untracked), remote sync
   (push/pull/fetch/fetchAll/aheadBehind/pushTag/deleteTag),
   findCommit, checkoutFile, ignore/isIgnored, editCommitMessage,
   clean, worktrees, bisect, config, stageLines/unstageLines,
   splitCommit, reflog, init/clone.

2. **`gitService.real.test.ts`** — against the fixture repo built by
   `scripts/setup-test-repo.sh` (run it once if the fixture is missing).

3. **`comprehensive.test.ts` / `ollama-code.test.ts`** — scenario suites
   mirroring the manual test plan (blocks 1–8) and the big-repo performance
   fixture (1200+ commits, 600+ tags).

## What is intentionally NOT automated here

- Real Electron window interactions (native context menus, drag-and-drop).
  Those were verified with the CDP driver approach — revive it from
  commit `f1de064` (`scripts/ui-driver.mjs`, `scripts/ui-scenarios.mjs`)
  when a UI regression sweep is needed.
- Network-dependent operations (GitHub auth, real HTTPS remotes).
  The suites use a local bare remote as `origin` instead.

## Conventions for new tests

- Integration tests must be **self-contained**: create temp repos with
  `gitService.init()` + repo-local `user.name/user.email/core.editor=true`
  config; never depend on global git state or external scripts; clean up in
  `afterAll`.
- Prefer asserting via `gitService` (the code under test) and verify git
  state via raw `git` CLI only for fixture setup / independent verification.
- `status()` returns simple-git field names: `not_added` (untracked),
  `modified` (unstaged tracked), `staged` (index entries), `conflicted`.
- `git.commit(array)` means *multiple `-m` flags* in simple-git — never pass
  git flags (like `--amend`) through `commit()`; use `git.raw([...])`.
- Interactive-rebase tricks (custom `sequence.editor`) require a dedicated
  `simpleGit({ unsafe: { allowUnsafeEditor: true } })` instance.
