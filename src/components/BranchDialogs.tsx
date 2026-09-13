import { useState, useEffect, useMemo } from 'react';
import { Loader, Check, Settings as SettingsIcon, Search } from './icons';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import type { RemoteProperties } from '../../electron/types/git-api';

export type ResetMode = 'soft' | 'mixed' | 'hard' | 'keep';

/**
 * Dialogs used by the Branches page context menus (all REAL operations):
 *
 *  - ResetDialog           — reset current branch to a ref, mode selection
 *                            (soft / mixed / hard / keep). "Reset Advanced"
 *                            additionally lets you edit the target ref.
 *  - SetTrackedDialog      — pick the upstream for a local branch from the
 *                            list of remote branches (with filter).
 *  - PushToDialog          — "Push To...": choose the remote repository AND
 *                            the remote-side target branch (refspec
 *                            `local:target`), plus -u / --force-with-lease.
 *  - AddTagDialog          — create a lightweight or annotated tag on a ref.
 *  - PullOptionsDialog     — pull a remote: merge or rebase, optional --no-ff.
 *  - SetDepthDialog        — set shallow fetch depth (0 = unshallow).
 *  - FetchMoreDialog       — deepen a shallow clone by N commits.
 *  - RemotePropertiesDialog— read-only remote properties (URLs, HEAD branch,
 *                            tracking branches, shallow/mirror, raw config).
 */

function DialogShell({ title, subtitle, children, buttons, onClose, width = 440 }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  buttons: React.ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div className="panel p-4" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-medium">{title}</h3>
        {subtitle && <p className="text-xs text-text-tertiary mt-1 mb-3 whitespace-pre-line">{subtitle}</p>}
        <div className={subtitle ? '' : 'mt-3'}>{children}</div>
        <div className="flex justify-end gap-2 mt-4">{buttons}</div>
      </div>
    </div>
  );
}

const RESET_MODES: { mode: ResetMode; labelKey: string; descKey: string }[] = [
  { mode: 'soft', labelKey: 'branches.resetModeSoft', descKey: 'branches.resetSoftDesc' },
  { mode: 'mixed', labelKey: 'branches.resetModeMixed', descKey: 'branches.resetMixedDesc' },
  { mode: 'hard', labelKey: 'branches.resetModeHard', descKey: 'branches.resetHardDesc' },
  { mode: 'keep', labelKey: 'branches.resetModeKeep', descKey: 'branches.resetKeepDesc' },
];

export function ResetDialog({
  branchName,
  defaultRef,
  advanced = false,
  busy,
  onSubmit,
  onClose,
}: {
  branchName: string;
  /** Commit/ref the reset targets (prefilled, editable in advanced mode). */
  defaultRef: string;
  /** Advanced mode shows an editable ref field (Reset Advanced...). */
  advanced?: boolean;
  busy?: boolean;
  onSubmit: (mode: ResetMode, ref: string) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ResetMode>('mixed');
  const [ref, setRef] = useState(defaultRef);
  const { t } = useI18n();
  useEffect(() => setRef(defaultRef), [defaultRef]);
  useEscapeKey(true, onClose);

  return (
    <DialogShell
      title={advanced ? t('branches.resetAdvancedTitle') : t('branches.resetTitle')}
      subtitle={advanced
        ? t('branches.resetAdvancedSubtitle', { name: branchName })
        : t('branches.resetSubtitle', { name: branchName })}
      onClose={onClose}
      width={480}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className={cn('btn', mode === 'hard' ? 'btn-danger' : 'btn-primary')}
            disabled={busy || !ref.trim()}
            onClick={() => onSubmit(mode, ref.trim())}
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {t('branches.resetButton', { mode })}
          </button>
        </>
      }
    >
      {advanced && (
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-text-tertiary flex-shrink-0">{t('branches.resetToLabel')}</label>
          <input
            type="text"
            className="flex-1 text-sm font-mono"
            value={ref}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setRef(e.target.value)}
            placeholder={t('branches.resetRefPlaceholder')}
            onKeyDown={(e) => e.key === 'Enter' && ref.trim() && onSubmit(mode, ref.trim())}
          />
        </div>
      )}
      <div className="space-y-1">
        {RESET_MODES.map((m) => (
          <label
            key={m.mode}
            className={cn(
              'flex items-start gap-2 px-2.5 py-2 rounded-md cursor-pointer text-sm transition-colors',
              mode === m.mode ? 'bg-accent-muted' : 'hover:bg-bg-hover'
            )}
          >
            <input
              type="radio"
              name="reset-mode"
              checked={mode === m.mode}
              onChange={() => setMode(m.mode)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">--{m.mode}</span>
              <span className="block text-2xs text-text-tertiary">{t(m.descKey)}</span>
            </span>
          </label>
        ))}
      </div>
    </DialogShell>
  );
}

export function SetTrackedDialog({
  branchName,
  remoteBranches,
  current,
  busy,
  onSubmit,
  onClose,
}: {
  branchName: string;
  /** All available remote-tracking branch names (e.g. "origin/main"). */
  remoteBranches: string[];
  current?: string;
  busy?: boolean;
  onSubmit: (tracking: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(current || '');
  const { t } = useI18n();
  useEscapeKey(true, onClose);

  const filtered = useMemo(
    () => remoteBranches.filter((b) => b.toLowerCase().includes(filter.toLowerCase())),
    [remoteBranches, filter]
  );

  return (
    <DialogShell
      title={t('branches.setTracked')}
      subtitle={t('branches.setTrackedSubtitle', { name: branchName })}
      onClose={onClose}
      width={460}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!selected || busy}
            onClick={() => onSubmit(selected)}
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {t('branches.setTrackingButton')}
          </button>
        </>
      }
    >
      <div className="relative mb-2">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          className="w-full text-sm pl-8"
          placeholder={t('branches.filterRemoteBranches')}
          value={filter}
          autoFocus
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="border border-border-default rounded max-h-56 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-tertiary text-center">
            {remoteBranches.length === 0
              ? t('branches.noRemoteBranches')
              : t('branches.noRemoteBranchesMatch')}
          </div>
        ) : (
          filtered.map((b) => (
            <label
              key={b}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer font-mono transition-colors',
                selected === b ? 'bg-accent-muted text-accent' : 'hover:bg-bg-hover'
              )}
            >
              <input
                type="radio"
                name="tracked-branch"
                checked={selected === b}
                onChange={() => setSelected(b)}
              />
              <span className="truncate">{b}</span>
            </label>
          ))
        )}
      </div>
      {current && (
        <div className="text-2xs text-text-tertiary mt-2">{t('branches.currentUpstream')} <code>{current}</code></div>
      )}
    </DialogShell>
  );
}

const BRANCH_NAME_INVALID = /[~^:?*[\]\\@\s]|\.\.|^-$|^--/;

/**
 * "Push To..." — pick the remote repository AND the remote-side branch name.
 *
 * SmartGit semantics: the user right-clicks a LOCAL branch, chooses Push To...
 * and gets to decide WHERE (remote) and UNDER WHICH NAME (target branch) the
 * branch lands. Pushing `feature` to `main`-named target, publishing a local
 * branch to a second remote, or renaming on the remote side are all the same
 * refspec: `git push [-u] [--force-with-lease] <remote> <local>:<target>`.
 */
export function PushToDialog({
  branchName,
  remotes,
  defaultRemote,
  remoteBranches = [],
  hasUpstream = false,
  busy,
  onSubmit,
  onClose,
}: {
  /** The local (source) branch being pushed. */
  branchName: string;
  /** Configured remote names (e.g. ["origin", "upstream"]). */
  remotes: string[];
  /** Preselected remote (the branch's tracking remote, or the repo default). */
  defaultRemote?: string;
  /** Remote-tracking branch names ("origin/main") — target-name suggestions. */
  remoteBranches?: string[];
  /** Whether the branch already has an upstream (→ -u unchecked by default). */
  hasUpstream?: boolean;
  busy?: boolean;
  onSubmit: (opts: { remote: string; targetBranch: string; setUpstream: boolean; force: boolean }) => void;
  onClose: () => void;
}) {
  const [remote, setRemote] = useState(defaultRemote || remotes[0] || 'origin');
  const [target, setTarget] = useState(branchName);
  const [setUpstream, setSetUpstream] = useState(!hasUpstream);
  const [force, setForce] = useState(false);
  const { t } = useI18n();
  useEscapeKey(true, onClose);

  const trimmed = target.trim();
  const targetError = !trimmed
    ? t('branches.targetRequired')
    : BRANCH_NAME_INVALID.test(trimmed)
      ? t('branches.nameInvalidChars')
      : null;

  // Suggest existing branches that live on the SELECTED remote
  // ("origin/main" → "main") so the user can pick instead of typing.
  const suggestions = useMemo(
    () => remoteBranches
      .filter((b) => b.startsWith(`${remote}/`))
      .map((b) => b.slice(remote.length + 1)),
    [remoteBranches, remote]
  );

  const canSubmit = !targetError && !!remote.trim() && !busy;
  const refspec = trimmed === branchName ? branchName : `${branchName}:${trimmed}`;
  const renamed = trimmed !== branchName && !targetError;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit({ remote: remote.trim(), targetBranch: trimmed, setUpstream, force });
  };

  return (
    <DialogShell
      title={t('branches.pushTo')}
      subtitle={t('branches.pushToSubtitle', { name: branchName })}
      onClose={onClose}
      width={480}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!canSubmit} onClick={submit}>
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {t('branches.push')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="push-to-remote" className="text-xs text-text-tertiary block mb-1">{t('branches.remoteRepoLabel')}</label>
          {remotes.length > 0 ? (
            <select
              id="push-to-remote"
              className="w-full text-sm font-mono"
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
            >
              {remotes.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          ) : (
            // No remotes configured — let the user type a name anyway
            <input
              id="push-to-remote"
              type="text"
              className="w-full text-sm font-mono"
              value={remote}
              autoFocus
              onChange={(e) => setRemote(e.target.value)}
              placeholder="origin"
            />
          )}
        </div>
        <div>
          <label htmlFor="push-to-target" className="text-xs text-text-tertiary block mb-1">{t('branches.targetBranchLabel')}</label>
          <input
            id="push-to-target"
            type="text"
            className="w-full text-sm font-mono"
            value={target}
            list="push-to-target-suggestions"
            autoFocus={remotes.length > 0}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
          <datalist id="push-to-target-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {targetError && <div className="text-2xs text-status-deleted mt-1">{targetError}</div>}
          {renamed && (
            <div className="text-2xs text-text-tertiary mt-1">
              {t('branches.remoteRefWillBe')} <code>{remote}/{trimmed}</code> {t('branches.localKeepsName')}
            </div>
          )}
        </div>
        <div className="space-y-1 pt-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={setUpstream} onChange={(e) => setSetUpstream(e.target.checked)} />
            {t('branches.setUpstreamCheckbox')}
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
            {t('branches.forcePushCheckbox')}
          </label>
        </div>
        <div data-testid="push-to-cmd" className="text-2xs text-text-tertiary font-mono bg-bg-hover/60 rounded px-2 py-1.5 break-all">
          git push {setUpstream ? '-u ' : ''}{force ? '--force-with-lease ' : ''}{remote} {refspec}
        </div>
      </div>
    </DialogShell>
  );
}

export function AddTagDialog({
  defaultRef,
  busy,
  onSubmit,
  onClose,
}: {
  /** Ref the new tag points to (current branch / selected commit). */
  defaultRef: string;
  busy?: boolean;
  onSubmit: (data: { name: string; message: string; ref: string; force: boolean }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [ref, setRef] = useState(defaultRef);
  const [force, setForce] = useState(false);
  const { t } = useI18n();
  useEscapeKey(true, onClose);

  const invalidChars = /[~^:?*[\]\\@\s]|\.\.|^-$|^--/;
  const nameError = !name.trim()
    ? t('tags.nameRequired')
    : invalidChars.test(name.trim())
      ? t('tags.nameInvalidChars')
      : null;
  const canSubmit = !nameError && !!ref.trim() && !busy;
  const annotated = message.trim().length > 0;

  return (
    <DialogShell
      title={t('tags.addTagMenu')}
      subtitle={annotated
        ? t('tags.addTagAnnotatedHint')
        : t('tags.addTagLightweightHint')}
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => onSubmit({ name: name.trim(), message: message.trim(), ref: ref.trim(), force })}
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {t('tags.addButton')}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs text-text-tertiary block mb-1">{t('tags.nameLabel')}</label>
          <input
            type="text"
            className="w-full text-sm font-mono"
            placeholder="v1.0.0"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSubmit && onSubmit({ name: name.trim(), message: message.trim(), ref: ref.trim(), force })}
          />
          {nameError && <div className="text-2xs text-status-deleted mt-1">{nameError}</div>}
        </div>
        <div>
          <label className="text-xs text-text-tertiary block mb-1">{t('tags.messageOptionalAnnotated')}</label>
          <input
            type="text"
            className="w-full text-sm"
            placeholder={t('tags.addTagMessagePlaceholder')}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-text-tertiary block mb-1">{t('tags.addToRefLabel')}</label>
          <input
            type="text"
            className="w-full text-sm font-mono"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder={t('tags.addTagRefPlaceholder')}
          />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          {t('tags.forceCheckbox')}
        </label>
      </div>
    </DialogShell>
  );
}

export function PullOptionsDialog({
  remoteName,
  busy,
  onSubmit,
  onClose,
}: {
  remoteName: string;
  busy?: boolean;
  onSubmit: (opts: { rebase: boolean; noFF: boolean }) => void;
  onClose: () => void;
}) {
  const [rebase, setRebase] = useState(false);
  const [noFF, setNoFF] = useState(false);
  const { t } = useI18n();
  useEscapeKey(true, onClose);

  return (
    <DialogShell
      title={t('remotes.pullTitle', { name: remoteName })}
      subtitle={t('remotes.pullSubtitle', { name: remoteName })}
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => onSubmit({ rebase, noFF })}>
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {t('remotes.pull')}
          </button>
        </>
      }
    >
      <div className="space-y-1">
        <label
          className={cn(
            'flex items-start gap-2 px-2.5 py-2 rounded-md cursor-pointer text-sm transition-colors',
            !rebase ? 'bg-accent-muted' : 'hover:bg-bg-hover'
          )}
        >
          <input type="radio" name="pull-mode" checked={!rebase} onChange={() => setRebase(false)} className="mt-0.5" />
          <span>
            <span className="font-medium">{t('toolbar.merge')}</span>
            <span className="block text-2xs text-text-tertiary">
              {t('remotes.mergeDesc')}
            </span>
          </span>
        </label>
        <label
          className={cn(
            'flex items-start gap-2 px-2.5 py-2 rounded-md cursor-pointer text-sm transition-colors',
            rebase ? 'bg-accent-muted' : 'hover:bg-bg-hover'
          )}
        >
          <input type="radio" name="pull-mode" checked={rebase} onChange={() => setRebase(true)} className="mt-0.5" />
          <span>
            <span className="font-medium">{t('toolbar.rebase')}</span>
            <span className="block text-2xs text-text-tertiary">
              {t('remotes.rebaseDesc')}
            </span>
          </span>
        </label>
      </div>
      {!rebase && (
        <label className="flex items-center gap-2 text-sm cursor-pointer mt-2 px-2.5">
          <input type="checkbox" checked={noFF} onChange={(e) => setNoFF(e.target.checked)} />
          {t('remotes.noFFCheckbox')}
        </label>
      )}
    </DialogShell>
  );
}

export function SetDepthDialog({
  remoteName,
  busy,
  onSubmit,
  onClose,
}: {
  remoteName: string;
  busy?: boolean;
  /** depth > 0 → git fetch --depth=N; depth = 0 → --unshallow. */
  onSubmit: (depth: number) => void;
  onClose: () => void;
}) {
  const [depth, setDepth] = useState('50');
  const { t } = useI18n();
  useEscapeKey(true, onClose);

  const parsed = parseInt(depth, 10);

  return (
    <DialogShell
      title={t('remotes.setDepthTitle', { name: remoteName })}
      subtitle={t('remotes.setDepthSubtitle', { name: remoteName })}
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={busy || isNaN(parsed)} onClick={() => onSubmit(parsed)}>
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {t('remotes.setDepthButton')}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-tertiary flex-shrink-0">{t('remotes.depthLabel')}</label>
        <input
          type="number"
          min={0}
          className="flex-1 text-sm font-mono"
          value={depth}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDepth(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !isNaN(parsed) && onSubmit(parsed)}
        />
      </div>
      <div className="text-2xs text-text-tertiary mt-2">
        {t('remotes.depthHintBefore')} <code>0</code> {t('remotes.depthHintMiddle')} <b>{t('remotes.depthHintFullHistory')}</b> {t('remotes.depthHintAfter')}
      </div>
    </DialogShell>
  );
}

export function FetchMoreDialog({
  remoteName,
  busy,
  onSubmit,
  onClose,
}: {
  remoteName: string;
  busy?: boolean;
  onSubmit: (commits: number) => void;
  onClose: () => void;
}) {
  const [commits, setCommits] = useState('100');
  const { t } = useI18n();
  useEscapeKey(true, onClose);

  const parsed = parseInt(commits, 10);
  const canSubmit = !isNaN(parsed) && parsed > 0;

  return (
    <DialogShell
      title={t('remotes.fetchMoreTitle', { name: remoteName })}
      subtitle={t('remotes.fetchMoreSubtitle')}
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={!canSubmit || busy} onClick={() => onSubmit(parsed)}>
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {t('remotes.fetchMoreButton')}
          </button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-tertiary flex-shrink-0">{t('remotes.commitsLabel')}</label>
        <input
          type="number"
          min={1}
          className="flex-1 text-sm font-mono"
          value={commits}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setCommits(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canSubmit && onSubmit(parsed)}
        />
      </div>
    </DialogShell>
  );
}

export function RemotePropertiesDialog({
  props,
  onClose,
}: {
  props: RemoteProperties;
  onClose: () => void;
}) {
  useEscapeKey(true, onClose);
  const { t } = useI18n();

  return (
    <DialogShell
      title={t('remotes.propertiesTitle', { name: props.name })}
      subtitle={t('remotes.propertiesSubtitle')}
      onClose={onClose}
      width={560}
      buttons={
        <button className="btn btn-primary" onClick={onClose}>
          <Check size={13} /> {t('common.close')}
        </button>
      }
    >
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top w-36">{t('remotes.nameLabel')}</td>
              <td className="font-mono py-1">{props.name}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">{t('remotes.fetchUrlLabel')}</td>
              <td className="font-mono py-1 break-all select-text">{props.fetchUrl || '—'}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">{t('remotes.pushUrlLabel')}</td>
              <td className="font-mono py-1 break-all select-text">{props.pushUrl || props.fetchUrl || '—'}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">{t('remotes.headBranchLabel')}</td>
              <td className="font-mono py-1">{props.headBranch || t('remotes.headUnknown')}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">{t('remotes.trackedBranchesLabel')}</td>
              <td className="py-1">{props.trackingBranchCount}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">{t('remotes.cloneStateLabel')}</td>
              <td className="py-1">
                {props.shallow ? (
                  <span className="badge badge-modified">{t('remotes.shallowBadge')}</span>
                ) : (
                  <span className="badge badge-added">{t('remotes.completeBadge')}</span>
                )}
                {props.mirror && <span className="badge badge-modified ml-1">{t('remotes.mirrorBadge')}</span>}
              </td>
            </tr>
          </tbody>
        </table>

        {props.trackingBranches.length > 0 && (
          <div>
            <div className="text-2xs uppercase text-text-tertiary mb-1">
              {t('remotes.trackingBranchesHeader')} ({props.trackingBranchCount}
              {props.trackingBranchCount > props.trackingBranches.length ? t('remotes.showingFirst50') : ''})
            </div>
            <div className="border border-border-default rounded max-h-32 overflow-y-auto">
              {props.trackingBranches.map((b) => (
                <div key={b} className="px-3 py-1 text-xs font-mono border-b border-border-subtle last:border-b-0">
                  {b}
                </div>
              ))}
            </div>
          </div>
        )}

        {props.config.length > 0 && (
          <div>
            <div className="text-2xs uppercase text-text-tertiary mb-1 flex items-center gap-1">
              <SettingsIcon size={10} /> {t('remotes.configHeader', { name: props.name })}
            </div>
            <div className="border border-border-default rounded max-h-40 overflow-y-auto">
              {props.config.map((c) => (
                <div key={c.key} className="px-3 py-1 text-2xs font-mono border-b border-border-subtle last:border-b-0 break-all">
                  <span className="text-text-tertiary">{c.key} = </span>
                  <span className="select-text">{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
