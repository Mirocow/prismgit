import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastActions } from '../stores/toastStore';
import { Loader, Settings as SettingsIcon, X } from './icons';

/**
 * SmartGit "Repository | Settings": per-repository configuration stored in
 * <repo>/.git/config — User, Fetch and Pull, Push, Signing, Encoding,
 * Tag-Grouping (the same tabs as SmartGit's Repository Settings dialog).
 */

const TABS = ['User', 'Fetch and Pull', 'Push', 'Credential Helper', 'Signing', 'Encoding', 'Tag-Grouping', 'Performance'] as const;
type Tab = (typeof TABS)[number];

/** Every key the dialog reads — fetched with ONE `git config --list -z`
 * subprocess via api.git.configGetMany (used to be 19 parallel configGet
 * IPC round-trips; on slow-spawn machines the busy spinner sat for many
 * seconds and the app read as frozen — "Repository Settings зависло
 * приложение при открытии"). */
const CONFIG_KEYS = [
  'user.name', 'user.email', 'pull.rebase', 'fetch.prune',
  'fetch.recurseSubmodules', 'push.recurseSubmodules',
  'commit.gpgsign', 'user.signingkey', 'gpg.program', 'gui.encoding',
  'smartgit.tag-grouping.pattern', 'smartgit.tag-grouping.single', 'smartgit.tag-grouping.order',
  'credential.helper', 'submodule.recurse', 'submodule.active',
  'feature.manyFiles', 'core.fsmonitor', 'fetch.writeCommitGraph',
];

/** Busy-spinner guard: even if the main process/queue wedges, the dialog
 * becomes editable (with defaults) after this window instead of spinning
 * forever — a stuck spinner is exactly what reads as "the app froze". */
const CONFIG_LOAD_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function RepoSettingsDialog({ onClose, remoteName }: { onClose: () => void; remoteName?: string }) {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('User');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [pullRebase, setPullRebase] = useState('false');
  const [fetchPrune, setFetchPrune] = useState('false');
  const [subUpdate, setSubUpdate] = useState('');        // submodule.recurse? we use fetch.recurseSubmodules
  const [fetchRecurseSubmodules, setFetchRecurseSubmodules] = useState('on-demand');
  const [pushSubmodules, setPushSubmodules] = useState('check'); // check|ignore|on-demand → push.recurseSubmodules
  const [signCommits, setSignCommits] = useState('false');
  const [signingKey, setSigningKey] = useState('');
  // Empty means "use git's default (gpg)" — stored as UNSET, never as a
  // written value, so saving the dialog doesn't force gpg.program into
  // .git/config (simple-git blocks that key without allowUnsafeGpgProgram).
  const [gpgProgram, setGpgProgram] = useState('');
  const [encoding, setEncoding] = useState('UTF-8');
  const [tagGroupPattern, setTagGroupPattern] = useState('');
  const [tagGroupSinglePattern, setTagGroupSinglePattern] = useState('');
  const [tagGroupOrder, setTagGroupOrder] = useState('');
  // Credential Helper tab
  const [credentialHelper, setCredentialHelper] = useState('');
  // Fetch and Pull — extra submodule checkboxes (SmartGit has these as
  // separate toggles, not just the recurseSubmodules select).
  const [submoduleUpdate, setSubmoduleUpdate] = useState<boolean>(false);
  const [submoduleInit, setSubmoduleInit] = useState<string>('');
  // Performance tab — per-repo git config (local scope)
  const [repoManyFiles, setRepoManyFiles] = useState('');
  const [repoFsmonitor, setRepoFsmonitor] = useState('');
  const [repoCommitGraph, setRepoCommitGraph] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const values = await withTimeout(
        api.git.configGetMany(repo.path, CONFIG_KEYS),
        CONFIG_LOAD_TIMEOUT_MS,
        'Repository Settings load',
      );
      const v = (key: string, def = '') => values[key] ?? def;
      const pr = v('pull.rebase');
      setUserName(v('user.name'));
      setUserEmail(v('user.email'));
      setPullRebase(pr === 'true' || pr === 'input' ? pr : 'false');
      setFetchPrune(v('fetch.prune', 'false'));
      setFetchRecurseSubmodules(v('fetch.recurseSubmodules', 'on-demand'));
      setPushSubmodules(v('push.recurseSubmodules', 'check'));
      setSignCommits(v('commit.gpgsign', 'false'));
      setSigningKey(v('user.signingkey'));
      setGpgProgram(v('gpg.program'));
      setEncoding(v('gui.encoding', 'UTF-8'));
      setTagGroupPattern(v('smartgit.tag-grouping.pattern'));
      setTagGroupSinglePattern(v('smartgit.tag-grouping.single'));
      setTagGroupOrder(v('smartgit.tag-grouping.order'));
      setCredentialHelper(v('credential.helper'));
      setSubmoduleUpdate(v('submodule.recurse') === 'true');
      setSubmoduleInit(v('submodule.active'));
      setRepoManyFiles(v('feature.manyFiles'));
      setRepoFsmonitor(v('core.fsmonitor'));
      setRepoCommitGraph(v('fetch.writeCommitGraph'));
    } catch (e) {
      toast.error(t('toast.repo.settingsLoadFailed'), String(e));
      // Fields keep their defaults — the dialog stays usable and closable;
      // a busy spinner that never ends must never read as "the app froze".
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    const p = repo.path;
    // set-or-unset: empty fields are REMOVED from .git/config instead of
    // written as empty values. Writing user.name="" breaks every future
    // commit with "empty ident name not allowed"; writing gpg.program=""
    // is what tripped simple-git's allowUnsafeGpgProgram block before.
    // The whole dialog is written with ONE api.git.configSetMany call —
    // sequential in the main process (git holds .git/config.lock per
    // write), with lock-contention retry; used to be ~20 awaited IPC
    // round-trips in a row.
    const entries: { key: string; value: string | null }[] = [];
    const put = (key: string, value: string | null) => entries.push({ key, value });
    const setOrUnset = (key: string, value: string) => put(key, value.trim() || null);
    const set = (key: string, value: string) => put(key, value);

    setOrUnset('user.name', userName);
    setOrUnset('user.email', userEmail);
    set('pull.rebase', pullRebase);
    set('fetch.prune', fetchPrune);
    set('fetch.recurseSubmodules', fetchRecurseSubmodules);
    set('push.recurseSubmodules', pushSubmodules);
    set('commit.gpgsign', signCommits);
    setOrUnset('user.signingkey', signingKey);
    setOrUnset('gpg.program', gpgProgram);
    set('gui.encoding', encoding);
    if (tagGroupPattern.trim()) {
      set('smartgit.tag-grouping.pattern', tagGroupPattern.trim());
      set('smartgit.tag-grouping.order', tagGroupOrder.trim() || 'ascending');
      setOrUnset('smartgit.tag-grouping.single', tagGroupSinglePattern);
    } else {
      put('smartgit.tag-grouping.pattern', null);
      put('smartgit.tag-grouping.single', null);
      put('smartgit.tag-grouping.order', null);
    }
    // Credential Helper
    setOrUnset('credential.helper', credentialHelper);
    // Submodule update/init
    set('submodule.recurse', String(submoduleUpdate));
    setOrUnset('submodule.active', submoduleInit);
    // Performance — per-repo overrides (local scope)
    setOrUnset('feature.manyFiles', repoManyFiles);
    setOrUnset('core.fsmonitor', repoFsmonitor);
    setOrUnset('fetch.writeCommitGraph', repoCommitGraph);

    try {
      await api.git.configSetMany(p, entries);
      toast.success(t('toast.repo.settingsSaved'));
      onClose();
    } catch (e) {
      toast.error(t('toast.repo.settingsSaveFailed'), String(e));
    } finally {
      setSaving(false);
    }
  };

  const selectCls = 'px-2 py-1.5 text-xs bg-surface border border-border rounded focus:outline-none focus:border-accent';
  const inputCls = selectCls;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6" onClick={onClose}>
      <div className="panel w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">{t('action.label.repositorySettings')}</span>
          <span className="text-xs text-text-tertiary ml-2 truncate">{repo.name}</span>
          {remoteName && (
            <span className="badge badge-renamed ml-2 text-2xs">remote: {remoteName}</span>
          )}
          <div className="flex-1" />
          {/* Open Project Settings (global application preferences) */}
          <button
            onClick={() => {
              onClose();
              window.location.hash = '#/settings';
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-secondary hover:text-accent hover:bg-surface-hover rounded transition-colors"
            title="Open Project Settings (global application preferences)"
          >
            <SettingsIcon size={12} />
            Project Settings
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-hover ml-1"><X size={14} /></button>
        </div>

        <div className="flex border-b border-border overflow-x-auto">
          {TABS.map((tabName) => (
            <button
              key={tabName}
              onClick={() => setTab(tabName)}
              className={cn(
                'px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px',
                tab === tabName ? 'border-accent text-accent font-medium' : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              {tabName}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 text-xs">
          {busy ? (
            <div className="flex justify-center py-8"><Loader size={16} className="animate-spin text-text-tertiary" /></div>
          ) : tab === 'User' && (
            <div className="grid grid-cols-1 gap-3">
              <p className="text-text-tertiary">Identifies the commit author for this repository (user.name / user.email in .git/config).</p>
              <label className="flex flex-col gap-1 text-text-secondary">User name
                <input value={userName} onChange={(e) => setUserName(e.target.value)} className={inputCls} placeholder={t('action.label.yourName')} />
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">E-mail
                <input value={userEmail} onChange={(e) => setUserEmail(e.target.value)} className={inputCls} placeholder="you@example.com" />
              </label>
            </div>
          )}
          {tab === 'Fetch and Pull' && (
            <div className="grid grid-cols-1 gap-3">
              <p className="text-text-tertiary">How the Pull command integrates new commits from the tracked remote branch.</p>
              <label className="flex flex-col gap-1 text-text-secondary">When pulling
                <select value={pullRebase} onChange={(e) => setPullRebase(e.target.value)} className={selectCls}>
                  <option value="false">{t('action.label.mergeRemote')}</option>
                  <option value="true">{t('action.label.rebaseLocal')}</option>
                  <option value="input">Ask every time (pull.rebase=input)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">Obsolete remote branches
                <select value={fetchPrune} onChange={(e) => setFetchPrune(e.target.value)} className={selectCls}>
                  <option value="false">Keep (no prune)</option>
                  <option value="true">Delete automatically (fetch.prune)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">Submodules when fetching
                <select value={fetchRecurseSubmodules} onChange={(e) => setFetchRecurseSubmodules(e.target.value)} className={selectCls}>
                  <option value="false">{t('action.label.doNotRecurse')}</option>
                  <option value="on-demand">Fetch new commits in registered submodules (on-demand)</option>
                  <option value="true">{t('action.label.alwaysRecurse')}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-text-secondary">
                <input type="checkbox" checked={submoduleUpdate === true} onChange={(e) => setSubmoduleUpdate(e.target.checked)} />
                Update registered submodules (submodule.recurse)
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">Initialize new submodules (submodule.active)
                <input value={submoduleInit} onChange={(e) => setSubmoduleInit(e.target.value)} className={inputCls} placeholder=".* (all) or specific paths, empty = disabled" />
              </label>
            </div>
          )}
          {tab === 'Push' && (
            <div className="grid grid-cols-1 gap-3">
              <p className="text-text-tertiary">What happens with submodules that have changes when you push.</p>
              <label className="flex flex-col gap-1 text-text-secondary">Submodule changes
                <select value={pushSubmodules} onChange={(e) => setPushSubmodules(e.target.value)} className={selectCls}>
                  <option value="check">Abort if submodules have unpushed changes (check)</option>
                  <option value="ignore">Ignore — push only the current repository</option>
                  <option value="on-demand">Push submodule changes first (on-demand)</option>
                </select>
              </label>
            </div>
          )}
          {tab === 'Credential Helper' && (
            <div className="grid grid-cols-1 gap-3">
              <p className="text-text-tertiary">Configure how Git stores credentials for HTTPS remotes (credential.helper).</p>
              <label className="flex flex-col gap-1 text-text-secondary">Credential helper
                <select value={credentialHelper} onChange={(e) => setCredentialHelper(e.target.value)} className={selectCls}>
                  <option value="">None (prompt every time)</option>
                  <option value="store">store — plaintext file in ~/.git-credentials</option>
                  <option value="cache">cache — in-memory for 15 minutes</option>
                  <option value="osxkeychain">osxkeychain — macOS Keychain</option>
                  <option value="manager">manager — Git Credential Manager (Windows)</option>
                  <option value="libsecret">libsecret — GNOME Keyring (Linux)</option>
                  <option value="wincred">wincred — Windows Credential Manager (legacy)</option>
                </select>
              </label>
              <p className="text-text-tertiary text-2xs">
                PrismGit stores HTTP credentials for remotes in its encrypted vault
                (Settings → Security → Known credentials). The credential.helper setting
                above affects command-line git, not PrismGit's internal auth.
              </p>
            </div>
          )}
          {tab === 'Signing' && (
            <div className="grid grid-cols-1 gap-3">
              <p className="text-text-tertiary">GPG signing of tags and commits (commit.gpgsign / user.signingkey / gpg.program).</p>
              <label className="flex items-center gap-2 text-text-secondary">
                <input type="checkbox" checked={signCommits === 'true'} onChange={(e) => setSignCommits(String(e.target.checked))} />
                Sign commits and tags
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">Signing key
                <input value={signingKey} onChange={(e) => setSigningKey(e.target.value)} className={inputCls} placeholder="GPG key id / fingerprint" />
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">GPG program
                <input value={gpgProgram} onChange={(e) => setGpgProgram(e.target.value)} className={inputCls} placeholder="gpg (default — leave empty to unset)" />
              </label>
            </div>
          )}
          {tab === 'Encoding' && (
            <div className="grid grid-cols-1 gap-3">
              <p className="text-text-tertiary">Text encoding used in the Changes view and editors (gui.encoding). UTF-8 is detected automatically.</p>
              <label className="flex flex-col gap-1 text-text-secondary">Encoding
                <select value={encoding} onChange={(e) => setEncoding(e.target.value)} className={selectCls}>
                  {['UTF-8', 'UTF-16', 'Windows-1251', 'Windows-1252', 'ISO-8859-1', 'KOI8-R', 'GBK', 'Shift_JIS'].map((enc) => (
                    <option key={enc} value={enc}>{enc}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {tab === 'Tag-Grouping' && (
            <div className="grid grid-cols-1 gap-3">
              <p className="text-text-tertiary">
                Group tags matching a RegEx pattern into one node in the Branches view and the graph
                (smartgit.tag-grouping.*). Leave empty to disable grouping.
              </p>
              <label className="flex flex-col gap-1 text-text-secondary">Pattern (RegEx, capture group = displayed name)
                <input value={tagGroupPattern} onChange={(e) => setTagGroupPattern(e.target.value)} className={inputCls} placeholder={'v(\\d+\\.\\d+)\\..*  →  groups v1.x tags'} />
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">Single patterns (refs to preserve individually)
                <input value={tagGroupSinglePattern} onChange={(e) => setTagGroupSinglePattern(e.target.value)} className={inputCls} placeholder={'refs/heads/main  →  never group this ref'} />
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">Sort order
                <select value={tagGroupOrder} onChange={(e) => setTagGroupOrder(e.target.value)} className={selectCls}>
                  <option value="ascending">{t('action.label.ascending')}</option>
                  <option value="descending">{t('action.label.descending')}</option>
                </select>
              </label>
            </div>
          )}

          {tab === 'Performance' && (
            <div className="grid grid-cols-1 gap-3">
              <p className="text-text-tertiary">
                Per-repo git performance settings. Empty = inherit from global/app settings.
                Set to 'true' or 'false' to override for this repo only.
              </p>
              <label className="flex flex-col gap-1 text-text-secondary">
                feature.manyFiles
                <input value={repoManyFiles} onChange={(e) => setRepoManyFiles(e.target.value)} className={inputCls} placeholder="true / false / (empty = inherit)" />
                <span className="text-text-tertiary text-2xs">Optimize index for repos with many files</span>
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">
                core.fsmonitor
                <input value={repoFsmonitor} onChange={(e) => setRepoFsmonitor(e.target.value)} className={inputCls} placeholder="true / false / (empty = inherit)" />
                <span className="text-text-tertiary text-2xs">FileSystem Monitor — track changed files without scanning the whole tree</span>
              </label>
              <label className="flex flex-col gap-1 text-text-secondary">
                fetch.writeCommitGraph
                <input value={repoCommitGraph} onChange={(e) => setRepoCommitGraph(e.target.value)} className={inputCls} placeholder="true / false / (empty = inherit)" />
                <span className="text-text-tertiary text-2xs">Write commit-graph cache after fetch — speeds up log/blame</span>
              </label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          {/* Config file paths — matches SmartGit's bottom panel showing
              where the settings are stored. */}
          {/* <div className="flex-1 text-2xs text-text-tertiary font-mono flex flex-col justify-center gap-0.5">
            <span>Repo config: {repo.path}/.git/config</span>
            <span>Global config: ~/.gitconfig</span>
          </div> */}
          <button className="px-3 py-1.5 text-xs rounded border border-border hover:bg-surface-hover" onClick={onClose}>{t('action.button.cancel')}</button>
          <button
            className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
            onClick={save}
            disabled={saving || busy}
          >
            {saving && <Loader size={12} className="animate-spin" />}
            {t('action.button.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
