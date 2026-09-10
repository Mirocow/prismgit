import { useState, useEffect, useMemo } from 'react';
import { Loader, Check, Settings as SettingsIcon, Search } from './icons';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { cn } from '../lib/utils';
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

const RESET_MODES: { mode: ResetMode; label: string; description: string }[] = [
  { mode: 'soft', label: 'Soft', description: 'Keep all local changes staged (index untouched).' },
  { mode: 'mixed', label: 'Mixed', description: 'Keep changes in the working tree, unstage everything.' },
  { mode: 'hard', label: 'Hard', description: 'Discard ALL uncommitted changes. Cannot be undone.' },
  { mode: 'keep', label: 'Keep', description: 'Reset HEAD + index, but keep local file modifications.' },
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
  useEffect(() => setRef(defaultRef), [defaultRef]);
  useEscapeKey(true, onClose);

  return (
    <DialogShell
      title={advanced ? 'Reset Advanced...' : 'Reset...'}
      subtitle={advanced
        ? `Reset the current branch to an arbitrary commit.\nTarget: '${branchName}'`
        : `Reset the current branch to '${branchName}'.\nChoose how your uncommitted work is treated:`}
      onClose={onClose}
      width={480}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className={cn('btn', mode === 'hard' ? 'btn-danger' : 'btn-primary')}
            disabled={busy || !ref.trim()}
            onClick={() => onSubmit(mode, ref.trim())}
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            Reset --{mode}
          </button>
        </>
      }
    >
      {advanced && (
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-text-tertiary flex-shrink-0">Reset to:</label>
          <input
            type="text"
            className="flex-1 text-sm font-mono"
            value={ref}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setRef(e.target.value)}
            placeholder="commit hash, branch, tag, HEAD~3 ..."
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
              <span className="block text-2xs text-text-tertiary">{m.description}</span>
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
  useEscapeKey(true, onClose);

  const filtered = useMemo(
    () => remoteBranches.filter((b) => b.toLowerCase().includes(filter.toLowerCase())),
    [remoteBranches, filter]
  );

  return (
    <DialogShell
      title="Set Tracked Branch..."
      subtitle={`Choose the upstream (remote-tracking branch) for local branch '${branchName}'.`}
      onClose={onClose}
      width={460}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!selected || busy}
            onClick={() => onSubmit(selected)}
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            Set Tracking
          </button>
        </>
      }
    >
      <div className="relative mb-2">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
        <input
          type="text"
          className="w-full text-sm pl-8"
          placeholder="Filter remote branches..."
          value={filter}
          autoFocus
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="border border-border-default rounded max-h-56 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-xs text-text-tertiary text-center">
            {remoteBranches.length === 0
              ? 'No remote branches. Fetch a remote first.'
              : 'No remote branches match the filter.'}
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
        <div className="text-2xs text-text-tertiary mt-2">Current upstream: <code>{current}</code></div>
      )}
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
  useEscapeKey(true, onClose);

  const invalidChars = /[~^:?*[\]\\@\s]|\.\.|^-$|^--/;
  const nameError = !name.trim()
    ? 'Tag name is required'
    : invalidChars.test(name.trim())
      ? 'Tag name contains invalid characters'
      : null;
  const canSubmit = !nameError && !!ref.trim() && !busy;
  const annotated = message.trim().length > 0;

  return (
    <DialogShell
      title="Add Tag..."
      subtitle={annotated
        ? 'A non-empty message creates an ANNOTATED tag (stored as a real tag object with author + date).'
        : 'Leave the message empty to create a lightweight tag.'}
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => onSubmit({ name: name.trim(), message: message.trim(), ref: ref.trim(), force })}
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            Add Tag
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs text-text-tertiary block mb-1">Name</label>
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
          <label className="text-xs text-text-tertiary block mb-1">Message (optional — makes it annotated)</label>
          <input
            type="text"
            className="w-full text-sm"
            placeholder="Release 1.0.0"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-text-tertiary block mb-1">Add to (ref)</label>
          <input
            type="text"
            className="w-full text-sm font-mono"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="HEAD, branch, tag or commit hash"
          />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
          Force (replace existing tag with the same name)
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
  useEscapeKey(true, onClose);

  return (
    <DialogShell
      title={`Pull — ${remoteName}`}
      subtitle={`Fetch new commits from '${remoteName}' and integrate them into the current branch.`}
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => onSubmit({ rebase, noFF })}>
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            Pull
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
            <span className="font-medium">Merge</span>
            <span className="block text-2xs text-text-tertiary">
              git pull → fetch + merge. Creates a merge commit when histories diverged.
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
            <span className="font-medium">Rebase</span>
            <span className="block text-2xs text-text-tertiary">
              git pull --rebase → replay your local commits on top of the fetched ones (linear history).
            </span>
          </span>
        </label>
      </div>
      {!rebase && (
        <label className="flex items-center gap-2 text-sm cursor-pointer mt-2 px-2.5">
          <input type="checkbox" checked={noFF} onChange={(e) => setNoFF(e.target.checked)} />
          Create a merge commit even when a fast-forward is possible (--no-ff)
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
  useEscapeKey(true, onClose);

  const parsed = parseInt(depth, 10);

  return (
    <DialogShell
      title={`Set Depth — ${remoteName}`}
      subtitle={`Set the shallow fetch depth for '${remoteName}'.\nOnly the newest N commits will be downloaded (git fetch --depth=N).`}
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || isNaN(parsed)} onClick={() => onSubmit(parsed)}>
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            Set Depth
          </button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-tertiary flex-shrink-0">Depth:</label>
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
        Enter <code>0</code> (or a negative number) to download the <b>full history</b> (git fetch --unshallow).
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
  useEscapeKey(true, onClose);

  const parsed = parseInt(commits, 10);
  const canSubmit = !isNaN(parsed) && parsed > 0;

  return (
    <DialogShell
      title={`Fetch More — ${remoteName}`}
      subtitle={`Download more commit history beyond the current shallow boundary\n(git fetch --deepen=N) without changing the depth setting.`}
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!canSubmit || busy} onClick={() => onSubmit(parsed)}>
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            Fetch More
          </button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-tertiary flex-shrink-0">Commits:</label>
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

  return (
    <DialogShell
      title={`Properties — ${props.name}`}
      subtitle="Read-only remote configuration, tracked branches and repository state."
      onClose={onClose}
      width={560}
      buttons={
        <button className="btn btn-primary" onClick={onClose}>
          <Check size={13} /> Close
        </button>
      }
    >
      <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top w-36">Name</td>
              <td className="font-mono py-1">{props.name}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">Fetch URL</td>
              <td className="font-mono py-1 break-all select-text">{props.fetchUrl || '—'}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">Push URL</td>
              <td className="font-mono py-1 break-all select-text">{props.pushUrl || props.fetchUrl || '—'}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">HEAD branch</td>
              <td className="font-mono py-1">{props.headBranch || '(unknown — run Fetch)'}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">Tracked branches</td>
              <td className="py-1">{props.trackingBranchCount}</td>
            </tr>
            <tr>
              <td className="text-text-tertiary py-1 pr-3 align-top">Clone state</td>
              <td className="py-1">
                {props.shallow ? (
                  <span className="badge badge-modified">shallow clone</span>
                ) : (
                  <span className="badge badge-added">complete</span>
                )}
                {props.mirror && <span className="badge badge-modified ml-1">mirror</span>}
              </td>
            </tr>
          </tbody>
        </table>

        {props.trackingBranches.length > 0 && (
          <div>
            <div className="text-2xs uppercase text-text-tertiary mb-1">
              Remote-tracking branches ({props.trackingBranchCount}
              {props.trackingBranchCount > props.trackingBranches.length ? '+, showing first 50' : ''})
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
              <SettingsIcon size={10} /> Config (remote.{props.name}.*)
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
