/**
 * Squash-to-branch support for the Pull Requests / Reviews tools.
 *
 * The History tool selects LOCAL commits, so SquashToBranchDialog can pass
 * them straight to `git:squashToBranch`. The PR/MR surfaces (PRReview Commits
 * tab, the PR list row action, the Reviews page) select commits listed by the
 * GitHub/GitLab REST API — objects that may not exist in the local clone at
 * all (the PR branch was never fetched, or the PR comes from a fork whose
 * branch is absent locally). This module bridges that gap:
 *
 *   1. prCommitsToLogEntries() — normalize provider commit objects into the
 *      LogEntry shape the dialog + backend expect (order preserved: the
 *      provider APIs return commits OLDEST → NEWEST, which is exactly the
 *      order squashToBranch wants).
 *   2. prHeadRefspec() — the canonical server-side ref that carries the PR's
 *      commits (refs/pull/<n>/head on GitHub, refs/merge-requests/<n>/head
 *      on GitLab; both exist in the BASE project, even for fork PRs).
 *   3. ensureCommitsLocal() — check each SHA with a quiet rev-parse (objects
 *      present?); when some are missing, fetch the PR head ref (FETCH_HEAD
 *      only — no tracking refs touched) and re-check. Output-based checks:
 *      simple-git RESOLVES (does not throw) on empty-stderr exit-1.
 */
import { api, type LogEntry, type GithubPRCommit } from './api';

/**
 * The server-side ref that always carries a PR/MR's head commit.
 * Fetching it brings the whole PR commit chain into the object store
 * without creating any remote-tracking branch.
 */
export function prHeadRefspec(provider: 'github' | 'gitlab', prNumber: number): string {
  return provider === 'github'
    ? `refs/pull/${prNumber}/head`
    : `refs/merge-requests/${prNumber}/head`;
}

/** Provider PR commit (GithubPRCommit-shaped — GitLab MR commits are
 *  normalized to the same shape in PRReview) → LogEntry for the dialog. */
export function prCommitsToLogEntries(commits: GithubPRCommit[]): LogEntry[] {
  return commits.map((c) => {
    const message = c.commit?.message ?? '';
    const nl = message.indexOf('\n');
    const subject = (nl >= 0 ? message.slice(0, nl) : message).trim();
    const a = c.commit?.author ?? { name: '', email: '', date: '' };
    const ts = Date.parse(a.date);
    const person = {
      name: a.name || c.author?.login || 'unknown',
      email: a.email ?? '',
      date: a.date ?? '',
      timestamp: Number.isFinite(ts) ? Math.floor(ts / 1000) : 0,
    };
    return {
      hash: c.sha,
      hashAbbrev: c.sha.slice(0, 7),
      // The provider payload has no parent info — squashToBranch derives
      // parentage from the local git graph, not from these fields.
      parents: [],
      parentsAbbrev: [],
      author: person,
      committer: person,
      subject,
      body: nl >= 0 ? message.slice(nl + 1).trim() : '',
      refs: [],
      message,
    } satisfies LogEntry;
  });
}

/** Does the commit object exist locally? Quiet rev-parse: resolves to an
 *  EMPTY string when the SHA is unknown (output-based, see module header). */
async function commitExists(repoPath: string, sha: string): Promise<boolean> {
  const out = await api.git.raw(repoPath, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]).catch(() => '');
  return String(out).trim().length > 0;
}

export type EnsureResult =
  | { ok: true }
  /** The PR head ref could not be fetched (network / auth / wrong remote). */
  | { ok: false; reason: 'fetch-failed'; detail: string }
  /** Objects still missing after the fetch — stale list, deleted PR… */
  | { ok: false; reason: 'missing'; missing: string[] };

/**
 * Make sure every selected commit exists as a local object before the squash
 * dialog runs. When SHAs are missing, calls `doFetch` (which should fetch the
 * PR head refspec via api.git.fetchRef) and re-checks ONLY the missing ones.
 * Never throws — callers map the result to a localized toast.
 */
export async function ensureCommitsLocal(
  repoPath: string,
  hashes: string[],
  doFetch: () => Promise<void>,
): Promise<EnsureResult> {
  const missing: string[] = [];
  for (const h of hashes) {
    if (!(await commitExists(repoPath, h))) missing.push(h);
  }
  if (missing.length === 0) return { ok: true };
  try {
    await doFetch();
  } catch (e) {
    return { ok: false, reason: 'fetch-failed', detail: e instanceof Error ? e.message : String(e) };
  }
  const stillMissing: string[] = [];
  for (const h of missing) {
    if (!(await commitExists(repoPath, h))) stillMissing.push(h);
  }
  if (stillMissing.length > 0) return { ok: false, reason: 'missing', missing: stillMissing };
  return { ok: true };
}
