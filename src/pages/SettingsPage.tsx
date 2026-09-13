import { useCallback, useEffect, useState } from 'react';
import { confirmDialog } from '../components/ConfirmDialog';
import { Folder, Github, Loader, LogOut, Moon, Palette, Plus, RefreshCw, Settings as SettingsIcon, Sparkles, Sun, Trash } from '../components/icons';
import { OllamaModelPicker } from '../components/OllamaModelPicker';
import { api, type GitConfigEntry } from '../lib/api';
import { PROVIDER_PRESETS, getProviderPreset } from '../lib/aiCommitMessages';
import { LOCALES, useI18n } from '../lib/i18n';
import { getThemeMeta, THEMES } from '../lib/themes';
import { cn } from '../lib/utils';
import { useAuthStore } from '../stores/authStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';

export function SettingsPage() {
  const { settings, theme, setSetting, toggleTheme, setTheme } = useSettingsStore();
  const { user, authenticated, loginWithPAT, logout, loadAuthState } = useAuthStore();
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const toast = useToastActions();
  const { repos, removeRepo, loadRepos } = useRepositoryStore();
  const { t, locale, setLocale } = useI18n();
  const [pat, setPat] = useState('');
  const [loadingAuth, setLoadingAuth] = useState(false);
  // Top-level tab: Application Settings vs Project Settings vs Themes
  const [activeTab, setActiveTab] = useState<'application' | 'project' | 'themes' | 'ai' | 'show-integrations'>('application');
  const showApp = activeTab === 'application';
  const showProject = activeTab === 'project' && !!currentRepo;
  const showThemes = activeTab === 'themes';
  const showAi = activeTab === 'ai';
  const showIntegrations = activeTab === 'show-integrations';

  // === Git Config section state ===
  const [configScope, setConfigScope] = useState<'local' | 'global' | 'system'>('local');
  const [configEntries, setConfigEntries] = useState<GitConfigEntry[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configFilter, setConfigFilter] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // === Visual Studio Code integration state ===
  const [vscodeDet, setVscodeDet] = useState<{ available: boolean; path: string; version: string } | null>(null);
  const [vscodeChecking, setVscodeChecking] = useState(false);
  const [vscodeTool, setVscodeTool] = useState<{ diffTool: string; mergeTool: string; vscodeConfigured: boolean } | null>(null);
  const [vscodePathInput, setVscodePathInput] = useState('');


  const loadConfig = useCallback(async () => {
    if (!currentRepo) return;
    setConfigLoading(true);
    try {
      const entries = await api.git.configList(currentRepo.path, configScope);
      setConfigEntries(entries);
    } catch (e) {
      toast.error(t('settings.failedToLoadGitConfig'), String(e));
      setConfigEntries([]);
    } finally {
      setConfigLoading(false);
    }
  }, [currentRepo, configScope, toast]);

  useEffect(() => {
    if (currentRepo) loadConfig();
  }, [currentRepo, loadConfig]);

  // VS Code detection + per-repo difftool status (refreshed on repo change)
  const detectVsCodeCli = useCallback(async (force = false) => {
    setVscodeChecking(true);
    try {
      const det = await api.vscode.detect(force);
      setVscodeDet(det);
    } catch {
      setVscodeDet({ available: false, path: '', version: '' });
    } finally {
      setVscodeChecking(false);
    }
  }, []);

  useEffect(() => {
    detectVsCodeCli();
  }, [detectVsCodeCli]);

  useEffect(() => {
    setVscodeTool(null);
    if (!currentRepo) return;
    let cancelled = false;
    api.vscode.diffToolStatus(currentRepo.path).then((st) => {
      if (!cancelled) setVscodeTool(st);
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [currentRepo]);

  const handleConfigSet = async (key: string, value: string) => {
    if (!currentRepo) return;
    try {
      await api.git.configSet(currentRepo.path, key, value, configScope);
      toast.success(t('settings.configSetToast', { key, scope: configScope }));
      await loadConfig();
    } catch (e) {
      toast.error(t('settings.failedToSetValue'), String(e));
    }
  };

  const handleConfigUnset = async (key: string) => {
    if (!currentRepo) return;
    if (!(await confirmDialog({
      title: t('settings.removeConfigEntryTitle'),
      message: t('settings.removeConfigConfirm', { key, scope: configScope }),
      confirmLabel: t('common.remove'),
      danger: true,
    }))) return;
    try {
      await api.git.configUnset(currentRepo.path, key, configScope);
      toast.success(t('settings.configRemovedToast', { key }));
      await loadConfig();
    } catch (e) {
      toast.error(t('settings.failedToUnset'), String(e));
    }
  };

  const handleLogin = async () => {
    if (!pat.trim()) {
      toast.warning(t('settings.pleaseEnterPat'));
      return;
    }
    setLoadingAuth(true);
    try {
      const u = await loginWithPAT(pat);
      toast.success(t('settings.welcomeGithubUser', { login: u.login }));
      setPat('');
    } catch (e) {
      toast.error(t('settings.authFailed'), String(e));
    } finally {
      setLoadingAuth(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    toast.info(t('settings.loggedOutGithub'));
  };

  const handleChooseCloneDir = async () => {
    const path = await api.fs.openDirectoryPicker();
    if (path) {
      await setSetting('defaultCloneDir', path);
      toast.success(t('settings.cloneDirUpdated'));
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-y-auto bg-bg-primary">
      <div className="max-w-3xl mx-auto p-6 w-full">
        <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b border-border-default">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-muted flex items-center justify-center">
              <SettingsIcon size={20} className="text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary tracking-tight">
                {showApp ? t('settings.application') : t('settings.project')}
              </h1>
              <p className="text-xs text-text-tertiary">
                {showApp
                  ? t('settings.appDescription')
                  : t('settings.projectDescription')}
              </p>
            </div>
          </div>
          {/* Task (Settings redesign) — removed the per-repo Settings button
              from the top of the Settings page. Repository settings are now
              accessed via right-click on the repo row in the Sidebar (the
              'repo-settings' context-menu action), so duplicating the entry
              point at the top of global Settings was redundant. */}
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-border-default mb-4">
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              showApp
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            )}
            onClick={() => setActiveTab('application')}
          >
            {t('settings.application')}
          </button>
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
              showProject
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary',
              !currentRepo && 'opacity-50 cursor-not-allowed'
            )}
            onClick={() => currentRepo && setActiveTab('project')}
            disabled={!currentRepo}
            title={currentRepo ? undefined : t('settings.openRepoForProject')}
          >
            {t('settings.project')}
            {currentRepo && (
              <span className="text-2xs text-text-tertiary font-normal truncate max-w-32">
                {currentRepo.name}
              </span>
            )}
          </button>
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              showIntegrations
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            )}
            onClick={() => setActiveTab('show-integrations')}
          >
            {t('settings.integrations')}
          </button>
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
              showThemes
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            )}
            onClick={() => setActiveTab('themes')}
          >
            <Palette size={14} />
            {t('settings.themes')}
          </button>
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
              showAi
                ? 'border-accent text-accent'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            )}
            onClick={() => setActiveTab('ai')}
          >
            <Sparkles size={14} />
            {t('settings.ai')}
          </button>
        </div>

        {/* No repo open for Project Settings tab */}
        {activeTab === 'project' && !currentRepo && (
          <div className="panel p-8 text-center text-text-tertiary">
            <SettingsIcon size={32} className="mx-auto mb-3 opacity-40" />
            <div className="text-sm">{t('settings.openRepoForProject')}</div>
          </div>
        )}

        {/* Appearance — Application Settings */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.appearance')}</div>
          <div className="p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t('settings.theme')}</div>
                <div className="text-xs text-text-tertiary">
                  {t('settings.themeDescription')}
                </div>
              </div>
              <button
                className="btn btn-secondary"
                onClick={toggleTheme}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                {theme === 'dark' ? t('settings.lightMode') : t('settings.darkMode')}
              </button>
            </div>
            {/* Language selector */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t('settings.language')}</div>
                <div className="text-xs text-text-tertiary">
                  {t('settings.languagesHint')}
                </div>
              </div>
              <select
                className="text-sm px-3 py-1.5 bg-bg-secondary border border-border-default rounded"
                value={locale}
                onChange={(e) => setLocale(e.target.value as 'en' | 'ru' | 'zh' | 'de')}
              >
                {LOCALES.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </select>
            </div>
            {/* UI Contrast slider — applies CSS `filter: contrast(N%)` on #root */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-medium">{t('settings.contrast')}</div>
                  <div className="text-xs text-text-tertiary">
                    {t('settings.contrastHint')}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-tertiary font-mono w-10 text-right">
                    {settings.contrast ?? 100}%
                  </span>
                  <button
                    className="text-2xs text-accent hover:underline"
                    onClick={() => setSetting('contrast', 100)}
                    title={t('settings.contrastResetTitle')}
                  >
                    {t('settings.contrastReset')}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 px-1">
                <span className="text-2xs text-text-tertiary w-8">{t('settings.contrastSoft')}</span>
                <input
                  type="range"
                  min={50}
                  max={150}
                  step={5}
                  value={settings.contrast ?? 100}
                  onChange={(e) => setSetting('contrast', Number(e.target.value))}
                  className="flex-1"
                  style={{ accentColor: 'var(--accent)' }}
                  title={t('settings.contrastSliderTitle')}
                />
                <span className="text-2xs text-text-tertiary w-12">{t('settings.contrastPunchy')}</span>
              </div>
              {/* Quick presets */}
              <div className="flex items-center gap-1 mt-2">
                <span className="text-2xs text-text-tertiary mr-1">{t('settings.contrastPresets')}</span>
                {[
                  { label: t('settings.presetSoft'), value: 75 },
                  { label: t('settings.presetNormal'), value: 100 },
                  { label: t('settings.presetHigh'), value: 125 },
                  { label: t('settings.presetMax'), value: 150 },
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
            {/* Sidebar visual mode — Discord/Slack-style dim sidebar. */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t('settings.sidebarModeTitle')}</div>
                <div className="text-xs text-text-tertiary">{t('settings.sidebarModeHint')}</div>
              </div>
              <div className="flex items-center gap-1">
                {(['default', 'dim', 'light'] as const).map((mode) => (
                  <button
                    key={mode}
                    className={cn(
                      'px-2 py-0.5 text-2xs rounded border transition-colors',
                      (settings.sidebarMode ?? 'default') === mode
                        ? 'bg-accent text-text-inverse border-accent'
                        : 'bg-bg-tertiary text-text-secondary border-border-default hover:bg-bg-hover',
                    )}
                    onClick={() => setSetting('sidebarMode', mode)}
                    title={t(`settings.sidebarMode_${mode}`)}
                  >
                    {t(`settings.sidebarMode_${mode}`)}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t('settings.fontSizeBase')}</div>
                <div className="text-xs text-text-tertiary">{t('settings.fontSizeBaseHint')}</div>
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
              <div className="text-2xs uppercase text-text-tertiary mb-3 font-bold tracking-wider">{t('settings.perAreaFontSizes')}</div>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center justify-between gap-2 p-2 rounded hover:bg-bg-hover transition-colors">
                  <span className="text-xs">{t('settings.fontAreaTree')}</span>
                  <input type="number" min={8} max={20} value={settings.fontSizeTree ?? 12}
                    onChange={(e) => setSetting('fontSizeTree', Number(e.target.value))} className="w-16 text-xs" />
                </label>
                <label className="flex items-center justify-between gap-2 p-2 rounded hover:bg-bg-hover transition-colors">
                  <span className="text-xs">{t('settings.fontAreaLists')}</span>
                  <input type="number" min={8} max={20} value={settings.fontSizeList ?? 12}
                    onChange={(e) => setSetting('fontSizeList', Number(e.target.value))} className="w-16 text-xs" />
                </label>
                <label className="flex items-center justify-between gap-2 p-2 rounded hover:bg-bg-hover transition-colors">
                  <span className="text-xs">{t('settings.fontAreaDiff')}</span>
                  <input type="number" min={8} max={20} value={settings.fontSizeDiff ?? 11}
                    onChange={(e) => setSetting('fontSizeDiff', Number(e.target.value))} className="w-16 text-xs" />
                </label>
                <label className="flex items-center justify-between gap-2 p-2 rounded hover:bg-bg-hover transition-colors">
                  <span className="text-xs">{t('settings.fontAreaMonospace')}</span>
                  <input type="number" min={8} max={20} value={settings.fontSizeMonospace ?? 11}
                    onChange={(e) => setSetting('fontSizeMonospace', Number(e.target.value))} className="w-16 text-xs" />
                </label>
              </div>
              <div className="text-2xs text-text-tertiary mt-2 px-2">{t('settings.fontSizesApplyHint')}</div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t('settings.sidebarWidth')}</div>
                <div className="text-xs text-text-tertiary">{t('settings.sidebarWidthHint')}</div>
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
        )}

        {/* Git */}
        {showProject && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.git')}</div>
          <div className="p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t('settings.defaultCloneDir')}</div>
                <div className="text-xs text-text-tertiary">
                  {t('settings.defaultCloneDirHint')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono px-2 py-1 bg-bg-tertiary rounded max-w-xs truncate">
                  {settings.defaultCloneDir || t('settings.notSet')}
                </code>
                <button className="btn btn-secondary text-xs" onClick={handleChooseCloneDir}>
                  <Folder size={12} />
                  {t('settings.browse')}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t('settings.maxHistoryEntries')}</div>
                <div className="text-xs text-text-tertiary">
                  {t('settings.maxHistoryEntriesHint')}
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
                <div className="text-sm font-medium">{t('settings.showReflogInHistory')}</div>
                <div className="text-xs text-text-tertiary">
                  {t('settings.showReflogHint')}
                </div>
              </div>
              <input
                type="checkbox"
                checked={settings.showReflogInHistory ?? false}
                onChange={(e) => setSetting('showReflogInHistory', e.target.checked)}
              />
            </label>
            <div className="border-t border-border-subtle pt-4 mt-4">
              <div className="text-2xs uppercase text-text-tertiary mb-3 font-bold tracking-wider">{t('settings.repoList')}</div>
              <label
                className="flex items-center justify-between cursor-pointer mb-4"
                data-testid="auto-refresh-setting"
              >
                <div>
                  <div className="text-sm font-medium">{t('settings.autoRefresh')}</div>
                  <div className="text-xs text-text-tertiary">
                    {t('settings.autoRefreshHint')}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoRefresh ?? true}
                  onChange={(e) => setSetting('autoRefresh', e.target.checked)}
                />
              </label>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{t('settings.remoteCheckInterval')}</div>
                  <div className="text-xs text-text-tertiary">
                    {t('settings.remoteCheckIntervalHint')}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={3600}
                    step={10}
                    value={settings.repoRemoteCheckIntervalSec ?? 120}
                    onChange={(e) => setSetting('repoRemoteCheckIntervalSec', Math.max(0, Number(e.target.value)))}
                    className="w-20 text-sm"
                    data-testid="remote-check-interval-input"
                  />
                  <span className="text-xs text-text-tertiary">{t('settings.secUnit')}</span>
                </div>
              </div>
            </div>
          </div>
        </section>
        )}

        {/* Repositories */}
        {showProject && (
        <section className="panel mb-4">
          <div className="panel-header">
            <span>{t('settings.knownRepositories', { count: repos.length })}</span>
            <button
              className="icon-btn !w-6 !h-6"
              title={t('common.refresh')}
              onClick={() => loadRepos()}
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="p-2">
            {repos.length === 0 ? (
              <div className="p-6 text-center text-sm text-text-tertiary">
                <Folder size={24} className="mx-auto mb-2 opacity-40" />
                {t('settings.noReposAdded')}
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
                    title={t('common.remove')}
                    onClick={() => removeRepo(r.path)}
                  >
                    <Plus size={12} className="rotate-45" />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
        )}

        {/* External Tools */}
        {showProject && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.externalTools')}</div>
          <div className="p-5 space-y-4">
            {/* --- Visual Studio Code integration --- */}
            <div className="pb-3 mb-1 border-b border-border-subtle">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t('vscode.settings.title')}</span>
                  {vscodeChecking ? (
                    <Loader size={13} className="animate-spin text-text-tertiary" />
                  ) : vscodeDet?.available ? (
                    <span className="text-2xs px-1.5 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400">
                      {t('vscode.settings.statusDetected', { version: vscodeDet.version })}
                    </span>
                  ) : (
                    <span className="text-2xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-600 dark:text-red-400">
                      {t('vscode.settings.notDetected')}
                    </span>
                  )}
                </div>
                <button
                  className="btn-secondary text-xs px-2 py-1"
                  onClick={() => detectVsCodeCli(true)}
                  disabled={vscodeChecking}
                >
                  <RefreshCw size={12} className={cn('mr-1', vscodeChecking && 'animate-spin')} />
                  {t('vscode.settings.detect')}
                </button>
              </div>
              <div className="text-2xs text-text-tertiary mono mb-2 truncate" title={vscodeDet?.path || ''}>
                {vscodeDet?.path || '—'}
              </div>
              <label className="text-xs text-text-tertiary block mb-1">{t('vscode.settings.pathLabel')}</label>
              <input
                type="text"
                className="w-full text-sm mono"
                placeholder="/usr/bin/code · C:\\...\\bin\\code.cmd"
                value={vscodePathInput}
                onChange={(e) => setVscodePathInput(e.target.value)}
                onBlur={async () => {
                  if (vscodePathInput === (settings.vscodePath ?? '')) return;
                  try {
                    await setSetting('vscodePath', vscodePathInput.trim());
                    toast.success(t('vscode.settings.saved'));
                    await detectVsCodeCli(true);
                  } catch { /* ignore */ }
                }}
              />
              <div className="text-2xs text-text-tertiary mt-1">{t('vscode.settings.pathHint')}</div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  className="btn-secondary text-xs px-2 py-1"
                  disabled={!currentRepo}
                  onClick={async () => {
                    if (!currentRepo) return;
                    try {
                      const res = await api.vscode.open(currentRepo.path);
                      if (res.ok) toast.success(t('vscode.opened'));
                      else toast.error(t('vscode.openFailed'));
                    } catch (e) {
                      toast.error(t('vscode.openFailed'), String(e));
                    }
                  }}
                >
                  {t('vscode.settings.openRepo')}
                </button>
                {vscodeTool?.vscodeConfigured ? (
                  <>
                    <span className="text-2xs px-2 py-1 rounded bg-green-500/15 text-green-600 dark:text-green-400 self-center">
                      {t('vscode.settings.registered')}
                    </span>
                    <button
                      className="btn-secondary text-xs px-2 py-1"
                      disabled={!currentRepo}
                      onClick={async () => {
                        if (!currentRepo) return;
                        try {
                          const res = await api.vscode.removeDiffTool(currentRepo.path);
                          if (res.ok) {
                            toast.success(t('vscode.settings.removedToast'));
                            setVscodeTool(await api.vscode.diffToolStatus(currentRepo.path));
                          } else toast.error(res.detail || t('vscode.openFailed'));
                        } catch (e) {
                          toast.error(t('vscode.openFailed'), String(e));
                        }
                      }}
                    >
                      {t('vscode.settings.removeDiffTool')}
                    </button>
                  </>
                ) : (
                  <button
                    className="btn-secondary text-xs px-2 py-1"
                    disabled={!currentRepo}
                    onClick={async () => {
                      if (!currentRepo) return;
                      try {
                        const res = await api.vscode.installDiffTool(currentRepo.path);
                        if (res.ok) {
                          toast.success(t('vscode.settings.registeredToast'));
                          setVscodeTool(await api.vscode.diffToolStatus(currentRepo.path));
                        } else toast.error(res.detail || t('vscode.notFound'));
                      } catch (e) {
                        toast.error(t('vscode.openFailed'), String(e));
                      }
                    }}
                  >
                    {t('vscode.settings.registerDiffTool')}
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('settings.diffToolCommand')}</label>
              <input
                type="text"
                className="w-full text-sm mono"
                placeholder="meld $LOCAL $REMOTE"
                defaultValue=""
                onBlur={async (e) => {
                  if (currentRepo) {
                    try {
                      await api.git.configSet(currentRepo.path, 'diff.tool', e.target.value);
                      toast.success(t('settings.diffToolSaved'));
                    } catch { /* ignore */ }
                  }
                }}
              />
              <div className="text-2xs text-text-tertiary mt-1">
                {t('settings.diffVarsUse')} <code className="mono">$LOCAL</code> {t('settings.and')} <code className="mono">$REMOTE</code>{t('settings.diffVarsSuffix')}
              </div>
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('settings.mergeToolCommand')}</label>
              <input
                type="text"
                className="w-full text-sm mono"
                placeholder="meld $LOCAL $BASE $REMOTE --output=$MERGED"
                defaultValue=""
                onBlur={async (e) => {
                  if (currentRepo) {
                    try {
                      await api.git.configSet(currentRepo.path, 'merge.tool', e.target.value);
                      toast.success(t('settings.mergeToolSaved'));
                    } catch { /* ignore */ }
                  }
                }}
              />
              <div className="text-2xs text-text-tertiary mt-1">
                {t('settings.variables')} <code className="mono">$LOCAL $BASE $REMOTE $MERGED</code>
              </div>
            </div>
          </div>
        </section>
        )}

        {/* Pull Strategy */}
        {showProject && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.pullStrategy')}</div>
          <div className="p-5 space-y-4">
            <div>
              <label className="text-xs text-text-tertiary block mb-2">{t('settings.whenPulling')}</label>
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
                    <div className="font-medium">{t('settings.mergeDefault')}</div>
                    <div className="text-2xs text-text-tertiary">{t('settings.mergeDesc')}</div>
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
                    <div className="font-medium">{t('toolbar.rebase')}</div>
                    <div className="text-2xs text-text-tertiary">{t('settings.rebaseDesc')}</div>
                  </div>
                </label>
              </div>
            </div>
            <div className="text-2xs text-text-tertiary">
              {t('settings.pullStrategyHint')}
            </div>
          </div>
        </section>
        )}

        {/* Git Config */}
        {showProject && (
          <section className="panel mb-4">
            <div className="panel-header flex items-center justify-between">
              <span>{t('settings.gitConfig')} — {currentRepo.name}</span>
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
                <button className="icon-btn !w-5 !h-5 ml-1" title={t('settings.reloadConfig')} onClick={loadConfig}>
                  {configLoading ? <Loader size={11} className="spin" /> : <RefreshCw size={11} />}
                </button>
              </div>
            </div>
            <div className="p-5 space-y-3">
              <input
                type="text"
                className="w-full text-xs"
                placeholder={t('settings.filterKeys')}
                value={configFilter}
                onChange={(e) => setConfigFilter(e.target.value)}
              />
              <div className="max-h-72 overflow-y-auto border border-border-default rounded">
                {configEntries.length === 0 ? (
                  <div className="p-4 text-xs text-text-tertiary text-center">
                    {t('settings.noConfigEntries', { scope: configScope })}
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
                              title={t('settings.saveEnter')}
                              onClick={() => { handleConfigSet(entry.key, editingValue); setEditingKey(null); }}
                            >
                              ✓
                            </button>
                          </>
                        ) : (
                          <>
                            <code
                              className="flex-1 font-mono text-text-primary truncate cursor-pointer hover:text-accent"
                              title={t('settings.clickToEdit')}
                              onClick={() => { setEditingKey(`${entry.key}-${i}`); setEditingValue(entry.value); }}
                            >
                              {entry.value || <span className="text-text-tertiary italic">{t('settings.emptyValue')}</span>}
                            </code>
                            <button
                              className="icon-btn !w-5 !h-5 opacity-0 group-hover:opacity-100 hover:!text-status-deleted"
                              title={t('settings.removeKeyTitle')}
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
                  placeholder={t('settings.valuePlaceholder')}
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
                  {t('common.add')}
                </button>
              </div>
              <div className="text-2xs text-text-tertiary">
                {t('settings.configScopeHint')} <b>{configScope}</b>{configScope === 'local' ? t('settings.scopeNoteLocal') : configScope === 'global' ? t('settings.scopeNoteGlobal') : t('settings.scopeNoteSystem')}
              </div>
            </div>
          </section>
        )}

        {/* SmartGit Manual: Preferences → Commands */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.commands')}</div>
          <div className="p-5 space-y-3 text-sm">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.allowModifyingPushedCommits ?? false}
                onChange={(e) => setSetting('allowModifyingPushedCommits', e.target.checked)}
              />
              <div className="flex-1">
                <div>{t('settings.allowModifyingPushed')}</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  {t('settings.allowModifyingPushedHint')}
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
                <div>{t('settings.detectRenames')}</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  {t('settings.detectRenamesHint')}
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
                <div>{t('settings.distinguishEol')}</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  {t('settings.distinguishEolHint')}
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
                <div>{t('settings.autoStash')}</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  {t('settings.autoStashHint')}
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
                <div>{t('settings.includeUntrackedStash')}</div>
                <div className="text-2xs text-text-tertiary mt-0.5">
                  {t('settings.includeUntrackedStashHint')}
                </div>
              </div>
            </label>
          </div>
        </section>
        )}

        {/* SmartGit Manual: External Tools system */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.externalTools')}</div>
          <div className="p-5 text-sm space-y-3">
            <div className="text-2xs text-text-tertiary">
              {t('settings.extToolsConfigure')} {t('settings.variables')} <code className="mono text-accent">{`{filePath}`}</code>,{' '}
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
              {t('settings.extToolsWrite')} <code>diff.tool</code> {t('settings.and')} <code>merge.tool</code>.{' '}
              {t('settings.extToolsCommandHint')} <code>[difftool "..."]</code> /{' '}
              <code>[mergetool "..."]</code>{t('settings.extToolsSectionsSuffix')}
            </div>
          </div>
        </section>
        )}

        {/* SmartGit Manual: Low-Level Properties editor */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.lowLevelProps')}</div>
          <div className="p-5 text-sm space-y-3">
            <div className="text-2xs text-text-tertiary">
              {t('settings.lowLevelHint')} <code>smartgit.properties</code>. {t('settings.lowLevelRestart')}
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
                {t('settings.resetToDefaults')}
              </button>
            </div>
          </div>
        </section>
        )}

        {/* SmartGit Manual: AI Commit Messages (v25+) — now on its own 'AI' tab */}
        {showAi && (
        <section className="panel mb-4">
          <div className="panel-header flex items-center gap-2">
            <Sparkles size={16} />
            {t('settings.aiCommitMessages')}
          </div>
          <div className="p-5 text-sm space-y-4">
            {/* Provider + Model — primary config */}
            <div>
              <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
                {t('settings.aiProviderSection') || 'Provider'}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('settings.provider')}</label>
                  <select
                    className="w-full text-sm bg-bg-tertiary border border-border-default rounded px-2 py-1.5"
                    value={settings.aiProvider || ''}
                    onChange={(e) => {
                      const providerId = e.target.value;
                      setSetting('aiProvider', providerId);
                      // Auto-fill URL + model from the provider preset —
                      // saves the user from looking up the correct endpoint
                      // URL for each provider. They can still override after.
                      if (providerId) {
                        const preset = getProviderPreset(providerId);
                        if (preset.defaultUrl && !settings.aiUrl) {
                          setSetting('aiUrl', preset.defaultUrl);
                        }
                        if (preset.defaultModel && !settings.aiModel) {
                          setSetting('aiModel', preset.defaultModel);
                        }
                      }
                    }}
                  >
                    <option value="">{t('settings.disabledOption')}</option>
                    {PROVIDER_PRESETS.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.label}{p.freeTier ? ' — FREE' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('settings.model')}</label>
                  {/* For Ollama, hide the manual Model input — the model is
                      chosen via the OllamaModelPicker below (which fetches
                      the live model list from the server and shows metadata:
                      parameter count, file size, quantization, family).
                      For other providers (OpenAI/Anthropic/Mistral/custom),
                      keep the free-text input — there's no server to query. */}
                  {settings.aiProvider === 'ollama' ? (
                    <input
                      type="text"
                      className="w-full text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1.5 opacity-60"
                      placeholder={settings.aiModel || 'Pick from list below ↓'}
                      value={settings.aiModel || ''}
                      readOnly
                      title="Model is chosen via the picker below"
                    />
                  ) : (
                    <input
                      type="text"
                      className="w-full text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1.5"
                      placeholder="gpt-4o-mini"
                      defaultValue={settings.aiModel || ''}
                      onBlur={(e) => setSetting('aiModel', e.target.value)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Provider description + API key hint — shown when a provider
                is selected. Helps the user understand what the provider
                offers (free tier? latency?) and where to get an API key. */}
            {settings.aiProvider && (() => {
              const preset = getProviderPreset(settings.aiProvider);
              return (
                <div className="text-2xs text-text-tertiary mt-2 p-2 rounded bg-bg-tertiary border border-border-subtle">
                  <div className="flex items-center gap-2 mb-1">
                    {preset.freeTier && (
                      <span className="px-1.5 py-0.5 rounded bg-status-added/15 text-status-added font-semibold text-3xs uppercase">
                        FREE
                      </span>
                    )}
                    <span>{preset.description}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="opacity-70">API key:</span>
                    {preset.apiKeyHint.startsWith('http') ? (
                      <a
                        href={preset.apiKeyHint}
                        onClick={(e) => { e.preventDefault(); api.app.openExternal(preset.apiKeyHint); }}
                        className="text-accent hover:underline"
                      >
                        {preset.apiKeyHint}
                      </a>
                    ) : (
                      <span>{preset.apiKeyHint}</span>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Connection — URL + API key */}
            <div>
              <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
                {t('settings.aiConnectionSection') || 'Connection'}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('settings.apiUrl')}</label>
                  <input
                    type="text"
                    className="w-full text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1.5"
                    placeholder="https://api.openai.com/v1/chat/completions"
                    defaultValue={settings.aiUrl || ''}
                    onBlur={(e) => setSetting('aiUrl', e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">{t('settings.apiKey')}</label>
                  <input
                    type="password"
                    className="w-full text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1.5"
                    placeholder="sk-..."
                    defaultValue={settings.aiApiKey || ''}
                    onBlur={(e) => setSetting('aiApiKey', e.target.value)}
                  />
                </div>
              </div>
              <div className="text-2xs text-text-tertiary mt-2">
                {t('settings.ollamaHint')} <code className="mono bg-bg-tertiary px-1 rounded">http://localhost:11434</code>. {t('settings.ollamaPullHint')} (<code className="mono bg-bg-tertiary px-1 rounded">ollama pull llama3.2</code>).
              </div>
            </div>

            {/* Ollama model picker — fetches /api/tags from the Ollama server,
                shows a dropdown of available models. User can select instead of
                typing the model name manually. */}
            {settings.aiProvider === 'ollama' && (
              <OllamaModelPicker
                url={settings.aiUrl || 'http://localhost:11434'}
                selectedModel={settings.aiModel || ''}
                onSelect={(model) => setSetting('aiModel', model)}
              />
            )}

            {/* Enable toggle */}
            <div className="pt-3 border-t border-border-subtle">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.aiCommitMessagesEnabled ?? false}
                  onChange={(e) => setSetting('aiCommitMessagesEnabled', e.target.checked)}
                  className="w-4 h-4"
                />
                <div className="flex-1">
                  <div className="font-medium">{t('settings.enableAi')}</div>
                  <div className="text-2xs text-text-tertiary mt-0.5">
                    {t('settings.aiHintUse')} <code className="mono bg-bg-tertiary px-1 rounded">@ai</code> {t('settings.aiHintOr')} <code className="mono bg-bg-tertiary px-1 rounded">WIP</code> {t('settings.aiHintWipSuffix')}
                  </div>
                </div>
              </label>
            </div>

            {/* SmartGit Manual v26: Custom AI Prompts with template vars */}
            <div className="pt-3 border-t border-border-subtle">
              <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
                {t('settings.aiCustomPromptSection') || 'Custom Prompt'}
              </div>
              <label className="text-xs text-text-tertiary block mb-1">
                {t('settings.customPromptLabel')} {'{{branch}}'}, {'{{author}}'}, {'{{date}}'}, {'{{repository}}'}{t('settings.customPromptSuffix')}
              </label>
              <textarea
                className="w-full font-mono text-xs h-20 resize-none p-2 border border-border-default rounded bg-bg-tertiary"
                placeholder="Leave empty for default prompt. Example: 'You are a senior developer working on the {{repository}} project. Write commit messages in conventional commits format.'"
                defaultValue={settings.aiCustomPrompt || ''}
                onBlur={(e) => setSetting('aiCustomPrompt', e.target.value)}
              />
            </div>

            {/* Chat History Limit — how many messages to persist per-project */}
            <div className="pt-3 border-t border-border-subtle">
              <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
                {t('settings.aiChatHistorySection') || 'Chat History'}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <span className="text-text-tertiary">{t('settings.aiChatHistoryLimitLabel') || 'Max messages to save per project'}</span>
                <input
                  type="number"
                  min={10}
                  max={1000}
                  step={10}
                  className="w-20 text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1"
                  value={settings.aiChatHistoryLimit ?? 100}
                  onChange={(e) => setSetting('aiChatHistoryLimit', parseInt(e.target.value) || 100)}
                />
              </label>
              <div className="text-2xs text-text-tertiary mt-1">
                {t('settings.aiChatHistoryHint') || 'Conversation history is saved per-project in localStorage. Older messages beyond this limit are automatically dropped.'}
              </div>
            </div>

            {/* Context Size — controls when conversation history gets
                compressed. When the total character count of prior messages
                exceeds this threshold, old messages are replaced with a
                text summary to keep the context window manageable.
                Length-based (not message-count) — a single get_status
                result with 500 lines takes more context than 10 short
                chat messages. */}
            <div className="pt-3 border-t border-border-subtle">
              <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
                Context Size
              </div>
              <label className="flex items-center gap-2 text-xs">
                <span className="text-text-tertiary">Max context (characters)</span>
                <input
                  type="number"
                  min={5000}
                  max={200000}
                  step={5000}
                  className="w-24 text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1"
                  value={settings.aiContextMaxChars ?? 20000}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    setSetting('aiContextMaxChars', Number.isFinite(v) ? v : 20000);
                  }}
                />
                <span className="text-2xs text-text-tertiary">chars (~{Math.round((settings.aiContextMaxChars ?? 20000) / 4)} tokens)</span>
              </label>
              <div className="text-2xs text-text-tertiary mt-1">
                When the conversation history exceeds this size (in characters, not messages), old messages are compressed into a short summary. Higher = AI remembers more, but costs more tokens. Lower = cheaper, but AI forgets older context faster. Default: 20,000 chars (~5,000 tokens).
              </div>
            </div>

            {/* Request Timeout — aborts the LLM call after N seconds.
                Applies to BOTH commit-message generation and AI Assistant
                chat. Default 300 (5 min) — slow local Ollama models on CPU
                can take 2-4 min for a single response, so 300 keeps them
                working while still bounding cloud API requests. */}
            <div className="pt-3 border-t border-border-subtle">
              <div className="text-2xs uppercase tracking-wide text-text-tertiary font-semibold mb-2">
                {t('settings.aiTimeoutSection') || 'Request Timeout'}
              </div>
              <label className="flex items-center gap-2 text-xs">
                <span className="text-text-tertiary">{t('settings.aiRequestTimeoutLabel') || 'Response timeout (seconds)'}</span>
                <input
                  type="number"
                  min={0}
                  max={3600}
                  step={10}
                  className="w-20 text-sm font-mono bg-bg-tertiary border border-border-default rounded px-2 py-1"
                  value={settings.aiRequestTimeoutSec ?? 300}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    // Allow 0 (disable) — but NaN falls back to default 300.
                    setSetting('aiRequestTimeoutSec', Number.isFinite(v) ? v : 300);
                  }}
                />
                <span className="text-2xs text-text-tertiary">sec</span>
              </label>
              <div className="text-2xs text-text-tertiary mt-1">
                {t('settings.aiRequestTimeoutHint') || 'How long to wait for the model to respond before aborting. Applies to commit-message generation and the AI Assistant chat. Increase for slow local models (Ollama on CPU), decrease for fast cloud APIs. Set 0 to disable (not recommended — hangs forever if the server stops responding).'}
              </div>
            </div>
          </div>
        </section>
        )}

        {/* SmartGit Manual: Force Push Policies */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.forcePushPolicy')}</div>
          <div className="p-5 space-y-3 text-sm">
            <div>
              <label className="text-xs text-text-tertiary block mb-1">{t('settings.policy')}</label>
              <select
                className="w-full text-sm"
                value={settings.forcePushPolicy || 'feature-only'}
                onChange={(e) => setSetting('forcePushPolicy', e.target.value as 'deny' | 'feature-only' | 'allow')}
              >
                <option value="allow">{t('settings.forcePushAllow')}</option>
                <option value="feature-only">{t('settings.forcePushFeatureOnly')}</option>
                <option value="deny">{t('settings.forcePushDeny')}</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-text-tertiary block mb-1">
                {t('settings.protectedBranchesLabel')}
              </label>
              <textarea
                className="w-full font-mono text-xs h-20 resize-none p-2 border border-border-default rounded bg-bg-tertiary"
                placeholder={'main\nmaster\ndevelop\nrelease/*'}
                defaultValue={(settings.protectedBranches || ['main', 'master', 'develop', 'release/*']).join('\n')}
                onBlur={(e) => setSetting('protectedBranches', e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
              />
            </div>
            <div className="text-2xs text-text-tertiary">
              {t('settings.forcePushHint')} <code>feature-only</code>, {t('settings.forcePushHint2')}{' '}
              {t('settings.forcePushManualNote')}
            </div>
          </div>
        </section>
        )}

        {/* Output / Command Log Settings */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.outputPanel')}</div>
          <div className="p-5 space-y-3 text-sm">
            <label className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t('settings.commandLogLimit')}</div>
                <div className="text-xs text-text-tertiary">
                  {t('settings.commandLogLimitHint')}
                </div>
              </div>
              <input
                type="number"
                min={5}
                max={500}
                className="w-20 text-sm"
                value={settings.commandLogLimit ?? 20}
                onChange={(e) => setSetting('commandLogLimit', Math.max(5, Math.min(500, Number(e.target.value))))}
              />
            </label>
          </div>
        </section>
        )}

        {/* ─── Themes tab — multi-theme picker with pseudo-window preview ─── */}
        {showThemes && (
          <section className="panel mb-4">
            <div className="panel-header flex items-center justify-between">
              <span>{t('settings.themePicker')}</span>
              <span className="text-2xs text-text-tertiary font-normal">
                {t('settings.themePickerHint')}
              </span>
            </div>
            <div className="p-5">
              {/* Quick light/dark toggle button — kept for users who just
                  want to flip between the two defaults without picking a
                  specific palette. */}
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-border-subtle">
                <div>
                  <div className="text-sm font-medium">{t('settings.quickToggle')}</div>
                  <div className="text-xs text-text-tertiary">
                    {t('settings.quickToggleHint')}
                  </div>
                </div>
                <button className="btn btn-secondary" onClick={toggleTheme}>
                  {theme === 'dark' || getThemeMeta(theme)?.isDark ? <Sun size={14} /> : <Moon size={14} />}
                  {theme === 'dark' || getThemeMeta(theme)?.isDark ? t('settings.lightMode') : t('settings.darkMode')}
                </button>
              </div>

              {/* Theme grid — each card shows a pseudo-window preview of the
                  theme with its name. Click to apply. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {THEMES.map((meta) => {
                  const isActive = theme === meta.id;
                  const p = meta.preview;
                  return (
                    <button
                      key={meta.id}
                      onClick={() => setTheme(meta.id)}
                      className={cn(
                        'text-left rounded-md border-2 transition-all overflow-hidden',
                        isActive
                          ? 'border-accent shadow-md'
                          : 'border-border-default hover:border-border-strong hover:shadow-sm'
                      )}
                      style={{ background: p.bgPrimary }}
                    >
                      {/* Pseudo-window: title bar + body. Title bar mimics an
                          OS window with traffic-light dots on the left. */}
                      <div
                        className="flex items-center gap-1.5 px-2 py-1.5 border-b"
                        style={{
                          background: p.bgTertiary,
                          borderColor: p.border,
                        }}
                      >
                        {/* Traffic-light dots — colored circles, classic macOS style */}
                        <span
                          className="rounded-full"
                          style={{ width: 8, height: 8, background: p.statusDeleted, display: 'inline-block' }}
                        />
                        <span
                          className="rounded-full"
                          style={{ width: 8, height: 8, background: p.statusModified, display: 'inline-block' }}
                        />
                        <span
                          className="rounded-full"
                          style={{ width: 8, height: 8, background: p.statusAdded, display: 'inline-block' }}
                        />
                        {/* Window title — theme name */}
                        <span
                          className="ml-1 text-2xs font-medium truncate flex-1"
                          style={{ color: p.textPrimary }}
                        >
                          {t(meta.labelKey)}
                        </span>
                        {/* Active check-mark */}
                        {isActive && (
                          <span
                            className="text-2xs font-bold px-1.5 py-0 rounded-sm"
                            style={{ background: p.accent, color: p.bgPrimary }}
                          >
                            ✓
                          </span>
                        )}
                      </div>
                      {/* Window body — mimics the actual app layout:
                          sidebar on the left, content area on the right.
                          Shows representative UI elements: a sidebar item,
                          a row, a button. */}
                      <div className="flex" style={{ minHeight: 70 }}>
                        {/* Sidebar */}
                        <div
                          className="flex flex-col gap-1 p-1.5"
                          style={{
                            width: 38,
                            background: p.bgSecondary,
                            borderRight: `1px solid ${p.border}`,
                          }}
                        >
                          {/* Two sidebar items — one active (accent bg),
                              one inactive (faded). */}
                          <div
                            className="rounded-sm"
                            style={{
                              height: 6,
                              background: p.accent,
                              opacity: 0.5,
                            }}
                          />
                          <div
                            className="rounded-sm"
                            style={{
                              height: 6,
                              background: p.textSecondary,
                              opacity: 0.25,
                            }}
                          />
                          <div
                            className="rounded-sm"
                            style={{
                              height: 6,
                              background: p.textSecondary,
                              opacity: 0.25,
                            }}
                          />
                        </div>
                        {/* Main content area */}
                        <div
                          className="flex-1 p-2 flex flex-col gap-1"
                          style={{ background: p.bgPrimary }}
                        >
                          {/* Row 1 — file with state letter (M for modified) */}
                          <div
                            className="flex items-center gap-1 text-2xs"
                            style={{ color: p.textPrimary }}
                          >
                            <span style={{ color: p.statusModified, fontWeight: 700 }}>M</span>
                            <span style={{ opacity: 0.85 }}>file.ts</span>
                          </div>
                          {/* Row 2 — another file */}
                          <div
                            className="flex items-center gap-1 text-2xs"
                            style={{ color: p.textPrimary }}
                          >
                            <span style={{ color: p.statusAdded, fontWeight: 700 }}>A</span>
                            <span style={{ opacity: 0.85 }}>new.ts</span>
                          </div>
                          {/* Row 3 — button */}
                          <div
                            className="self-start mt-auto px-1.5 py-0.5 rounded text-2xs font-medium"
                            style={{
                              background: p.accent,
                              color: p.bgPrimary,
                            }}
                          >
                            {t('settings.sampleButton')}
                          </div>
                        </div>
                      </div>
                      {/* Footer — theme name + dark/light indicator */}
                      <div
                        className="flex items-center justify-between px-2 py-1 border-t"
                        style={{
                          background: p.bgSecondary,
                          borderColor: p.border,
                        }}
                      >
                        <span
                          className="text-2xs font-medium"
                          style={{ color: p.textPrimary }}
                        >
                          {t(meta.labelKey)}
                        </span>
                        <span
                          className="text-2xs px-1.5 py-0 rounded-sm"
                          style={{
                            color: meta.isDark ? p.textSecondary : p.textSecondary,
                            border: `1px solid ${p.border}`,
                          }}
                        >
                          {meta.isDark ? t('settings.themeDarkTag') : t('settings.themeLightTag')}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Color swatches — shows the key accent + status colors of
                  the CURRENTLY SELECTED theme, so users can see the full
                  palette at a glance without scanning the pseudo-window. */}
              <div className="mt-5 pt-4 border-t border-border-subtle">
                <div className="text-xs font-medium mb-2">
                  {t('settings.currentPalette')}
                </div>
                <div className="flex flex-wrap gap-3">
                  {(() => {
                    const meta = getThemeMeta(theme);
                    if (!meta) return null;
                    const p = meta.preview;
                    const swatches: { name: string; color: string }[] = [
                      { name: t('settings.swatchBgPrimary'), color: p.bgPrimary },
                      { name: t('settings.swatchBgSecondary'), color: p.bgSecondary },
                      { name: t('settings.swatchBgTertiary'), color: p.bgTertiary },
                      { name: t('settings.swatchTextPrimary'), color: p.textPrimary },
                      { name: t('settings.swatchTextSecondary'), color: p.textSecondary },
                      { name: t('settings.swatchAccent'), color: p.accent },
                      { name: t('settings.swatchBorder'), color: p.border },
                      { name: t('settings.swatchAdded'), color: p.statusAdded },
                      { name: t('settings.swatchModified'), color: p.statusModified },
                      { name: t('settings.swatchDeleted'), color: p.statusDeleted },
                    ];
                    return swatches.map((s) => (
                      <div key={s.name} className="flex flex-col items-center gap-1">
                        <div
                          className="rounded-md border border-border-default"
                          style={{ background: s.color, width: 36, height: 36 }}
                          title={s.color}
                        />
                        <span className="text-2xs text-text-tertiary text-center max-w-[60px] truncate">
                          {s.name}
                        </span>
                        <span className="text-2xs font-mono text-text-tertiary/70">
                          {s.color}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Settings redesign — UI Density (Compact / Comfortable) */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.densityTitle')}</div>
          <div className="p-5 space-y-3">
            <p className="text-xs text-text-tertiary">{t('settings.densityHint')}</p>
            <div className="flex items-center gap-1">
              {(['compact', 'comfortable'] as const).map((d) => (
                <button
                  key={d}
                  className={cn(
                    'px-4 py-1.5 text-xs rounded border transition-colors',
                    (settings.uiDensity ?? 'comfortable') === d
                      ? 'bg-accent text-text-inverse border-accent'
                      : 'bg-bg-tertiary text-text-secondary border-border-default hover:bg-bg-hover',
                  )}
                  onClick={() => setSetting('uiDensity', d)}
                >
                  {t(`settings.density_${d}`)}
                </button>
              ))}
            </div>
          </div>
        </section>
        )}

        {/* Settings redesign — Date Format (Relative / Absolute / Both) */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.dateFormatTitle')}</div>
          <div className="p-5 space-y-3">
            <p className="text-xs text-text-tertiary">{t('settings.dateFormatHint')}</p>
            <div className="flex items-center gap-1">
              {(['relative', 'absolute', 'both'] as const).map((f) => (
                <button
                  key={f}
                  className={cn(
                    'px-4 py-1.5 text-xs rounded border transition-colors',
                    (settings.dateFormat ?? 'relative') === f
                      ? 'bg-accent text-text-inverse border-accent'
                      : 'bg-bg-tertiary text-text-secondary border-border-default hover:bg-bg-hover',
                  )}
                  onClick={() => setSetting('dateFormat', f)}
                >
                  {t(`settings.dateFormat_${f}`)}
                </button>
              ))}
            </div>
          </div>
        </section>
        )}

        {/* Settings redesign — Zoom (stepper control) */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.zoomTitle')}</div>
          <div className="p-5 space-y-3">
            <p className="text-xs text-text-tertiary">{t('settings.zoomHint')}</p>
            <div className="flex items-center gap-2">
              <button
                className="icon-btn !w-8 !h-8 border border-border-default rounded bg-bg-tertiary hover:bg-bg-hover"
                onClick={() => setSetting('zoomLevel', Math.max(60, (settings.zoomLevel ?? 100) - 10))}
                title={t('settings.zoomOut')}
              >−</button>
              <span className="text-sm font-mono w-16 text-center bg-bg-tertiary border border-border-default rounded px-2 py-1">
                {settings.zoomLevel ?? 100}%
              </span>
              <button
                className="icon-btn !w-8 !h-8 border border-border-default rounded bg-bg-tertiary hover:bg-bg-hover"
                onClick={() => setSetting('zoomLevel', Math.min(240, (settings.zoomLevel ?? 100) + 10))}
                title={t('settings.zoomIn')}
              >+</button>
              <button
                className="text-2xs text-accent hover:underline ml-2 px-2 py-1"
                onClick={() => setSetting('zoomLevel', 100)}
              >
                {t('settings.zoomReset')}
              </button>
            </div>
          </div>
        </section>
        )}

        {/* Task 18 — VSCode-style footer display settings. Each checkbox
            toggles a StatusBar footer section. */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.footerSectionTitle')}</div>
          <div className="p-5 space-y-3">
            <p className="text-xs text-text-tertiary">{t('settings.footerSectionDesc')}</p>
            <div className="grid grid-cols-2 gap-2">
              {([
                ['head', t('settings.footerItemHead')],
                ['inProgress', t('settings.footerItemInProgress')],
                ['selectedCommit', t('settings.footerItemSelectedCommit')],
                ['stagedChanged', t('settings.footerItemStagedChanged')],
                ['aheadBehind', t('settings.footerItemAheadBehind')],
                ['recyclable', t('settings.footerItemRecyclable')],
                ['stashes', t('settings.footerItemStashes')],
                ['submodules', t('settings.footerItemSubmodules')],
                ['lfs', t('settings.footerItemLfs')],
                ['updatedAt', t('settings.footerItemUpdatedAt')],
                ['outputToggle', t('settings.footerItemOutputToggle')],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs cursor-pointer p-2 hover:bg-bg-hover rounded border border-border-subtle">
                  <input
                    type="checkbox"
                    className="w-3.5 h-3.5"
                    checked={(settings.footerVisible ?? {})[key] !== false}
                    onChange={(e) => {
                      const next = { ...(settings.footerVisible ?? {}), [key]: e.target.checked };
                      void setSetting('footerVisible', next);
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </section>
        )}

        {/* About */}
        {showApp && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.about')}</div>
          <div className="p-5 text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-text-tertiary">{t('settings.version')}</span>
              <span className="font-mono">2.0.1</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">{t('settings.platform')}</span>
              <span className="font-mono">{navigator.platform}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-tertiary">Electron</span>
              <span className="font-mono">v32</span>
            </div>
          </div>
        </section>
        )}

        {/* Integrations */}
        {showIntegrations && (
        <section className="panel mb-4">
          <div className="panel-header">
            <span className="flex items-center gap-2">
              <Github size={12} />
              {t('settings.github')}
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
                  {t('settings.logout')}
                </button>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-sm mb-2">
                    {t('settings.authenticatePat')}
                  </div>
                  <div className="text-xs text-text-tertiary mb-3">
                    {t('settings.createTokenAt')}{' '}
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
                    {t('settings.withScopes')} <code className="font-mono">repo</code> {t('settings.and')}{' '}
                    <code className="font-mono">read:user</code>{t('settings.scopesSuffix')}
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
                      {t('settings.connect')}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>
        )}

        {/* SmartGit Manual: CI/CD Integration (Jenkins, TeamCity, GitLab CI) */}
        {showIntegrations && (
        <section className="panel mb-4">
          <div className="panel-header">{t('settings.ciCd')}</div>
          <div className="p-5 space-y-3 text-sm">
            <div className="text-2xs text-text-tertiary">
              {t('settings.ciCdHint')}
            </div>
            {/* Jenkins */}
            <div className="border-t border-border-subtle pt-3">
              <div className="text-xs font-semibold mb-2">Jenkins</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  className="text-xs font-mono"
                  placeholder="https://ci.example.com"
                  defaultValue={settings.jenkinsUrl || ''}
                  onBlur={(e) => setSetting('jenkinsUrl', e.target.value)}
                />
                <input
                  type="password"
                  className="text-xs font-mono"
                  placeholder="user:api-token"
                  defaultValue={settings.jenkinsToken || ''}
                  onBlur={(e) => setSetting('jenkinsToken', e.target.value)}
                />
              </div>
            </div>
            {/* TeamCity */}
            <div className="border-t border-border-subtle pt-3">
              <div className="text-xs font-semibold mb-2">TeamCity</div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  className="text-xs font-mono"
                  placeholder="https://teamcity.example.com"
                  defaultValue={settings.teamcityUrl || ''}
                  onBlur={(e) => setSetting('teamcityUrl', e.target.value)}
                />
                <input
                  type="password"
                  className="text-xs font-mono"
                  placeholder="access token"
                  defaultValue={settings.teamcityToken || ''}
                  onBlur={(e) => setSetting('teamcityToken', e.target.value)}
                />
              </div>
            </div>
            {/* GitLab CI */}
            <div className="border-t border-border-subtle pt-3">
              <div className="text-xs font-semibold mb-2">GitLab CI</div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  className="text-xs font-mono"
                  placeholder="https://gitlab.com"
                  defaultValue={settings.gitlabUrl || ''}
                  onBlur={(e) => setSetting('gitlabUrl', e.target.value)}
                />
                <input
                  type="password"
                  className="text-xs font-mono"
                  placeholder="private token"
                  defaultValue={settings.gitlabToken || ''}
                  onBlur={(e) => setSetting('gitlabToken', e.target.value)}
                />
                <input
                  type="number"
                  className="text-xs font-mono"
                  placeholder="project ID"
                  defaultValue={settings.gitlabProjectId || ''}
                  onBlur={(e) => setSetting('gitlabProjectId', e.target.value ? Number(e.target.value) : undefined)}
                />
              </div>
            </div>
          </div>
        </section>
        )}

      </div>
    </div>
  );
}
