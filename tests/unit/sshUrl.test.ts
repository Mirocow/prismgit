import { describe, it, expect } from 'vitest';
import { parseSshUrl, matchProfileForUrl } from '../../electron/services/sshUrl';
import { classifyRemoteUrl } from '../../electron/services/credentialKeys';

describe('parseSshUrl — ssh:// with custom port', () => {
  it('parses the real-world agro-geo-service URL', () => {
    const r = parseSshUrl('ssh://git@192.168.1.2:50022/constructor/agro-geo-service.git');
    expect(r).toEqual({ host: '192.168.1.2', user: 'git', port: 50022 });
  });

  it('classifies it as ssh transport', () => {
    expect(classifyRemoteUrl('ssh://git@192.168.1.2:50022/constructor/agro-geo-service.git')).toBe('ssh');
  });

  it('parses ssh:// without port', () => {
    expect(parseSshUrl('ssh://git@github.com/owner/repo.git')).toEqual({
      host: 'github.com',
      user: 'git',
      port: undefined,
    });
  });

  it('parses scp-like syntax (no port by definition)', () => {
    expect(parseSshUrl('git@github.com:owner/repo.git')).toEqual({
      host: 'github.com',
      user: 'git',
      port: undefined,
    });
  });

  it('parses scp-like with deep path and IP host', () => {
    expect(parseSshUrl('mirocow@178.140.10.58:web/git/repo.git')).toEqual({
      host: '178.140.10.58',
      user: 'mirocow',
      port: undefined,
    });
  });
});

describe('matchProfileForUrl — host+port precision', () => {
  const profiles = [
    { id: 'a', host: '192.168.1.2', port: 22 },
    { id: 'b', host: '192.168.1.2', port: 50022 },
    { id: 'c', host: 'github.com', port: 22 },
  ];

  it('prefers the profile whose port matches the URL port', () => {
    const m = matchProfileForUrl(profiles, 'ssh://git@192.168.1.2:50022/constructor/agro-geo-service.git');
    expect(m?.id).toBe('b');
  });

  it('matches port 22 exactly when the URL says 22', () => {
    const m = matchProfileForUrl(profiles, 'ssh://git@192.168.1.2:22/constructor/app.git');
    expect(m?.id).toBe('a');
  });

  it('falls back to host-only for scp-like URLs (no port in URL)', () => {
    const m = matchProfileForUrl(profiles, 'git@192.168.1.2:constructor/agro-geo-service.git');
    expect(m?.id).toBe('a'); // first host match wins
  });

  it('is case-insensitive on the host', () => {
    const m = matchProfileForUrl(
      [{ id: 'x', host: 'GitHub.Com', port: 22 }],
      'ssh://git@github.com:22/owner/repo.git'
    );
    expect(m?.id).toBe('x');
  });

  it('returns undefined when no profile matches the host', () => {
    expect(matchProfileForUrl(profiles, 'ssh://git@10.0.0.9:50022/repo.git')).toBeUndefined();
  });

  it('returns undefined for empty profiles or URLs', () => {
    expect(matchProfileForUrl([], 'ssh://git@host/repo.git')).toBeUndefined();
    expect(matchProfileForUrl(profiles, '')).toBeUndefined();
    expect(matchProfileForUrl(profiles, null)).toBeUndefined();
  });
});
