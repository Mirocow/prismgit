import { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, Github, LogOut, Sun, Moon, Folder, Plus, RefreshCw, Trash, Loader } from '../components/icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api, type GitConfigEntry } from '../lib/api';
import { cn } from '../lib/utils';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';

export function SettingsPage() {
  const { settings, theme, setSetting, toggleTheme } = useSettingsStore();
  const { user, authenticated, loginWithPAT, logout, loadAuthState } = useAuthStore();
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastStore();
  const { repos, removeRepo, loadRepos } = useRepositoryStore();
  const [pat, setPat] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);

  // === Git Config section state ===
  const [configScope, setConfigScope] = useState<'local' | 'global' | 'system'>('local');
  const [configEntries, setConfigEntries] = useState<GitConfigEntry[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configFilter, setConfigFilter] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');


  const loadConfig = useCallback(async () => {
    if (!currentRepo) return;
    setConfigLoading(true);
    try {
      const entries = await api.git.configList(currentRepo.path, configScope);
      setConfigEntries(entries);
    } catch (e) {
      toast.error('Failed to load git config', String(e));
      setConfigEntries([]);
    } finally {
      setConfigLoading(false);
    }
  }, [currentRepo, configScope, toast]);

  useEffect(() => {
    if (currentRepo) loadConfig();
  }, [currentRepo, loadConfig]);

  const handleConfigSet = async (key: string, value: string) => {
    if (!currentRepo) return;
    try {
      await api.git.configSet(currentRepo.path, key, value, configScope);
      toast.success(`Set ${key} (${configScope})`);
      await loadConfig();
    } catch (e) {
      toast.error('Failed to set value', String(e));
    }
  };

  const handleConfigUnset = async (key: string) => {
    if (!currentRepo) return;
    if (!(await confirmDialog({
      title: 'Remove config entry',
      message: `Remove '${key}' from ${configScope} config?`,
      confirmLabel: 'Remove',
      danger: true,
    }))) return;
    try {
      await api.git.configUnset(currentRepo.path, key, configScope);
      toast.success(`Removed ${key}`);
      await loadConfig();
    } catch (e) {
      toast.error('Failed to unset', String(e));
    }
  };

  const handleLogin = async () => {
    if (!pat.trim()) {
      toast.warning('Please enter a PAT');
      return;
    }
    setLoadingAuth(true);
    try {
      const u = await loginWithPAT(pat);
      toast.success(`Welcome, ${u.login}!`);
      setPat('');
    } catch (e) {
      toast.error('Authentication failed', String(e));
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    toast.info('Logged out from GitHub');
  };

  const handleChooseCloneDir = async () => {
    const path = await api.fs.openDirectoryPicker();
    if (path) {
      await setSetting('defaultCloneDir', path);
      toast.success('Default clone directory updated');
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-y-auto bg-bg-primary">
      <div className="max-w-3xl mx-auto p-6 w-full">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border-default">
          <div className="w-10 h-10 rounded-lg bg-accent-muted flex items-center justify-center">
            <SettingsIcon size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary tracking-tight">Settings</h1>
            <p className="text-xs text-text-tertiary">Configure appearance, Git, and integrations</p>
          </div>
        </div>

        {/* Appearance */}
        <section className="panel mb-4">
          <div className="panel-header">Appearance</div>
          <div className="p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Theme</div>
                <div className="text-xs text-text-tertiary">
                  Switch between dark and light appearance
                </div>
              </div>
              <button
                className="btn btn-secondary"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                {theme === 'dark' ? 'Light' : 'Dark'}
              </button>
            </div>
            {/* UI Contrast slider — applies CSS `filter: contrast(N%)` on #root */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-medium">UI Contrast</div>
                  <div className="text-xs text-text-tertiary">
                    Softer ↔ punchier. Applied as a live CSS contrast filter on the whole app.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-tertiary font-mono w-10 text-right">
                    {settings.contrast ?? 100}%
                  </span>
                  <button
                    className="text-2xs text-accent hover:underline"
                    onClick={() => setSetting('contrast', 100)}
                    title="Reset to default (100%)"
                  >
                    Reset
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 px-1">
                <span className="text-2xs text-text-tertiary w-8">Soft</span>
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={5}
                  value={settings.contrast ?? 100}
                  onChange={(e) => setSetting('contrast', Number(e.target.value))}
                  className="flex-1"
                  style={{ accentColor: 'var(--accent)' }}
                  title="Drag left for softer appearance, right for punchier colors"
                />
                <span className="text-2xs text-text-tertiary w-12">Punchy</span>
              </div>
              {/* Quick presets */}
              <div className="flex items-center gap-1 mt-2">
                <span className="text-2xs text-text-tertiary mr-1">Presets:</span>
                {[
                  { label: 'Soft', value: 75 },
                  { label: 'Normal', value: 100 },
                  { label: 'High', value: 125 },
                  { label: 'Max', value: 150 },
                ].map(p => (
                  <button
                    key={p.value}
                    className={cn(
                      'text-2xs px-2 py-0.5 rounded border transition-colors',
                      (settings.contrast ?? 100) === p.value
                        ? 'bg-accent text-text-inverse border-accent'
                        : 'bg-bg-tertiary text-text-secondary border-border-default hover:bg-bg-hover'
                    )}
                    onClick={() => setSetting('contrast', p.value)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Font size (base)</div>
                <div className="text-xs text-text-tertiary">Global base font size in pixels</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={20}
                  value={settings.fontSize ?? 14}
                  onChange={(e) => setSetting('fontSize', Number(e.target.value))}
                  className="w-20 text-sm"
                />
                <span className="text-xs text-text-tertiary">px</span>
              </div>
            </div>
            {/* Per-area font sizes */}
            <div className="border-t border-border-subtle pt-4 mt-4">
              <div className="text-2xs uppercase text-text-tertiary mb-3 font-bold tracking-wider">Per-area font sizes</div>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center justify-between gap-2 p-2 rounded hover:bg-bg-hover transition-colors">
                  <span className="text-xs">File tree</span>
                  <input type="number" min={8} max={20} value={settings.fontSizeTree ?? 12}
                    onChange={(e) => setSetting('fontSizeTree', Number(e.target.value))} className="w-16 text-xs" />
                </label>
                <label className="flex items-center justify-between gap-2 p-2 rounded hover:bg-bg-hover transition-colors">
                  <span className="text-xs">Commit/branch lists</span>
                  <input type="number" min={8} max={20} value={settings.fontSizeList ?? 12}
                    onChange={(e) => setSetting('fontSizeList', Number(e.target.value))} className="w-16 text-xs" />
                </label>
                <label className="flex items-center justify-between gap-2 p-2 rounded hover:bg-bg-hover transition-colors">
                  <span className="text-xs">Diff viewer (code)</span>
                  <input type="number" min={8} max={20} value={settings.fontSizeDiff ?? 11}
                    onChange={(e) => setSetting('fontSizeDiff', Number(e.target.value))} className="w-16 text-xs" />
                </label>
                <label className="flex items-center justify-between gap-2 p-2 rounded hover:bg-bg-hover transition-colors">
                  <span className="text-xs">Monospace (hashes/paths)</span>
                  <input type="number" min={8} max={20} value={settings.fontSizeMonospace ?? 11}
                    onChange={(e) => setSetting('fontSizeMonospace', Number(e.target.value))} className="w-16 text-xs" />
                </label>
              </div>
              <div className="text-2xs text-text-tertiary mt-2 px-2">These apply to the respective UI areas immediately.</div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Sidebar width</div>
                <div className="text-xs text-text-tertiary">Width in pixels</div>
              </div>
              <input
                type="number"
                min={200}
                max={500}
                value={settings.sidebarWidth ?? 280}
                onChange={(e) => setSetting('sidebarWidth', Number(e.target.value))}
                className="w-20 text-sm"
              />
            </div>
          </div>
        </section>

        {/* Git */}
        <section className="panel mb-4">
          <div className="panel-header">Git</div>
          <div className="p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Default clone directory</div>
                <div className="text-xs text-text-tertiary">
                  Where new repositories will be cloned to
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono px-2 py-1 bg-bg-tertiary rounded max-w-xs truncate">
                  {settings.defaultCloneDir || '(not set)'}
                </code>
                <button className="btn btn-secondary text-xs" onClick={handleChooseCloneDir}>
                  <Folder size={12} />
                  Browse
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Max history entries</div>
                <div className="text-xs text-text-tertiary">
                  Maximum commits to load in history view
                </div>
              </div>
              <input
                type="number"
                min={100}
                max={5000}
                step={100}
                value={settings.maxHistoryLoad ?? 500}
                onChange={(e) => setSetting('maxHistoryLoad', Number(e.target.value))}
                className="w-24 text-sm"
              />
            </div>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <div className="text-sm font-medium">Show reflog in history</div>
                <div className="text-xs text-text-tertiary">
                  Include reflog entries in the history view
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.showReflogInHistory ?? false}
                onChange={(e) => setSetting('showReflogInHistory', e.target.checked)}
              />
            </label>
          </div>
        </section>

        {/* GitHub Integration */}
        <section className="panel mb-4">
          <div className="panel-header">
            <span className="flex items-center gap-2">
              <Github size={12} />
              GitHub Integration
            </span>
          </div>
          <div className="p-5 space-y-4">
            {authenticated && user ? (
              <div className="flex items-center gap-3 p-3 bg-bg-tertiary rounded">
                <img
                  src={user.avatar_url}
                  alt={user.login}
                  className="w-10 h-10 rounded-full"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium">{user.name || user.login}</div>
                  <div className="text-xs text-text-tertiary">@{user.login}</div>
                </div>
                <button className="btn btn-danger text-xs" onClick={handleLogout}>
                  <LogOut size={12} />
                  Logout
                </button>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-sm mb-2">
                    Authenticate with a Personal Access Token
                  </div>
                  <div className="text-xs text-text-tertiary mb-3">
                    Create a token at{' '}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        api.app.openExternal('https://github.com/settings/tokens/new?scopes=repo,read:user&description=PrismGit');
                      }}
                      className="text-accent hover:underline"
                    >
                      github.com/settings/tokens
                    </a>{' '}
                    with <code className="font-mono">repo</code> and{' '}
                    <code className="font-mono">read:user</code> scopes.
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      className="flex-1 text-sm font-mono"
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxx"
                      value={pat}
                      onChange={(e) => setPat(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                    />
                    <button
                      className="btn btn-primary text-xs"
                      onClick={handleLogin}
                      disabled={loadingAuth}
                    >
                      {loadingAuth ? <RefreshCw size={12} className="animate-spin" /> : <Github size={12} />}
                      Connect
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Repositories */}
        <section className="panel mb-4">
          <div className="panel-header">
            <span>Known Repositories ({repos.length})</span>
            <button
              className="icon-btn !w-6 !h-6"
              title="Refresh"
              onClick={() => loadRepos()}
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="p-2">
            {repos.length === 0 ? (
              <div className="p-6 text-center text-sm text-text-tertiary">
                <Folder size={24} className="mx-auto mb-2 opacity-40" />
                No repositories added yet.
              </div>
            ) : (
              repos.map((r) => (
                <div
                  key={r.path}
                  className="group flex items-center gap-3 px-3 py-2 hover:bg-bg-hover rounded-md transition-colors"
                >
                  <div className="w-7 h-7 rounded-md bg-bg-tertiary border border-border-default flex items-center justify-center flex-shrink-0">
                    <Folder size={13} className="text-text-tertiary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{r.name}</div>
                    <div className="text-xs text-text-tertiary font-mono truncate">
                      {r.path}
                    </div>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-100 icon-btn !w-6 !h-6 hover:!text-status-deleted transition-opacity"
                    title="Remove"
                    onClick={() => removeRepo(r.path)}
                  >
                    <Plus size={12} className="rotate-45" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* External Tools */}
        <section className="panel mb-4">
          <div className="panel-header">External Tools</div>
          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs text-text-tertiary block mb-1">Diff tool command</label>
              <input
                type="text"
                className="w-full text-sm mono"
                placeholder="meld $LOCAL $REMOTE"
                defaultValue=""
                onBlur={async (e) => {
                  if (currentRepo) {
                    try {
                      await api.git.configSet(currentRepo.path, 'diff.tool', e.target.value);
                      toast.success('Diff tool saved');
                    } catch { /* ignore */ }
                  }
                }}
              />
              <div className="text-2xs text-text-tertiary mt-1">
                Use <code className="mono">$LOCAL</code> and <code className="mono">$REMOTE</code> variables.
                Leave empty to use built-in diff viewer.
              </div>
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">Merge tool command</label>
              <input
                type="text"
                className="w-full text-sm mono"
                placeholder="meld $LOCAL $BASE $REMOTE --output=$MERGED"
                defaultValue=""
                onBlur={async (e) => {
                  if (currentRepo) {
                    try {
                      await api.git.configSet(currentRepo.path, 'merge.tool', e.target.value);
                      toast.success('Merge tool saved');
                    } catch { /* ignore */ }
                  }
                }}
              />
              <div className="text-2xs text-text-tertiary mt-1">
                Variables: <code className="mono">$LOCAL $BASE $REMOTE $MERGED</code>
              </div>
            </div>
          </div>
        </section>

        {/* Pull Strategy */}
        <section className="panel mb-4">
          <div className="panel-header">Pull Strategy</div>
          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs text-text-tertiary block mb-2">When pulling from remote:</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="pullStrategy"
                    value="merge"
                    checked={(settings.pullStrategy ?? 'merge') === 'merge'}
                    onChange={() => setSetting('pullStrategy', 'merge')}
                  />
                  <div>
                    <div className="font-medium">Merge (default)</div>
                    <div className="text-2xs text-text-tertiary">Creates a merge commit when local and remote have diverged</div>
                  </div>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="pullStrategy"
                    value="rebase"
                    checked={settings.pullStrategy === 'rebase'}
                    onChange={() => setSetting('pullStrategy', 'rebase')}
                  />
                  <div>
                    <div className="font-medium">Rebase</div>
                    <div className="text-2xs text-text-tertiary">Replays local commits on top of remote, linear history</div>
                  </div>
                </label>
              </div>
            </div>
            <div className="text-2xs text-text-tertiary">
              This setting applies to the quick Pull button and the Pull dropdown. The dropdown also has per-pull checkboxes for manual override.
            </div>
          </div>
        </section>

        {/* Git Config */}
        {currentRepo && (
          <section className="panel mb-4">
            <div className="panel-header flex items-center justify-between">
              <span>Git Config — {currentRepo.name}</span>
              <div className="flex items-center gap-1">
                {(['local', 'global', 'system'] as const).map((s) => (
                  <button
                    key={s}
                    className={cn(
                      'px-2 py-0.5 text-2xs rounded capitalize transition-colors',
                      configScope === s
                        ? 'bg-accent text-text-inverse'
                        : 'text-text-secondary hover:bg-bg-hover'
                    )}
                    onClick={() => setConfigScope(s)}
                  >
                    {s}
                  </button>
                ))}
                <button className="icon-btn !w-5 !h-5 ml-1" title="Reload config" onClick={loadConfig}>
                  {configLoading ? <Loader size={11} className="spin" /> : <RefreshCw size={11} />}
                </button>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <input
                type="text"
                className="w-full text-xs"
                placeholder="Filter keys..."
                value={configFilter}
                onChange={(e) => setConfigFilter(e.target.value)}
              />
              <div className="max-h-72 overflow-y-auto border border-border-default rounded">
                {configEntries.length === 0 ? (
                  <div className="p-4 text-xs text-text-tertiary text-center">
                    No {configScope} config entries
                  </div>
                ) : (
                  configEntries
                    .filter((e) => !configFilter || e.key.toLowerCase().includes(configFilter.toLowerCase()))
                    .map((entry, i) => (
                      <div key={`${entry.key}-${i}`} className="group flex items-center gap-2 px-3 py-1.5 border-b border-border-subtle last:border-b-0 text-xs">
                        <code className="font-mono text-text-secondary flex-shrink-0 w-56 truncate" title={entry.key}>
                          {entry.key}
                        </code>
                        {editingKey === `${entry.key}-${i}` ? (
                          <>
                            <input
                              type="text"
                              className="flex-1 font-mono"
                              autoFocus
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleConfigSet(entry.key, editingValue);
                                  setEditingKey(null);
                                }
                                if (e.key === 'Escape') setEditingKey(null);
                              }}
                            />
                            <button
                              className="icon-btn !w-5 !h-5 hover:!text-status-added"
                              title="Save (Enter)"
                              onClick={() => { handleConfigSet(entry.key, editingValue); setEditingKey(null); }}
                            >
                              ✓
                            </button>
                          </>
                        ) : (
                          <>
                            <code
                              className="flex-1 font-mono text-text-primary truncate cursor-pointer hover:text-accent"
                              title="Click to edit value"
                              onClick={() => { setEditingKey(`${entry.key}-${i}`); setEditingValue(entry.value); }}
                            >
                              {entry.value || <span className="text-text-tertiary italic">(empty)</span>}
                            </code>
                            <button
                              className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100 hover:!text-status-deleted"
                              title="Remove key (git config --unset)"
                              onClick={() => handleConfigUnset(entry.key)}
                            >
                              <Trash size={10} />
                            </button>
                          </>
                        )}
                      </div>
                    ))
                )}
              </div>
              {/* Add new key */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  className="flex-1 font-mono text-xs"
                  placeholder="new.key (e.g. user.name)"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                />
                <input
                  type="text"
                  className="flex-1 font-mono text-xs"
                  placeholder="value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
                <button
                  className="btn btn-secondary text-xs"
                  disabled={!newKey.trim() || !newValue.trim()}
                  onClick={async () => {
                    await handleConfigSet(newKey.trim(), newValue.trim());
                    setNewKey(''); setNewValue('');
                  }}
                >
                  <Plus size={11} />
                  Add
                </button>
              </div>
              <div className="text-2xs text-text-tertiary">
                Click a value to edit it. Changes apply to the <b>{configScope}</b> scope
                {configScope === 'local' ? ' (this repository only)' : configScope === 'global' ? ' (your user account)' : ' (whole machine)'}.
              </div>
            </div>
          </section>
        )}

        {/* SmartGit Manual: Preferences → Commands */}
        <section className="panel mb-4">
          <div className="panel-header">Commands</div>
          <div className="p-5 space-y-3 text-sm">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.allowModifyingPushedCommits ?? false}
                onChange={(e) => setSetting('allowModifyingPushedCommits', e.target.checked)}
              />
              <div className="flex-1">
                <div>Allow modifying pushed commits (e.g. forced-push)</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  When enabled, the amend / squash / rebase confirmation for pushed commits becomes a warning instead of a hard block.
                </div>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.detectRenames ?? true}
                onChange={(e) => setSetting('detectRenames', e.target.checked)}
              />
              <div className="flex-1">
                <div>Detect renames in refresh</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  Pair added + deleted files as renames (git diff --find-renames=50%).
                </div>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.distinguishEolChanges ?? false}
                onChange={(e) => setSetting('distinguishEolChanges', e.target.checked)}
              />
              <div className="flex-1">
                <div>Distinguish between content and EOL-only changes</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  Marks files whose only changes are line-ending differences (CRLF ↔ LF).
                </div>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoStashOnCommonCommands ?? false}
                onChange={(e) => setSetting('autoStashOnCommonCommands', e.target.checked)}
              />
              <div className="flex-1">
                <div>Auto-stash on common commands</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  Stash local changes before merge/rebase/pull, then pop after.
                </div>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.includeUntrackedInStash ?? false}
                onChange={(e) => setSetting('includeUntrackedInStash', e.target.checked)}
              />
              <div className="flex-1">
                <div>Include untracked files in stash</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  Passes -u to git stash push — also stashes untracked files.
                </div>
              </div>
            </label>
          </div>
        </section>

        {/* SmartGit Manual: External Tools system */}
        <section className="panel mb-4">
          <div className="panel-header">External Tools</div>
          <div className="p-5 text-sm space-y-3">
            <div className="text-2xs text-text-tertiary">
              Configure external tools for opening files, comparing, and conflict solving.
              Variables: <code className="mono text-accent">{`{filePath}`}</code>,{' '}
              <code className="mono text-accent">{`{repositoryRootPath}`}</code>,{' '}
              <code className="mono text-accent">{`{commit}`}</code>,{' '}
              <code className="mono text-accent">{`{leftFile}`}</code>,{' '}
              <code className="mono text-accent">{`{rightFile}`}</code>,{' '}
              <code className="mono text-accent">{`{baseFile}`}</code>.
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 text-xs font-mono"
                placeholder="diff.tool name (e.g., vscode-diff)"
                defaultValue={settings.diffTool || ''}
                onBlur={(e) => setSetting('diffTool', e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                className="flex-1 text-xs font-mono"
                placeholder="merge.tool name (e.g., vscode-merge)"
                defaultValue={settings.mergeTool || ''}
                onBlur={(e) => setSetting('mergeTool', e.target.value)}
              />
            </div>
            <div className="text-2xs text-text-tertiary">
              These write to git config <code>diff.tool</code> and <code>merge.tool</code>.
              The actual tool command should be defined in <code>[difftool "..."]</code> /{' '}
              <code>[mergetool "..."]</code> sections.
            </div>
          </div>
        </section>

        {/* SmartGit Manual: Low-Level Properties editor */}
        <section className="panel mb-4">
          <div className="panel-header">Low-Level Properties</div>
          <div className="p-5 text-sm space-y-3">
            <div className="text-2xs text-text-tertiary">
              Advanced settings stored in <code>smartgit.properties</code>.
              Changes apply on next restart.
            </div>
            <textarea
              className="w-full font-mono text-xs h-32 resize-y p-2 border border-border-default rounded bg-bg-tertiary"
              placeholder={`# SmartGit-compatible properties (key=value)
# Examples:
# changes.maximumFileSize=1048576
# log.graph.overlap.enabled=true
# log.file.followCopies=true
# smartgit.refresh.inspectEol=true`}
              defaultValue={settings.lowLevelProperties || ''}
              onBlur={(e) => setSetting('lowLevelProperties', e.target.value)}
            />
            <div className="flex gap-2">
              <button
                className="btn btn-secondary text-xs"
                onClick={() => {
                  setSetting('lowLevelProperties', `# Default properties
changes.maximumFileSize=1048576
log.graph.overlap.enabled=true
log.file.followCopies=true
smartgit.refresh.inspectEol=true
`);
                }}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </section>

        {/* SmartGit Manual: AI Commit Messages (v25+) */}
        <section className="panel mb-4">
          <div className="panel-header">AI Commit Messages</div>
          <div className="p-5 text-sm space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.aiCommitMessagesEnabled ?? false}
                onChange={(e) => setSetting('aiCommitMessagesEnabled', e.target.checked)}
              />
              <div className="flex-1">
                <div>Enable AI integration</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  Use <code className="mono">@ai</code> in commit message to generate, or <code className="mono">WIP</code> for "WIP: &lt;ai message&gt;".
                </div>
              </div>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Provider</label>
                <select
                  className="w-full text-sm"
                  value={settings.aiProvider || ''}
                  onChange={(e) => setSetting('aiProvider', e.target.value)}
                >
                  <option value="">— Disabled —</option>
                  <option value="openai">OpenAI (gpt-4o-mini)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="github">GitHub Models</option>
                  <option value="mistral">Mistral</option>
                  <option value="ollama">Ollama (local)</option>
                  <option value="custom">Custom (OpenAI-compatible)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Model</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="gpt-4o-mini"
                  defaultValue={settings.aiModel || ''}
                  onBlur={(e) => setSetting('aiModel', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">API URL</label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="https://api.openai.com/v1/chat/completions (default for OpenAI)"
                  defaultValue={settings.aiUrl || ''}
                  onBlur={(e) => setSetting('aiUrl', e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">API Key</label>
                <input
                  type="password"
                  className="w-full text-sm font-mono"
                  placeholder="sk-..."
                  defaultValue={settings.aiApiKey || ''}
                  onBlur={(e) => setSetting('aiApiKey', e.target.value)}
                />
              </div>
            </div>
            <div className="text-2xs text-text-tertiary">
              For Ollama (local LLM), leave API Key empty and set URL to <code>http://localhost:11434</code>.
              The model must already be pulled (<code className="mono">ollama pull llama3.2</code>).
            </div>
          </div>
        </section>

        {/* About */}
        <section className="panel mb-4">
          <div className="panel-header">About</div>
          <div className="p-5 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-text-tertiary">Version</span>
              <span className="font-mono">2.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">Platform</span>
              <span className="font-mono">{navigator.platform}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">Electron</span>
              <span className="font-mono">v32</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
