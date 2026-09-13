import { describe, it, expect } from 'vitest';
import { gravatarUrl, gravatarUrlSync, likelyHasGravatar, GRAVATAR_BASE } from '../../src/lib/gravatar';

describe('Gravatar integration', () => {
  it('returns empty string for empty email (sync)', () => {
    expect(gravatarUrlSync('')).toBe('');
    expect(gravatarUrlSync(undefined)).toBe('');
    expect(gravatarUrlSync('   ')).toBe('');
  });

  it('returns empty string for empty email (async)', async () => {
    expect(await gravatarUrl('')).toBe('');
    expect(await gravatarUrl(undefined)).toBe('');
    expect(await gravatarUrl('   ')).toBe('');
  });

  it('sync: returns a URL with a valid MD5 hex hash for a known email', () => {
    // Verified: echo -n "test@example.com" | md5sum
    //   → 55502f40dc8b7c769880b10874abc9d0
    const url = gravatarUrlSync('test@example.com', 80);
    expect(url.startsWith(GRAVATAR_BASE)).toBe(true);
    expect(url).toMatch(/s=80/);
    expect(url).toMatch(/d=identicon/);
    // MD5 hash is 32 hex chars
    expect(url).toMatch(/avatar\/[0-9a-f]{32}\?/);
  });

  it('async: returns a URL with a valid SHA-256 hex hash for a known email', async () => {
    // Verified: echo -n "test@example.com" | sha256sum
    //   → 973dfe763... (64 hex chars)
    const url = await gravatarUrl('test@example.com', 80);
    expect(url.startsWith(GRAVATAR_BASE)).toBe(true);
    expect(url).toMatch(/s=80/);
    expect(url).toMatch(/d=identicon/);
    // SHA-256 hash is 64 hex chars
    expect(url).toMatch(/avatar\/[0-9a-f]{64}\?/);
  });

  it('lowercases and trims email before hashing (Gravatar is case-sensitive)', async () => {
    const a = await gravatarUrl('Test@Example.com');
    const b = await gravatarUrl('test@example.com');
    expect(a).toBe(b);
    const c = await gravatarUrl('  test@example.com  ');
    expect(c).toBe(b);
  });

  it('sync version also normalizes case', () => {
    expect(gravatarUrlSync('Test@Example.com')).toBe(gravatarUrlSync('test@example.com'));
    expect(gravatarUrlSync('  test@example.com  ')).toBe(gravatarUrlSync('test@example.com'));
  });

  it('uses identicon as the default fallback', async () => {
    const url = await gravatarUrl('unknown@example.com');
    expect(url).toMatch(/d=identicon/);
  });

  it('likelyHasGravatar returns true for known provider emails', () => {
    expect(likelyHasGravatar('user@github.com')).toBe(true);
    expect(likelyHasGravatar('12345+username@users.noreply.github.com')).toBe(true);
    expect(likelyHasGravatar('user@gitlab.com')).toBe(true);
  });

  it('likelyHasGravatar returns true for all valid emails, false for invalid', () => {
    // Changed: all valid emails return true (Gravatar returns identicon for unknown)
    expect(likelyHasGravatar('user@example.com')).toBe(true);
    expect(likelyHasGravatar('user@gmail.com')).toBe(true);
    expect(likelyHasGravatar('')).toBe(false);
    expect(likelyHasGravatar(undefined)).toBe(false);
    expect(likelyHasGravatar('no-email')).toBe(false);
  });

  it('produces the same hash for the same input', async () => {
    expect(await gravatarUrl('a@b.com')).toBe(await gravatarUrl('a@b.com'));
  });

  it('produces different hashes for different inputs', async () => {
    expect(await gravatarUrl('a@b.com')).not.toBe(await gravatarUrl('c@d.com'));
  });
});
