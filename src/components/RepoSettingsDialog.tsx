import { useState, useEffect, useCallback } from 'react';
import { X, Loader, Settings as SettingsIcon } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

/**
 * SmartGit "Repository | Settings": per-repository configuration stored in
 * <repo>/.git/config — User, Fetch and Pull, Push, Signing, Encoding,
 * Tag-Grouping (the same tabs as SmartGit's Repository Settings dialog).
 */

const TABS = ['User', 'Fetch and Pull', 'Push', 'Signing', 'Encoding', 'Tag-Grouping'] as const;
type Tab = (typeof TABS)[number];

export function RepoSettingsDialog({ onClose, remoteName }: { onClose: () => void; remoteName?: string }) {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const toast = useToastActions();
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
  const [gpgProgram, setGpgProgram] = useState('gpg');
  const [encoding, setEncoding] = useState('UTF-8');
  const [tagGroupPattern, setTagGroupPattern] = useState('');
  const [tagGroupOrder, setTagGroupOrder] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    const p = repo.path;
    const get = (k: string, def = '') => api.git.configGet(p, k).then((v) => v ?? def).catch(() => def);
    try {
      const [n, e, pr, fp, frs, prs, sc, sk, gp, enc, tgp, tgo] = await Promise.all([
        get('user.name'), get('user.email'),
        get('pull.rebase', 'false'), get('fetch.prune', 'false'),
        get('fetch.recurseSubmodules', 'on-demand'),
        get('push.recurseSubmodules', 'check'),
        get('commit.gpgsign', 'false'), get('user.signingkey'), get('gpg.program', 'gpg'),
        get('gui.encoding', 'UTF-8'),
        get('smartgit.tag-grouping.pattern'), get('smartgit.tag-grouping.order'),
      ]);
      setUserName(n); setUserEmail(e);
      setPullRebase(pr === 'true' || pr === 'input' ? pr : 'false');
      setFetchPrune(fp);
      setFetchRecurseSubmodules(frs);
      setPushSubmodules(prs);
      setSignCommits(sc); setSigningKey(sk); setGpgProgram(gp);
      setEncoding(enc);
      setTagGroupPattern(tgp); setTagGroupOrder(tgo);
    } catch (e) {
      toast.error('Failed to load repository settings', String(e));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    const p = repo.path;
    try {
      const set = (k: string, v: string) => api.git.configSet(p, k, v);
      await set('user.name', userName);
      await set('user.email', userEmail);
      await set('pull.rebase', pullRebase);
      await set('fetch.prune', fetchPrune);
      await set('fetch.recurseSubmodules', fetchRecurseSubmodules);
      await set('push.recurseSubmodules', pushSubmodules);
      await set('commit.gpgsign', signCommits);
      if (signingKey.trim()) await set('user.signingkey', signingKey.trim());
      await set('gpg.program', gpgProgram);
      await set('gui.encoding', encoding);
      if (tagGroupPattern.trim()) {
        await set('smartgit.tag-grouping.pattern', tagGroupPattern.trim());
        await set('smartgit.tag-grouping.order', tagGroupOrder.trim() || 'ascending');
      } else {
        await api.git.configUnset(p, 'smartgit.tag-grouping.pattern').catch(() => {});
        await api.git.configUnset(p, 'smartgit.tag-grouping.order').catch(() => {});
      }
      toast.success('Repository settings saved');
      onClose();
    } catch (e) {
      toast.error('Failed to save settings', String(e));
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
          <span className="text-sm font-semibold">Repository Settings</span>
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
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-2 text-xs whitespace-nowrap border-b-2 -mb-px',
                tab === t ? 'border-accent text-accent font-medium' : 'border-transparent text-text-secondary hover:text-text-primary'
              )}
            >
              {t}
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
                <input value={userName} onChange={(e) => setUserName(e.target.value)} className={inputCls} placeholder="Your Name" />
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
                  <option value="false">Merge remote changes into local branch</option>
                  <option value="true">Rebase local commits onto fetched changes</option>
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
                  <option value="false">Do not recurse</option>
                  <option value="on-demand">Fetch new commits in registered submodules (on-demand)</option>
                  <option value="true">Always recurse</option>
                </select>
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
                <input value={gpgProgram} onChange={(e) => setGpgProgram(e.target.value)} className={inputCls} placeholder="gpg" />
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
              <label className="flex flex-col gap-1 text-text-secondary">Sort order
                <select value={tagGroupOrder} onChange={(e) => setTagGroupOrder(e.target.value)} className={selectCls}>
                  <option value="ascending">Ascending</option>
                  <option value="descending">Descending</option>
                </select>
              </label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button className="px-3 py-1.5 text-xs rounded border border-border hover:bg-surface-hover" onClick={onClose}>Cancel</button>
          <button
            className="px-3 py-1.5 text-xs font-medium bg-accent text-accent-foreground rounded hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
            onClick={save}
            disabled={saving || busy}
          >
            {saving && <Loader size={12} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
