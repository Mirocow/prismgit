/**
 * Gerrit integration (SmartGit Manual: "Push to Gerrit" command).
 *
 * Detects Gerrit remote via:
 *   1. .gitreview file in repo root (Gerrit Code Review config)
 *   2. `review.remote` config in .git/config
 *   3. Port 29418 (default Gerrit SSH port) in remote URL
 *   4. Single-remote fallback (only one remote, assume Gerrit)
 *
 * .gitreview file format:
 *   [gerrit]
 *   host = review.example.com
 *   port = 29418
 *   project = tools/gerrit.git
 *   defaultbranch = main
 *   defaultremote = origin
 *   defaultrebase = 0
 */

export interface GitReviewConfig {
  host?: string;
  port?: string;
  project?: string;
  defaultbranch?: string;
  defaultremote?: string;
  defaultrebase?: string;
}

/**
 * Parse a .gitreview file (INI format) into GitReviewConfig.
 */
export function parseGitReview(content: string): GitReviewConfig | null {
  let config: GitReviewConfig | null = null;
  let inGerritSection = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    if (trimmed.startsWith('[')) {
      inGerritSection = trimmed.toLowerCase().includes('gerrit');
      if (inGerritSection && !config) config = {};
      continue;
    }
    if (!inGerritSection || !config) continue;
    const kvMatch = trimmed.match(/^([a-z]+)\s*=\s*(.*)$/i);
    if (!kvMatch) continue;
    const [, key, rawValue] = kvMatch;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    switch (key.toLowerCase()) {
      case 'host':
        config.host = value;
        break;
      case 'port':
        config.port = value;
        break;
      case 'project':
        config.project = value;
        break;
      case 'defaultbranch':
        config.defaultbranch = value;
        break;
      case 'defaultremote':
        config.defaultremote = value;
        break;
      case 'defaultrebase':
        config.defaultrebase = value;
        break;
    }
  }
  return config;
}

/**
 * Check if a remote URL looks like a Gerrit remote.
 * Heuristic: SSH port 29418, or "review" in hostname.
 */
export function isGerritRemote(remoteUrl: string): boolean {
  if (!remoteUrl) return false;
  // ssh://user@host:29418/path — default Gerrit SSH port
  if (/:\d+\//.test(remoteUrl)) {
    const portMatch = remoteUrl.match(/:(\d+)\//);
    if (portMatch && portMatch[1] === '29418') return true;
  }
  // ssh://user@review.example.com/...
  if (/@review\./i.test(remoteUrl)) return true;
  // ssh://user@gerrit.example.com/...
  if (/@gerrit\./i.test(remoteUrl)) return true;
  return false;
}

/**
 * Build the refspec for a Gerrit push.
 *   - regular: refs/for/<branch>
 *   - draft: refs/drafts/<branch>
 */
export function gerritPushRef(branch: string, draft = false): string {
  return draft ? `refs/drafts/${branch}` : `refs/for/${branch}`;
}

/**
 * Build a Gerrit push refspec with options.
 * Returns the full refspec, e.g. "refs/for/main%topic=my-feature,r=reviewer@example.com".
 */
export function gerritPushRefWithOptions(
  branch: string,
  options: { draft?: boolean; topic?: string; reviewers?: string[]; cc?: string[] } = {}
): string {
  const ref = gerritPushRef(branch, options.draft);
  const opts: string[] = [];
  if (options.topic) opts.push(`topic=${options.topic}`);
  for (const r of options.reviewers || []) opts.push(`r=${r}`);
  for (const c of options.cc || []) opts.push(`cc=${c}`);
  return opts.length > 0 ? `${ref}%${opts.join(',')}` : ref;
}
