import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BUGFIX "не получаю все ветки хотя в Remotes они есть" — refspec helpers.
 *
 * A clone made with `--depth N` (or explicit --single-branch) configures
 * remote.<name>.fetch to a single branch. isSingleBranchRefspec() powers the
 * Branches-page warning row + one-click "Fetch all branches" remediation.
 */
import { isSingleBranchRefspec, singleBranchRemotes } from '../../src/lib/remoteSpecs';

const FULL = (name: string) => `+refs/heads/*:refs/remotes/${name}/*`;
const ONE = (name: string, branch: string) => `+refs/heads/${branch}:refs/remotes/${name}/${branch}`;

describe('isSingleBranchRefspec', () => {
  it('full wildcard refspec (with +) is NOT single-branch', () => {
    expect(isSingleBranchRefspec('origin', [FULL('origin')])).toBe(false);
  });

  it('full wildcard refspec (without +) is NOT single-branch', () => {
    expect(isSingleBranchRefspec('origin', ['refs/heads/*:refs/remotes/origin/*'])).toBe(false);
  });

  it('one-branch refspec (from --single-branch clone) IS single-branch', () => {
    expect(isSingleBranchRefspec('origin', [ONE('origin', 'main')])).toBe(true);
  });

  it('multi-refspec limited tracking IS single-branch (same user-visible symptom)', () => {
    expect(
      isSingleBranchRefspec('origin', ['+refs/heads/release/*:refs/remotes/origin/release/*']),
    ).toBe(true);
  });

  it('remote name is matched exactly — origin wildcard does not cover the github remote', () => {
    // origin has the full wildcard, but github only fetches one branch:
    // the map is queried per-remote, so the check is per remote name.
    expect(isSingleBranchRefspec('github', ['refs/heads/*:refs/remotes/origin/*'])).toBe(true);
  });

  it('missing/empty refspec list is NOT single-branch (fresh remote — nothing to remediate)', () => {
    expect(isSingleBranchRefspec('origin', undefined)).toBe(false);
    expect(isSingleBranchRefspec('origin', [])).toBe(false);
    expect(isSingleBranchRefspec('origin', null)).toBe(false);
  });

  it('whitespace around the refspec is tolerated', () => {
    expect(isSingleBranchRefspec('origin', [`  ${FULL('origin')}  `])).toBe(false);
  });

  it('regexp metacharacters in the remote name are escaped', () => {
    // A remote literally named "a.b" must not have its dots treated as
    // wildcards — "aXb" refspecs must not satisfy the full-wildcard check.
    expect(isSingleBranchRefspec('a.b', ['+refs/heads/*:refs/remotes/aXb/*'])).toBe(true);
  });
});

describe('singleBranchRemotes', () => {
  it('returns the limited remotes from a spec map', () => {
    const map = {
      origin: [FULL('origin')],
      upstream: [ONE('upstream', 'main')],
      mirror: ['+refs/heads/release/*:refs/remotes/mirror/release/*'],
    };
    expect(singleBranchRemotes(map).sort()).toEqual(['mirror', 'upstream']);
  });

  it('empty map → empty list', () => {
    expect(singleBranchRemotes({})).toEqual([]);
    expect(singleBranchRemotes(null)).toEqual([]);
    expect(singleBranchRemotes(undefined)).toEqual([]);
  });
});

// Import-time sanity: the source of the specs map (git service test) is in
// tests/integration/gitRemoteFetchSpecs.test.ts — see it for end-to-end
// detection + remediation against a REAL repository.
describe('git service surface (type contract)', () => {
  it('api surface declares remoteFetchSpecs/fetchAllBranches (ipc + preload + type stay in sync)', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const preload = readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
    const ipc = readFileSync(path.join(root, 'electron/ipc/git.ts'), 'utf8');
    const types = readFileSync(path.join(root, 'electron/types/git-api.ts'), 'utf8');
    for (const name of ['remoteFetchSpecs', 'fetchAllBranches']) {
      expect(preload.includes(name), `preload.ts missing ${name}`).toBe(true);
      expect(ipc.includes(`git:${name}`), `ipc/git.ts missing git:${name}`).toBe(true);
      expect(types.includes(name), `git-api.ts missing ${name}`).toBe(true);
    }
  });
});
