import { describe, it, expect } from 'vitest';
import { gravatarUrl, likelyHasGravatar, GRAVATAR_BASE } from '../../src/lib/gravatar';

describe('Gravatar integration', () => {
  it('returns empty string for empty email', () => {
    expect(gravatarUrl('')).toBe('');
    expect(gravatarUrl(undefined)).toBe('');
    expect(gravatarUrl('   ')).toBe('');
  });

  it('returns a URL with the correct MD5 hash for a known email', () => {
    // Verified via `echo -n "test@example.com" | md5sum`:
    //   55502f40dc8b7c769880b10874abc9d0
    const url = gravatarUrl('test@example.com', 80);
    expect(url.startsWith(GRAVATAR_BASE)).toBe(true);
    expect(url).toContain('55502f40dc8b7c769880b10874abc9d0');
    expect(url).toContain('s=80');
    expect(url).toContain('d=identicon');
  });

  it('lowercases and trims email before hashing (Gravatar is case-sensitive)', () => {
    const a = gravatarUrl('Test@Example.com');
    const b = gravatarUrl('test@example.com');
    expect(a).toBe(b);
    const c = gravatarUrl('  test@example.com  ');
    expect(c).toBe(b);
  });

  it('uses identicon as the default fallback', () => {
    const url = gravatarUrl('unknown@example.com');
    expect(url).toContain('d=identicon');
  });

  it('likelyHasGravatar returns true for known provider emails', () => {
    expect(likelyHasGravatar('user@github.com')).toBe(true);
    expect(likelyHasGravatar('12345+username@users.noreply.github.com')).toBe(true);
    expect(likelyHasGravatar('user@gitlab.com')).toBe(true);
  });

  it('likelyHasGravatar returns false for generic emails', () => {
    expect(likelyHasGravatar('user@example.com')).toBe(false);
    expect(likelyHasGravatar('user@gmail.com')).toBe(false);
    expect(likelyHasGravatar('')).toBe(false);
    expect(likelyHasGravatar(undefined)).toBe(false);
  });

  it('md5 produces the same hash for the same input', () => {
    expect(gravatarUrl('a@b.com')).toBe(gravatarUrl('a@b.com'));
  });

  it('md5 produces different hashes for different inputs', () => {
    expect(gravatarUrl('a@b.com')).not.toBe(gravatarUrl('c@d.com'));
  });
});
