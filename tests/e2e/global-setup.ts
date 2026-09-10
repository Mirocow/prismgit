/**
 * Playwright global setup — (re)create the fixture test repository.
 *
 * The e2e suite expects a fully-populated fixture repo at
 * $PRISMGIT_TEST_REPOS/test-repo (path standardized by playwright.config.ts).
 * The suite used to rely on the fixture surviving in /tmp between sessions,
 * which broke on fresh machines/CI. Running tests/fixtures/setup-test-repo.sh
 * here makes every e2e run self-sufficient and deterministic.
 */
import { execSync } from 'child_process';
import * as path from 'path';

export default function globalSetup(): void {
  const base = process.env.PRISMGIT_TEST_REPOS;
  if (!base) throw new Error('PRISMGIT_TEST_REPOS is not set (playwright.config.ts must define it)');
  execSync('bash tests/fixtures/setup-test-repo.sh', {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, PRISMGIT_TEST_REPOS: base },
    stdio: 'inherit',
  });
}
