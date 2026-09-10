import { describe, it, expect } from 'vitest';
import { pickDefaultRemote } from '../../src/lib/remotes';
import type { RemoteInfo } from '../../electron/types/git-api';

/** pickDefaultRemote replaces the old hardcoded 'origin' everywhere the UI pushes/pulls. */
describe('pickDefaultRemote', () => {
  const mk = (name: string): RemoteInfo => ({
    name,
    refs: { fetch: `url-${name}`, push: `url-${name}` },
  } as unknown as RemoteInfo);

  it('prefers origin when present', () => {
    expect(pickDefaultRemote([mk('gitlab'), mk('origin'), mk('github')])).toBe('origin');
  });

  it('falls back to the first configured remote when origin is absent', () => {
    expect(pickDefaultRemote([mk('github'), mk('gitlab')])).toBe('github');
  });

  it('returns empty string when no remotes exist', () => {
    expect(pickDefaultRemote([])).toBe('');
  });
});
