/**
 * BugTraq — issue-tracker linking configuration (SmartGit Manual).
 *
 * Reads `.gitbugtraq` (shared repo-level) or `[bugtraq "..."]` from `.git/config` (personal).
 * For each commit message, applies the regex pipeline to extract issue IDs and produce links.
 *
 * Pipeline (per SmartGit Manual):
 *   commit message
 *     → logfilterregex (optional pre-filter)
 *     → loglinkregex (extract link-worthy text)
 *     → logregex (extract BUGID)
 *     → URL substitution (%BUGID% → final URL)
 *
 * Example .gitbugtraq config for Jira:
 *   [bugtraq "jira"]
 *     url = https://jira.example.com/browse/%BUGID%
 *     logregex = "JRA-\\d+"
 *     loglinkregex = "JRA-(\\d+)"
 *
 * Example for GitHub Issues:
 *   [bugtraq "github"]
 *     url = https://github.com/owner/repo/issues/%BUGID%
 *     logregex = "#(\\d+)"
 *     loglinkregex = "#(\\d+)"
 */

export interface BugTraqConfig {
  /** Unique name for this config (e.g., "jira", "github"). */
  name: string;
  /** URL template with %BUGID% placeholder. */
  url: string;
  /** Regex to extract the BUGID from a commit message. */
  logregex?: string;
  /** Optional regex to extract the link-text portion. */
  loglinkregex?: string;
  /** Optional filter regex applied to the message first. */
  logfilterregex?: string;
  /** Optional project prefix filter (e.g., "PROJ1" for Jira project). */
  projects?: string[];
}

export interface BugTraqLink {
  /** Matched text in the commit message (e.g., "JRA-1234"). */
  text: string;
  /** The full URL to navigate to. */
  url: string;
  /** The bug ID extracted (e.g., "JRA-1234" or "1234"). */
  bugId: string;
  /** Display label, e.g., "Jira" or "GitHub". */
  source: string;
  /** Index in the original message. */
  start: number;
  end: number;
}

/**
 * Parse a `.gitbugtraq` file (INI format) into BugTraqConfig[].
 * Format:
 *   [bugtraq "jira"]
 *       url = https://jira.example.com/browse/%BUGID%
 *       logregex = "JRA-\\d+"
 */
export function parseBugTraqConfig(content: string): BugTraqConfig[] {
  const configs: BugTraqConfig[] = [];
  let current: BugTraqConfig | null = null;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const sectionMatch = trimmed.match(/^\[bugtraq\s+"([^"]+)"\s*\]$/);
    if (sectionMatch) {
      if (current) configs.push(current);
      current = { name: sectionMatch[1], url: '' };
      continue;
    }
    if (!current) continue;
    const kvMatch = trimmed.match(/^([a-z]+)\s*=\s*(.*)$/i);
    if (!kvMatch) continue;
    const [, key, rawValue] = kvMatch;
    // Strip surrounding quotes if present
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    switch (key.toLowerCase()) {
      case 'url':
        current.url = value;
        break;
      case 'logregex':
        current.logregex = value;
        break;
      case 'loglinkregex':
        current.loglinkregex = value;
        break;
      case 'logfilterregex':
        current.logfilterregex = value;
        break;
      case 'projects':
        current.projects = value.split(',').map(p => p.trim()).filter(Boolean);
        break;
    }
  }
  if (current) configs.push(current);
  return configs.filter(c => c.url && (c.logregex || c.loglinkregex));
}

/**
 * Extract bug links from a commit message using the given configs.
 * Returns an array of BugTraqLink, sorted by position in the message.
 */
export function extractBugTraqLinks(message: string, configs: BugTraqConfig[]): BugTraqLink[] {
  const links: BugTraqLink[] = [];
  for (const config of configs) {
    // Apply optional pre-filter
    let text = message;
    if (config.logfilterregex) {
      try {
        const filterRe = new RegExp(config.logfilterregex, 'g');
        const matches = text.match(filterRe);
        if (!matches) continue;
      } catch {
        continue; // invalid regex
      }
    }
    // Use logregex to extract BUGIDs
    const regexSource = config.logregex || config.loglinkregex;
    if (!regexSource) continue;
    try {
      const re = new RegExp(regexSource, 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        // BUGID is the full match, or first capture group if present
        const bugId = match[1] || match[0];
        const displayText = match[0];
        const url = config.url.replace(/%BUGID%/g, encodeURIComponent(bugId));
        links.push({
          text: displayText,
          url,
          bugId,
          source: config.name,
          start: match.index,
          end: match.index + displayText.length,
        });
        // Avoid zero-length match infinite loop
        if (match.index === re.lastIndex) re.lastIndex++;
      }
    } catch {
      // invalid regex — skip config
      continue;
    }
  }
  // Sort by position in message
  links.sort((a, b) => a.start - b.start);
  return links;
}

/**
 * Render a commit message with BugTraq links as React-friendly segments.
 */
export interface BugTraqSegment {
  text: string;
  link?: BugTraqLink;
}

export function segmentMessageWithBugTraq(message: string, configs: BugTraqConfig[]): BugTraqSegment[] {
  const links = extractBugTraqLinks(message, configs);
  if (links.length === 0) return [{ text: message }];
  const segments: BugTraqSegment[] = [];
  let pos = 0;
  for (const link of links) {
    if (link.start > pos) {
      segments.push({ text: message.slice(pos, link.start) });
    }
    segments.push({ text: link.text, link });
    pos = link.end;
  }
  if (pos < message.length) {
    segments.push({ text: message.slice(pos) });
  }
  return segments;
}
