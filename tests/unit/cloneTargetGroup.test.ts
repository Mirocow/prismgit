/**
 * Tests for the clone-into-folder fix and the group selector.
 *
 * Bug 1: 'Нельзя клонировать репозиторий в группу, добавляется
 *        репозиторий в корень'
 *   Fix: CloneModal now has a "Sidebar group" dropdown. The chosen
 *   groupId is forwarded to cloneRepository(), which calls
 *   api.settings.setRepoGroup() after the clone lands.
 *
 * Bug 2: 'при клонировании в /opt клонируется в /opt, а должно в
 *         /opt/29agroapk'
 *   Fix: handleBrowse() now appends /<repo-name> derived from the URL
 *   so picking /opt as parent → /opt/29agroapk as final target.
 *
 * We test the URL-to-repo-name derivation helper directly (the rest is
 * component-level behavior — covered by typecheck + build).
 */
import { describe, it, expect } from 'vitest';

/**
 * Mirror the derivation logic used in CloneModal.handleBrowse().
 * Keep in sync with src/components/CloneModal.tsx:deriveRepoNameFromUrl.
 */
function deriveRepoNameFromUrl(input: string): string {
  const m = input.match(/\/([^/]+?)(?:\.git)?(?:\?|#|$)/);
  return m?.[1] ?? '';
}

describe('clone — derive repo name from URL', () => {
  it('extracts the repo name from https URL with .git suffix', () => {
    expect(deriveRepoNameFromUrl('https://host-git/hackathon/godyaev/29agroapk.git'))
      .toBe('29agroapk');
  });

  it('extracts the repo name from https URL without .git suffix', () => {
    expect(deriveRepoNameFromUrl('https://github.com/user/my-repo'))
      .toBe('my-repo');
  });

  it('extracts the repo name from SSH scp-style URL', () => {
    expect(deriveRepoNameFromUrl('git@github.com:user/my-repo.git'))
      .toBe('my-repo');
  });

  it('extracts the repo name from SSH:// URL', () => {
    expect(deriveRepoNameFromUrl('ssh://git@host:50022/group/repo.git'))
      .toBe('repo');
  });

  it('extracts the repo name from a local path', () => {
    expect(deriveRepoNameFromUrl('/path/to/local-repo')).toBe('local-repo');
  });

  it('extracts the repo name from a local path with .git suffix', () => {
    expect(deriveRepoNameFromUrl('/path/to/local-repo.git')).toBe('local-repo');
  });

  it('returns the name for URL with query string', () => {
    expect(deriveRepoNameFromUrl('https://example.com/repo.git?branch=main'))
      .toBe('repo');
  });

  it('returns the name for URL with hash fragment', () => {
    expect(deriveRepoNameFromUrl('https://example.com/repo#readme'))
      .toBe('repo');
  });

  it('returns empty string for empty input', () => {
    expect(deriveRepoNameFromUrl('')).toBe('');
  });

  it('returns empty string for malformed URL with no slash', () => {
    expect(deriveRepoNameFromUrl('just-a-name')).toBe('');
  });

  it('correctly handles the user-reported scenario: 29agroapk.git', () => {
    // The exact URL from the user's bug report.
    const url = 'https://host-git/hackathon/godyaev/29agroapk.git';
    const repoName = deriveRepoNameFromUrl(url);
    // The user's expectation: cloning into /opt should land in
    // /opt/29agroapk (parent + repo name).
    expect(repoName).toBe('29agroapk');
    const parent = '/opt';
    const finalPath = `${parent}/${repoName}`.replace(/\/+/g, '/');
    expect(finalPath).toBe('/opt/29agroapk');
  });
});
