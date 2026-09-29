/**
 * Playwright global setup — (re)create the fixture test repositories.
 *
 * The e2e suite expects a fully-populated fixture repo at
 * $PRISMGIT_TEST_REPOS/test-repo (path standardized by playwright.config.ts).
 * The suite used to rely on the fixture surviving in /tmp between sessions,
 * which broke on fresh machines/CI. Running tests/fixtures/setup-test-repo.sh
 * here makes every e2e run self-sufficient and deterministic.
 *
 * E2E FIX (root cause #6): the CDP specs (ui-ux-full / all-repo-states /
 * conflict-resolution) and the 10/11 specs also need their own fixture repos
 * (ui-test/*, conflict-test-*, test-lab, state-*) that NOTHING used to
 * create — the specs silently no-op'd (or skipped) without them. The second
 * script below creates all of them on every run.
 */
import { execSync } from 'child_process';
import * as path from 'path';

export default function globalSetup(): void {
  const base = process.env.PRISMGIT_TEST_REPOS;
  if (!base) throw new Error('PRISMGIT_TEST_REPOS is not set (playwright.config.ts must define it)');
  const root = path.join(__dirname, '..', '..');
  execSync('bash tests/fixtures/setup-test-repo.sh', {
    cwd: root,
    env: { ...process.env, PRISMGIT_TEST_REPOS: base },
    stdio: 'inherit',
  });
  execSync('bash tests/fixtures/setup-e2e-extra-repos.sh', {
    cwd: root,
    env: { ...process.env, PRISMGIT_TEST_REPOS: base },
    stdio: 'inherit',
  });
}
