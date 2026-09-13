import type { PushResult } from '../../electron/types/git-api';

export type PushToast =
  | { kind: 'success'; title: string; detail?: string }
  | { kind: 'info'; title: string; detail?: string }
  | { kind: 'error'; title: string; detail?: string };

/**
 * Turn a PushResult into an honest user-facing message.
 *
 * `git push` exits 0 in cases where the user's intent was NOT fulfilled —
 * most importantly:
 *  - "Everything up-to-date": nothing was sent (commits are on another
 *    branch / were never committed) — reporting "Pushed successfully" here
 *    made the user believe the remote branch received their work;
 *  - pushing `Main` while the remote branch is `main`: git creates a NEW
 *    remote branch and exits 0 — the branch the user watches stays stale;
 *  - the server silently rewrote/ignored the update (hooks, proxies).
 *
 * The post-push ls-remote verification in the git service catches all of
 * these; this function converts the outcome into the right toast kind.
 */
export function describePushResult(
  res: PushResult | undefined | null,
  remote?: string,
  branchLabel?: string
): PushToast {
  if (!res) return { kind: 'success', title: 'Pushed successfully' };

  const r = remote ?? res.remote;
  const b = branchLabel ?? res.branch ?? res.refs.find((x) => x.remoteRef)?.remoteRef ?? '';
  const v = res.verification;

  // Verification is the source of truth — it fires even when git exit 0.
  if (v && !v.ok) {
    const where = v.remoteHash
      ? `remote is at ${v.remoteHash.slice(0, 7)}`
      : 'the branch is missing on the remote';
    return {
      kind: 'error',
      title: 'Push did NOT update the remote branch',
      detail:
        `git reported success, but ${r}/${v.branch} was not updated (${where}; ` +
        `local ${v.localHash.slice(0, 7)}). Check the selected remote/branch ` +
        `and protected-branch rules on the server.`,
    };
  }

  if (res.upToDate && !res.updated) {
    return {
      kind: 'info',
      title: 'Everything up-to-date — nothing was pushed',
      detail: `${r}/${b} already contains all local commits. If you expected new commits here, check that they are committed on this branch.`,
    };
  }

  const created = res.refs.find((x) => x.created);
  if (created) {
    return {
      kind: 'success',
      title: `Published '${created.remoteRef}' → ${r}`,
      detail:
        `A new branch was created on the remote` +
        (created.remoteRef !== (res.branch ?? created.localRef)
          ? ` (note: you pushed '${created.localRef ?? res.branch}', remote ref is '${created.remoteRef}')`
          : '') +
        (v ? ` — verified at ${v.remoteHash?.slice(0, 7)}` : '') +
        '.',
    };
  }

  const head = res.refs.find((x) => !x.upToDate && !x.deleted && !x.rejected);
  const range =
    head && head.oldHash && head.newHash
      ? ` (${head.oldHash.slice(0, 7)}..${head.newHash.slice(0, 7)})`
      : '';
  return {
    kind: 'success',
    title: `Pushed '${b}' → ${r}/${head?.remoteRef ?? b}${range}`,
    detail: v ? `Verified: ${r}/${v.branch} now at ${v.remoteHash?.slice(0, 7)}` : undefined,
  };
}
