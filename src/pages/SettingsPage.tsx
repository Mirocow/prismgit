import { useState } from 'react';
import { Settings as SettingsIcon, Github, LogOut, Sun, Moon, Folder, Plus, RefreshCw } from '../components/icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useAuthStore } from '../stores/authStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

export function SettingsPage() {
  const { settings, theme, setSetting, toggleTheme } = useSettingsStore();
  const { user, authenticated, loginWithPAT, logout, loadAuthState } = useAuthStore();
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastStore();
  const { repos, removeRepo, loadRepos } = useRepositoryStore();
  const [pat, setPat] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);

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
                        api.app.openExternal('https://github.com/settings/tokens/new?scopes=repo,read:user&description=SmartGit%20Electron');
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
