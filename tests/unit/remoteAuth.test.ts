import { describe, it, expect } from 'vitest';
import { buildHttpAuthArgs } from '../../electron/services/git';

/**
 * Per-remote authorization for git network commands.
 *
 * Credentials live in the shared app settings (Repository Settings → Remotes,
 * same values editable in the Remotes tool). The main process injects them
 * per-command via `-c http.extraHeader=Authorization: Basic ...` — never into
 * .git/config, never into the remote URL.
 */
describe('buildHttpAuthArgs', () => {
  it('adds a Basic Authorization header for http(s) URLs with credentials', () => {
    const args = buildHttpAuthArgs('http://example.com/web/git/repo.git', {
      username: 'john',
      password: 's3cret',
    });
    expect(args).toHaveLength(2);
    expect(args[0]).toBe('-c');
    expect(args[1]).toBe(
      `http.extraHeader=Authorization: Basic ${Buffer.from('john:s3cret').toString('base64')}`
    );
  });

  it('supports token-only credentials (empty username)', () => {
    const args = buildHttpAuthArgs('https://gitlab.example.com/x.git', { password: 'glpat-123' });
    expect(args[1]).toBe(
      `http.extraHeader=Authorization: Basic ${Buffer.from(':glpat-123').toString('base64')}`
    );
  });

  it('skips SSH remotes (extraHeader is HTTP-only)', () => {
    expect(
      buildHttpAuthArgs('git@github.com:u/repo.git', { username: 'u', password: 'p' })
    ).toEqual([]);
    expect(
      buildHttpAuthArgs('ssh://git@host:2222/u/repo.git', { username: 'u', password: 'p' })
    ).toEqual([]);
  });

  it('skips local paths', () => {
    expect(buildHttpAuthArgs('/srv/git/repo.git', { username: 'u', password: 'p' })).toEqual([]);
  });

  it('skips when no credentials configured', () => {
    expect(buildHttpAuthArgs('http://example.com/r.git', undefined)).toEqual([]);
    expect(buildHttpAuthArgs('http://example.com/r.git', {})).toEqual([]);
    expect(buildHttpAuthArgs('http://example.com/r.git', { username: '  ', password: '' })).toEqual([]);
  });

  it('never double-authorizes URLs that already embed credentials', () => {
    expect(
      buildHttpAuthArgs('http://user:pass@example.com/r.git', { username: 'u', password: 'p' })
    ).toEqual([]);
  });

  it('handles unicode passwords (base64 is UTF-8)', () => {
    const args = buildHttpAuthArgs('http://example.com/r.git', { username: 'йц', password: 'пароль' });
    expect(args[1]).toBe(
      `http.extraHeader=Authorization: Basic ${Buffer.from('йц:пароль', 'utf8').toString('base64')}`
    );
  });
});
