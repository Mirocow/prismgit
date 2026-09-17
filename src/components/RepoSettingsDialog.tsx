import { useState, useEffect, useCallback } from 'react';
import { X, Loader, Settings as SettingsIcon } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

/**
 * SmartGit "Repository | Settings": per-repository configuration stored in
 * <repo>/.git/config — User, Fetch and Pull, Push, Signing, Encoding,
 * Tag-Grouping (the same tabs as SmartGit's Repository Settings dialog).
 */

const TABS = ['User', 'Fetch and Pull', 'Push', 'Credential Helper', 'Signing', 'Encoding', 'Tag-Grouping', 'Performance'] as const;
type Tab = (typeof TABS)[number];

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
    const p = repo.path;
    const get = (k: string, def = '') => api.git.configGet(p, k).then((v) => v ?? def).catch(() => def);
    try {
      const [n, e, pr, fp, frs, prs, sc, sk, gp, enc, tgp, tgp2, tgo, mf, fsm, wcg, ch, su, si] = await Promise.all([
        get('user.name'), get('user.email'),
        get('pull.rebase', 'false'), get('fetch.prune', 'false'),
        get('fetch.recurseSubmodules', 'on-demand'),
        get('push.recurseSubmodules', 'check'),
        get('commit.gpgsign', 'false'), get('user.signingkey'), get('gpg.program'),
        get('gui.encoding', 'UTF-8'),
        get('smartgit.tag-grouping.pattern'), get('smartgit.tag-grouping.single'), get('smartgit.tag-grouping.order'),
        get('credential.helper'),
        get('submodule.recurse', 'false'), get('submodule.active',''),
        get('feature.manyFiles'), get('core.fsmonitor'), get('fetch.writeCommitGraph'),
      ]);
      setUserName(n); setUserEmail(e);
      setPullRebase(pr === 'true' || pr === 'input' ? pr : 'false');
      setFetchPrune(fp);
      setFetchRecurseSubmodules(frs);
      setPushSubmodules(prs);
      setSignCommits(sc); setSigningKey(sk); setGpgProgram(gp);
      setEncoding(enc);
      setTagGroupPattern(tgp); setTagGroupSinglePattern(tgp2); setTagGroupOrder(tgo);
      setCredentialHelper(ch);
      setSubmoduleUpdate(su === 'true'); setSubmoduleInit(si);
      setRepoManyFiles(mf); setRepoFsmonitor(fsm); setRepoCommitGraph(wcg);
    } catch (e) {
      toast.error(t('toast.repo.settingsLoadFailed'), String(e));
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
    const setOrUnset = async (k: string, v: string) => {
      if (v.trim()) await api.git.configSet(p, k, v.trim());
      else await api.git.configUnset(p, k).catch(() => {});
    };
    const set = (k: string, v: string) => api.git.configSet(p, k, v);
    try {
      await setOrUnset('user.name', userName);
      await setOrUnset('user.email', userEmail);
      await set('pull.rebase', pullRebase);
      await set('fetch.prune', fetchPrune);
      await set('fetch.recurseSubmodules', fetchRecurseSubmodules);
      await set('push.recurseSubmodules', pushSubmodules);
      await set('commit.gpgsign', signCommits);
      await setOrUnset('user.signingkey', signingKey);
      await setOrUnset('gpg.program', gpgProgram);
      await set('gui.encoding', encoding);
      if (tagGroupPattern.trim()) {
        await set('smartgit.tag-grouping.pattern', tagGroupPattern.trim());
        await set('smartgit.tag-grouping.order', tagGroupOrder.trim() || 'ascending');
        if (tagGroupSinglePattern.trim()) {
          await set('smartgit.tag-grouping.single', tagGroupSinglePattern.trim());
        } else {
          await api.git.configUnset(p, 'smartgit.tag-grouping.single').catch(() => {});
        }
      } else {
        await api.git.configUnset(p, 'smartgit.tag-grouping.pattern').catch(() => {});
        await api.git.configUnset(p, 'smartgit.tag-grouping.single').catch(() => {});
        await api.git.configUnset(p, 'smartgit.tag-grouping.order').catch(() => {});
      }
      // Credential Helper
      await setOrUnset('credential.helper', credentialHelper);
      // Submodule update/init
      await set('submodule.recurse', String(submoduleUpdate));
      if (submoduleInit.trim()) {
        await setOrUnset('submodule.active', submoduleInit);
      } else {
        await api.git.configUnset(p, 'submodule.active').catch(() => {});
      }
      // Performance — per-repo overrides (local scope)
      await setOrUnset('feature.manyFiles', repoManyFiles);
      await setOrUnset('core.fsmonitor', repoFsmonitor);
      await setOrUnset('fetch.writeCommitGraph', repoCommitGraph);
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
      <div className="panel w-full max-w-xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
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
          <div className="flex-1 text-2xs text-text-tertiary font-mono flex flex-col justify-center gap-0.5">
            <span>Repo config: {repo.path}/.git/config</span>
            <span>Global config: ~/.gitconfig</span>
          </div>
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
