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
        <h1 className="text-xl font-semibold mb-6 flex items-center gap-2">
          <SettingsIcon size={20} />
          Settings
        </h1>

        {/* Appearance */}
        <section className="panel mb-4">
          <div className="panel-header">Appearance</div>
          <div className="p-4 space-y-4">
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
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Font size</div>
                <div className="text-xs text-text-tertiary">Base font size in pixels</div>
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
          <div className="p-4 space-y-4">
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
          <div className="p-4 space-y-4">
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
              <div className="p-4 text-center text-sm text-text-tertiary">
                No repositories added yet.
              </div>
            ) : (
              repos.map((r) => (
                <div
                  key={r.path}
                  className="group flex items-center gap-3 px-2 py-2 hover:bg-bg-hover rounded"
                >
                  <Folder size={14} className="text-text-tertiary" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm">{r.name}</div>
                    <div className="text-xs text-text-tertiary font-mono truncate">
                      {r.path}
                    </div>
                  </div>
                  <button
                    className="opacity-0 group-hover:opacity-100 icon-btn !w-6 !h-6 hover:!text-status-deleted"
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

        {/* About */}
        <section className="panel mb-4">
          <div className="panel-header">About</div>
          <div className="p-4 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-text-tertiary">Version</span>
              <span className="font-mono">1.0.0</span>
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
