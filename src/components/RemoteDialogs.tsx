import { useState, useEffect } from 'react';
import { Loader, Check } from './icons';
import { useEscapeKey } from '../hooks/useEscapeKey';

/**
 * SmartGit-style modals shared by the Branches and Remotes pages:
 *
 *  - RenameDialog        — "Rename branch / remote": enter the new name
 *  - RemoteConfigDialog  — "Configure remote properties": URL or Path,
 *                          optional push URL, "Perform background Poll or
 *                          Fetch" checkbox; also used in Add mode.
 */

interface BaseDialogProps {
  busy?: boolean;
  onClose: () => void;
}

function DialogShell({ title, subtitle, children, buttons, onClose }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  buttons: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div className="panel w-[440px] p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-medium">{title}</h3>
        {subtitle && <p className="text-xs text-text-tertiary mt-1 mb-3">{subtitle}</p>}
        <div className={subtitle ? '' : 'mt-3'}>{children}</div>
        <div className="flex justify-end gap-2 mt-4">{buttons}</div>
      </div>
    </div>
  );
}

export function RenameDialog({
  kind,
  oldName,
  validate,
  busy,
  onSubmit,
  onClose,
}: BaseDialogProps & {
  kind: 'branch' | 'remote';
  oldName: string;
  /** Return an error string to disable submission, or null when valid. */
  validate?: (name: string) => string | null;
  onSubmit: (newName: string) => void;
}) {
  const [name, setName] = useState(oldName);
  useEffect(() => setName(oldName), [oldName]);
  useEscapeKey(true, onClose);

  const trimmed = name.trim();
  const error = validate ? validate(trimmed) : null;
  const unchanged = trimmed === oldName;
  const canSubmit = !!trimmed && !unchanged && !error && !busy;

  return (
    <DialogShell
      title={kind === 'branch' ? 'Rename branch' : 'Rename remote'}
      subtitle={`Enter the new name for the ${kind} '${oldName}'.`}
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit}
            onClick={() => canSubmit && onSubmit(trimmed)}
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            Rename
          </button>
        </>
      }
    >
      <div className="flex items-center gap-2">
        <label className="text-xs text-text-tertiary flex-shrink-0 w-11">Name:</label>
        <input
          type="text"
          className="flex-1 text-sm font-mono"
          value={name}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) onSubmit(trimmed);
          }}
        />
      </div>
      {error && <div className="text-2xs text-status-deleted mt-2">{error}</div>}
    </DialogShell>
  );
}

export function RemoteConfigDialog({
  mode,
  name: initialName,
  fetchUrl: initialFetch,
  pushUrl: initialPush,
  background: initialBackground,
  busy,
  onSubmit,
  onClose,
}: BaseDialogProps & {
  mode: 'configure' | 'add';
  name?: string;
  fetchUrl?: string;
  pushUrl?: string;
  background?: boolean;
  onSubmit: (data: { name: string; fetchUrl: string; pushUrl: string; background: boolean }) => void;
}) {
  const [name, setName] = useState(initialName ?? 'origin');
  const [fetchUrl, setFetchUrl] = useState(initialFetch ?? '');
  const [pushUrl, setPushUrl] = useState(initialPush ?? '');
  const [background, setBackground] = useState(initialBackground ?? false);
  useEscapeKey(true, onClose);

  const trimmedName = name.trim();
  const trimmedFetch = fetchUrl.trim();
  const canSubmit = !!trimmedFetch && (mode === 'configure' || !!trimmedName) && !busy;
  const changed =
    mode === 'add' ||
    trimmedFetch !== (initialFetch ?? '') ||
    pushUrl.trim() !== (initialPush ?? '') ||
    background !== (initialBackground ?? false);

  return (
    <DialogShell
      title={mode === 'add' ? 'Add remote' : 'Configure remote properties'}
      subtitle={
        mode === 'add'
          ? 'Add a new remote repository to push to and pull from.'
          : 'Change the URL and other properties for the remote.'
      }
      onClose={onClose}
      buttons={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!canSubmit || !changed}
            onClick={() => canSubmit && onSubmit({ name: trimmedName, fetchUrl: trimmedFetch, pushUrl: pushUrl.trim(), background })}
          >
            {busy ? <Loader size={13} className="animate-spin" /> : <Check size={13} />}
            {mode === 'add' ? 'Add' : 'OK'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {mode === 'add' && (
          <div>
            <label className="text-xs text-text-tertiary block mb-1">Name</label>
            <input
              type="text"
              className="w-full text-sm"
              placeholder="origin"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        <div>
          <label className="text-xs text-text-tertiary block mb-1">URL or Path:</label>
          <input
            type="text"
            className="w-full text-sm font-mono"
            placeholder="https://host/user/repo.git or git@host:user/repo.git"
            value={fetchUrl}
            autoFocus={mode === 'configure'}
            onChange={(e) => setFetchUrl(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSubmit && changed) {
                onSubmit({ name: trimmedName, fetchUrl: trimmedFetch, pushUrl: pushUrl.trim(), background });
              }
            }}
          />
        </div>
        {mode === 'configure' && (
          <div>
            <label className="text-xs text-text-tertiary block mb-1">
              Push URL <span className="text-text-tertiary">(leave empty = same as fetch URL)</span>
            </label>
            <input
              type="text"
              className="w-full text-sm font-mono"
              value={pushUrl}
              onChange={(e) => setPushUrl(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={background}
            onChange={(e) => setBackground(e.target.checked)}
          />
          Perform background Poll or Fetch
        </label>
        <div className="text-2xs text-text-tertiary">
          When enabled, PrismGit quietly fetches this remote every 5 minutes while the repository is open.
        </div>
      </div>
    </DialogShell>
  );
}
