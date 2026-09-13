/**
 * Deep links — URL query parameters that carry tool selection state.
 *
 * Motivation (the user's follow-up to cross-tool selection sync):
 *   After the selectionStore made every tool share branch/file/tag/stash/commit
 *   selection, the remaining gap was persistence and shareability: there was no
 *   way to express "open History filtered to file X on branch Y" as a link.
 *   Electron has no address bar, so links are used via
 *     - View → "Go to Deep Link..." (paste a link),
 *     - View → "Copy Deep Link" (copy the link for the current selection),
 *     - the Command Palette, and
 *     - a cold start with a hash URL (devtools / protocol handlers).
 *
 * Format (HashRouter — everything after '#' is the router location):
 *
 *     #/history?file=src%2FApp.tsx&branch=main&commit=abc123&tag=v1.0&stash=2&author=Ivan
 *      └─page─┘ └──────────────────────────── query params ─────────────────────────────┘
 *
 *   page     — any known route (/changes, /history, /blame, /branches, ...)
 *   file     — file path; sets selectedFilePath (cross-tool file selection)
 *              AND pathFilter (History log filter, git log -- <path> --follow)
 *   branch   — branch name; sets selectedBranch (History/Branches/Toolbar filter)
 *   commit   — commit hash (hex, 4..40 chars); sets selectedCommitHash
 *   tag      — tag name; sets selectedTag
 *   stash    — stash index (integer ≥ 0); sets selectedStashIndex
 *   author   — author name; sets authorFilter (History filter)
 *
 * Values are sanitized: no leading dash (so a value can never be mistaken for
 * a git CLI option), no control characters, no NUL. `commit` additionally must
 * look like a hex hash. Invalid values are DROPPED (never throw) — a malformed
 * link must degrade to a plain page navigation, not crash the app.
 */

import { useSelectionStore } from '../stores/selectionStore';

export interface DeepLinkParams {
  file?: string;
  branch?: string;
  commit?: string;
  tag?: string;
  stash?: number;
  author?: string;
}

/** Keys accepted in the query string. `path` is an alias for `file`, `hash` for `commit`. */
const KEY_ALIASES: Record<string, keyof DeepLinkParams> = {
  file: 'file',
  path: 'file',
  branch: 'branch',
  commit: 'commit',
  hash: 'commit',
  tag: 'tag',
  stash: 'stash',
  author: 'author',
};

const COMMIT_RE = /^[0-9a-fA-F]{4,40}$/;
// No control chars / whitespace at edges; no leading dash (CLI-option safety).
const SAFE_VALUE_RE = /^[^\u0000-\u001f].*[^\u0000-\u001f]$|^[^\-\u0000-\u001f]$/;

/**
 * Validate + normalize a single query value. Returns null for invalid values.
 * Leading/trailing whitespace is tolerated (hand-typed links).
 */
export function sanitizeParam(key: keyof DeepLinkParams, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // A leading '-' would make the value look like a git CLI option downstream
  // (e.g. `git log -- -rf`); control characters are never legitimate.
  if (value.startsWith('-')) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (key === 'commit' && !COMMIT_RE.test(value)) return null;
  if (key === 'stash') {
    if (!/^\d+$/.test(value)) return null;
    return String(parseInt(value, 10));
  }
  if (!SAFE_VALUE_RE.test(value)) return null;
  return value;
}

/**
 * Parse a query string ('?file=...' — with or without the leading '?') or a
 * full path ('/history?file=...') into DeepLinkParams. Returns null when the
 * query carries no recognized parameters. Invalid values are skipped.
 */
export function parseDeepLink(searchOrPath: string): DeepLinkParams | null {
  if (!searchOrPath) return null;
  const qIndex = searchOrPath.indexOf('?');
  if (qIndex < 0) return null;
  const query = searchOrPath.substring(qIndex + 1);
  if (!query) return null;

  const params: DeepLinkParams = {};
  let searchParams: URLSearchParams;
  try {
    searchParams = new URLSearchParams(query);
  } catch {
    return null;
  }
  for (const [rawKey, rawValue] of searchParams.entries()) {
    const key = KEY_ALIASES[rawKey.toLowerCase()];
    if (!key) continue;
    const value = sanitizeParam(key, rawValue);
    if (value == null) continue;
    if (key === 'stash') {
      params.stash = parseInt(value, 10);
    } else {
      // First occurrence wins (URLSearchParams can repeat keys)
      if (params[key] == null) (params as Record<string, unknown>)[key] = value;
    }
  }
  return Object.keys(params).length > 0 ? params : null;
}

/** URL-encode one query value (encodeURIComponent leaves '/' alone — encode it too). */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, '%2F');
}

/** Build the query string ('?file=...&branch=...') for the given params. */
export function buildDeepLinkQuery(params: DeepLinkParams): string {
  const pairs: string[] = [];
  if (params.file) pairs.push(`file=${encodeValue(params.file)}`);
  if (params.branch) pairs.push(`branch=${encodeValue(params.branch)}`);
  if (params.commit) pairs.push(`commit=${encodeValue(params.commit)}`);
  if (params.tag) pairs.push(`tag=${encodeValue(params.tag)}`);
  if (params.stash != null && Number.isFinite(params.stash) && params.stash >= 0) {
    pairs.push(`stash=${params.stash}`);
  }
  if (params.author) pairs.push(`author=${encodeValue(params.author)}`);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/** Build a full deep-link path ('/history?file=...'). */
export function buildDeepLink(page: string, params: DeepLinkParams): string {
  const safePage = page && page.startsWith('/') ? page : `/${page || 'changes'}`;
  return `${safePage.split('?')[0]}${buildDeepLinkQuery(params)}`;
}

/**
 * Validate a hand-typed deep-link path before navigating to it:
 * must start with '/', contain a known page token and (if a query is present)
 * at least one valid parameter. Unknown pages are allowed — the router shows
 * the welcome screen rather than crashing — but empty/garbage input is rejected.
 */
export function isValidDeepLinkPath(path: string): boolean {
  const trimmed = path.trim().replace(/^#+/, '');
  if (!trimmed.startsWith('/')) return false;
  const [page, query] = trimmed.split('?');
  if (!page || page === '/') return false;
  // Reject any control characters or embedded whitespace in the path part
  if (/[\u0000-\u001f\u007f\s]/.test(page)) return false;
  if (query != null) {
    const parsed = parseDeepLink(`?${query}`);
    if (!parsed) return false;
  }
  return true;
}

/**
 * Build a deep link for the CURRENT selection state (selectionStore) on the
 * given page. Used by "Copy Deep Link" and the prefill of "Go to Deep Link...".
 */
export function buildCurrentDeepLink(pathname: string): string {
  const s = useSelectionStore.getState();
  const params: DeepLinkParams = {};
  const file = s.selectedFilePath || s.pathFilter;
  if (file) params.file = file;
  if (s.selectedBranch) params.branch = s.selectedBranch;
  if (s.selectedCommitHash) params.commit = s.selectedCommitHash;
  if (s.selectedTag) params.tag = s.selectedTag;
  if (s.selectedStashIndex != null) params.stash = s.selectedStashIndex;
  if (s.authorFilter) params.author = s.authorFilter;
  return buildDeepLink(pathname, params);
}

/**
 * Apply parsed deep-link params to the global selection store so every tool
 * (History, Changes, Blame, Tags, Stashes, Toolbar, ...) reacts to them.
 */
export function applyDeepLink(params: DeepLinkParams): void {
  const store = useSelectionStore.getState();
  if (params.file) {
    store.selectFile(params.file);
    store.setPathFilter(params.file);
  }
  if (params.branch) store.selectBranch(params.branch);
  if (params.commit) store.selectCommit(params.commit);
  if (params.tag) store.selectTag(params.tag);
  if (params.stash != null) store.selectStash(params.stash);
  if (params.author) store.setAuthorFilter(params.author);
}

// ---------------------------------------------------------------------------
// Pending deep link (cold start before a repository is open)
//
// When the app is launched with a hash URL like '#/history?file=X' no repo is
// open yet, so the target page cannot render. The DeepLinkHandler applies the
// selection params immediately and stashes the PAGE here; when the user opens
// a repository, App navigates to the pending page instead of the default
// '/changes' and consumes it.
// ---------------------------------------------------------------------------

let pendingDeepLinkPage: string | null = null;

export function setPendingDeepLinkPage(page: string): void {
  pendingDeepLinkPage = page && page.startsWith('/') ? page : `/${page}`;
}

/** Returns and clears the pending deep-link page (or null). */
export function takePendingDeepLinkPage(): string | null {
  const p = pendingDeepLinkPage;
  pendingDeepLinkPage = null;
  return p;
}

export function clearPendingDeepLinkPage(): void {
  pendingDeepLinkPage = null;
}

/** Current route path from window.location.hash ('#/history?x=1' → '/history'). */
export function currentHashPath(): string {
  const hash = window.location.hash || '#/';
  const path = hash.replace(/^#/, '');
  const qIndex = path.indexOf('?');
  const page = qIndex >= 0 ? path.substring(0, qIndex) : path;
  return page || '/';
}
