/**
 * Pure SSH remote-URL helpers — NO Electron imports (unit-testable, and
 * shared by the main-process SSH service and future tooling).
 *
 * Supported git SSH syntaxes:
 *   ssh://git@192.168.1.2:50022/constructor/agro-geo-service.git
 *   ssh://git@host/path
 *   git@github.com:owner/repo.git          (scp-like)
 *   mirocow@178.140.10.58:web/git/repo.git (scp-like, deep path)
 */

export interface ParsedSshUrl {
  host: string;
  user?: string;
  port?: number;
}

/**
 * Extract user@host:port from an SSH URL (ssh:// or scp-like syntax).
 * Returns { host, user, port } with defaults where missing.
 */
export function parseSshUrl(url: string): ParsedSshUrl {
  try {
    let u = (url || '').trim();
    if (!/^ssh:\/\//i.test(u)) {
      // scp-like: user@host:path → normalize to ssh://user@host/path
      const m = /^(([^@/\s]+)@)?([^:/\s]+):(.*)$/.exec(u);
      if (!m) return { host: u };
      return { host: m[3], user: m[2], port: undefined };
    }
    u = u.replace(/^ssh:\/\//i, 'http://'); // reuse URL parser
    const parsed = new URL(u);
    return {
      host: parsed.hostname,
      user: parsed.username || undefined,
      port: parsed.port ? Number(parsed.port) : undefined,
    };
  } catch {
    return { host: url };
  }
}

/**
 * Pick the DBeaver-style connection profile for a git remote URL.
 *
 * Matching precision matters when one machine serves several git endpoints
 * on different ports, e.g.
 *   ssh://git@192.168.1.2:22/…                                     (profile A)
 *   ssh://git@192.168.1.2:50022/constructor/agro-geo-service.git   (profile B)
 *
 * 1. profiles whose host AND port match the URL win (case-insensitive host);
 * 2. otherwise a host-only match is accepted (covers scp-like URLs, which
 *    never carry a port);
 * 3. for ssh:// URLs whose port differs from every profile port, a host-only
 *    match is still preferred over nothing — but callers should note the URL
 *    port itself always reaches the server (git appends -p <url_port> after
 *    GIT_SSH_COMMAND, and the last -p wins in OpenSSH).
 */
export function matchProfileForUrl<P extends { host: string; port: number }>(
  profiles: P[],
  url: string | undefined | null
): P | undefined {
  const parsed = parseSshUrl(url || '');
  if (!parsed?.host) return undefined;
  const h = parsed.host.trim().toLowerCase();
  if (parsed.port) {
    const exact = profiles.find((p) => p.host.toLowerCase() === h && p.port === parsed.port);
    if (exact) return exact;
  }
  return profiles.find((p) => p.host.toLowerCase() === h);
}
