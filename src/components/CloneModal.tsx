import { useState, useEffect } from 'react';
import { Folder, X, Github, Loader, Download, Lock, GitBranch } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api, type GithubRepository, type GitLabProject, type SshUrlResolution, type SshTestResult } from '../lib/api';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';

import { useEscapeKey } from '../hooks/useEscapeKey';
interface CloneModalProps {
  open: boolean;
  onClose: () => void;
}

export function CloneModal({ open, onClose }: CloneModalProps) {
  useEscapeKey(open, onClose);
  const { t } = useI18n();
  const cloneRepository = useRepositoryStore((s) => s.cloneRepository);
  const { authenticated, user } = useAuthStore();
  const settings = useSettingsStore((s) => s.settings);
  const toast = useToastActions();

  const [url, setUrl] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [branch, setBranch] = useState('');
  const [depth, setDepth] = useState<number | ''>('');
  const [mirror, setMirror] = useState(false);
  // SmartGit Manual: Partial clone (--filter=blob:none) — skip large files
  const [partialClone, setPartialClone] = useState(false);
  // SmartGit Manual: Configure PrismGit as credential helper for cloned repo
  const [setupCredentialHelper, setSetupCredentialHelper] = useState(false);
  // SmartGit Manual: Skip recursive submodule initialization
  const [noRecursive, setNoRecursive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'url' | 'github' | 'gitlab'>('url');
  const [repos, setRepos] = useState<GithubRepository[]>([]);
  const [gitlabProjects, setGitlabProjects] = useState<GitLabProject[]>([]);
  const [gitlabAuthenticated, setGitlabAuthenticated] = useState(false);
  const [gitlabUser, setGitlabUser] = useState<{ username?: string; name?: string } | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [search, setSearch] = useState('');
  // SmartGit 24.1: recent clone directories for easier selection
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [showRecentDirs, setShowRecentDirs] = useState(false);
  // SmartGit 24.1: detect active branch from remote
  const [detectedBranch, setDetectedBranch] = useState<string>('');
  const [detectingBranch, setDetectingBranch] = useState(false);
  // DBeaver-style inline SSH panel: what will this URL authenticate with?
  const [sshRes, setSshRes] = useState<SshUrlResolution | null>(null);
  const [sshTesting, setSshTesting] = useState(false);
  const [sshTestResult, setSshTestResult] = useState<SshTestResult | null>(null);

  useEffect(() => {
    if (open) {
      setUrl('');
      setTargetPath(settings.defaultCloneDir || '');
      setBranch('');
      setDepth('');
      setMirror(false);
      setPartialClone(false);
      setSetupCredentialHelper(false);
      setNoRecursive(false);
      setSshRes(null);
      setSshTestResult(null);
      if (authenticated) {
        loadRepos();
      }
      // Check GitLab auth state (separate from GitHub auth).
      loadGitlabAuthState();
    }
  }, [open, authenticated, settings.defaultCloneDir]);

  // SmartGit 24.1: detect active branch from remote via `git ls-remote --symref`
  const detectActiveBranch = async (cloneUrl: string) => {
    if (!cloneUrl || mirror) {
      setDetectedBranch('');
      return;
    }
    setDetectingBranch(true);
    try {
      // git ls-remote --symref <url> HEAD returns: ref: refs/heads/main\t<hash>
      // lsRemoteUrl (NOT git:raw) — carries the same SSH env as the actual
      // clone, so managed keys / SSH connection profiles / passwords work
      // for ssh://git@host:50022/repo.git too.
      const output = await api.git.lsRemoteUrl(cloneUrl, ['--symref', 'HEAD']);
      const match = output.match(/ref:\s*refs\/heads\/(\S+)/);
      if (match && match[1]) {
        const branchName = match[1];
        setDetectedBranch(branchName);
        setBranch(branchName); // Pre-fill branch field
      } else {
        setDetectedBranch('');
      }
    } catch {
      setDetectedBranch('');
    } finally {
      setDetectingBranch(false);
    }
  };

  // Debounced branch detection when URL changes
  useEffect(() => {
    if (!url || mirror) {
      setDetectedBranch('');
      return;
    }
    const timer = setTimeout(() => detectActiveBranch(url), 500);
    return () => clearTimeout(timer);
  }, [url, mirror]);

  // Debounced SSH resolution when URL changes (DBeaver shows the SSH tab
  // inside the connection dialog — here we show what the URL would use).
  useEffect(() => {
    if (!url) {
      setSshRes(null);
      setSshTestResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await api.ssh.resolveForUrl(url);
        if (!cancelled) {
          setSshRes(r);
          setSshTestResult(null); // URL changed — previous test is stale
        }
      } catch {
        if (!cancelled) setSshRes(null);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  const testSshForClone = async () => {
    if (!sshRes?.profile) return;
    setSshTesting(true);
    setSshTestResult(null);
    try {
      const r = await api.ssh.testProfile(sshRes.profile.id);
      setSshTestResult(r);
    } catch (e) {
      setSshTestResult({ ok: false, output: String(e) });
    } finally {
      setSshTesting(false);
    }
  };

  const loadRepos = async () => {
    setLoadingRepos(true);
    try {
      const r = await api.github.getRepositories(1);
      setRepos(r);
    } catch (e) {
      toast.error(t('dialogs.loadReposFailed'), String(e));
    } finally {
      setLoadingRepos(false);
    }
  };

  // ─── GitLab: auth state + project list ──────────────────────────────────
  // GitLab auth is SEPARATE from GitHub auth — the user can be logged into
  // both at once. We check the auth state on modal open + load projects if
  // authenticated.
  const [gitlabPat, setGitlabPat] = useState('');
  const [gitlabBaseUrl, setGitlabBaseUrl] = useState('https://gitlab.com');
  const [gitlabAuthLoading, setGitlabAuthLoading] = useState(false);

  const loadGitlabAuthState = async () => {
    try {
      const state = await api.gitlab.getAuthState();
      setGitlabAuthenticated(!!state.token);
      setGitlabUser(state.user ? { username: state.user.username, name: state.user.name } : null);
      if (state.token) {
        // Auto-load projects if already authenticated.
        loadGitlabProjects();
      }
    } catch {
      // GitLab not configured — that's fine, the user can auth via the form.
      setGitlabAuthenticated(false);
    }
  };

  const loadGitlabProjects = async () => {
    setLoadingRepos(true);
    try {
      const projects = await api.gitlab.listProjects(1, 100);
      setGitlabProjects(projects);
    } catch (e) {
      toast.error(t('dialogs.loadGitlabProjectsFailed', { defaultValue: 'Failed to load GitLab projects' }), String(e));
      setGitlabProjects([]);
    } finally {
      setLoadingRepos(false);
    }
  };

  const handleGitlabAuth = async () => {
    if (!gitlabPat.trim()) {
      toast.warning(t('dialogs.gitlabTokenRequired', { defaultValue: 'GitLab personal access token is required' }));
      return;
    }
    setGitlabAuthLoading(true);
    try {
      const user = await api.gitlab.authWithPAT(gitlabPat.trim(), gitlabBaseUrl.trim() || undefined);
      setGitlabAuthenticated(true);
      setGitlabUser({ username: user.username, name: user.name });
      setGitlabPat('');
      toast.success(t('dialogs.gitlabConnected', { defaultValue: 'Connected to GitLab as {user}', user: user.username }));
      loadGitlabProjects();
    } catch (e) {
      toast.error(t('dialogs.gitlabAuthFailed', { defaultValue: 'GitLab authentication failed' }), String(e));
    } finally {
      setGitlabAuthLoading(false);
    }
  };

  const handleGitlabLogout = async () => {
    try {
      await api.gitlab.logout();
      setGitlabAuthenticated(false);
      setGitlabUser(null);
      setGitlabProjects([]);
      toast.info(t('dialogs.gitlabDisconnected', { defaultValue: 'Disconnected from GitLab' }));
    } catch {
      /* ignore */
    }
  };

  const selectGitlabProject = (p: GitLabProject) => {
    // Prefer the HTTP URL for cloning (works with credential helper).
    const cloneUrl = p.http_url_to_repo || p.web_url + '.git';
    setUrl(cloneUrl);
    const defaultName = p.path_with_namespace.split('/').pop() || p.name;
    const basePath = settings.defaultCloneDir || targetPath || '';
    if (basePath) {
      setTargetPath(`${basePath}/${defaultName}`.replace(/\/+/g, '/'));
    }
    setTab('url');
  };

  const handleBrowse = async () => {
    const path = await api.fs.openDirectoryPicker();
    if (path) {
      setTargetPath(path);
    }
  };

  // SmartGit 24: tolerant URL parsing — strip "git clone " prefix
  const normalizeUrl = (input: string): string => {
    let u = input.trim();
    // Strip leading "git clone "
    if (u.toLowerCase().startsWith('git clone ')) {
      u = u.substring('git clone '.length).trim();
    }
    // Strip surrounding quotes
    if ((u.startsWith('"') && u.endsWith('"')) || (u.startsWith("'") && u.endsWith("'"))) {
      u = u.substring(1, u.length - 1);
    }
    // Strip trailing .git if user wants to (keep .git by default, it's valid)
    return u;
  };

  // Auto-derive target directory from URL (SmartGit 24: preselect active branch is done by git itself)
  const handleUrlChange = (input: string) => {
    const normalized = normalizeUrl(input);
    setUrl(normalized);
    // Auto-fill target path if empty or if it was auto-derived from previous URL
    const basePath = settings.defaultCloneDir || '';
    if (basePath && normalized) {
      // Extract repo name from URL
      const match = normalized.match(/\/([^/]+?)(?:\.git)?(?:\?|#|$)/);
      if (match && match[1]) {
        const repoName = match[1];
        const newPath = `${basePath}/${repoName}`.replace(/\/+/g, '/');
        setTargetPath(newPath);
      }
    }
  };

  const handleClone = async () => {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      toast.warning(t('dialogs.urlRequired'));
      return;
    }
    if (!targetPath.trim()) {
      toast.warning(t('dialogs.targetRequired'));
      return;
    }
    setLoading(true);
    try {
      const finalPath = targetPath;
      if (mirror) {
        // Mirror clone: copies ALL refs (heads, tags, notes, remotes) — bare backup copy
        await api.git.mirror(normalizedUrl, finalPath);
        await useRepositoryStore.getState().openRepository(finalPath);
      } else if (partialClone) {
        // SmartGit Manual: Partial clone — fetch tree without blobs, fetch on demand
        await api.git.clonePartial(normalizedUrl, finalPath, 'blob:none', {
          depth: depth ? Number(depth) : undefined,
          branch: branch || undefined,
          recursive: !noRecursive,
        });
        await useRepositoryStore.getState().openRepository(finalPath);
      } else {
        await cloneRepository(normalizedUrl, finalPath, {
          depth: depth ? Number(depth) : undefined,
          branch: branch || undefined,
        });
      }
      if (setupCredentialHelper) {
        await api.git.setupCredentialHelper(finalPath).catch(() => {});
      }
      toast.success(
        mirror ? t('dialogs.mirrorCloneCreated')
        : partialClone ? t('dialogs.partialCloneCreated')
        : t('dialogs.cloneCreated')
      );
      onClose();
    } catch (e) {
      toast.error(t('dialogs.cloneFailed'), String(e));
    } finally {
      setLoading(false);
    }
  };

  const selectGithubRepo = (r: GithubRepository) => {
    setUrl(r.clone_url);
    const defaultName = r.name;
    const basePath = settings.defaultCloneDir || targetPath || '';
    if (basePath) {
      setTargetPath(`${basePath}/${defaultName}`.replace(/\/+/g, '/'));
    }
    setTab('url');
  };

  if (!open) return null;

  const filteredRepos = repos.filter(
    (r) =>
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.full_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-[640px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
          <h3 className="text-base font-medium flex items-center gap-2">
            <Download size={16} />
            {t('clone.title')}
          </h3>
          <button className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        <div className="flex border-b border-border-default">
          <button
            className={cn(
              'flex-1 py-2 text-sm font-medium transition-colors',
              tab === 'url'
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-secondary hover:text-text-primary'
            )}
            onClick={() => setTab('url')}
          >
            {t('dialogs.urlTab')}
          </button>
          <button
            className={cn(
              'flex-1 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1',
              tab === 'github'
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-secondary hover:text-text-primary'
            )}
            onClick={() => setTab('github')}
            disabled={!authenticated}
          >
            <Github size={12} />
            {t('dialogs.githubTab')} {authenticated && `(${user?.login})`}
          </button>
          <button
            className={cn(
              'flex-1 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1',
              tab === 'gitlab'
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-secondary hover:text-text-primary'
            )}
            onClick={() => setTab('gitlab')}
            disabled={!gitlabAuthenticated}
            title={gitlabAuthenticated ? t('dialogs.gitlabTab', { defaultValue: 'GitLab projects' }) : t('dialogs.gitlabTabDisabled', { defaultValue: 'Authenticate with GitLab first (Settings → Integrations)' })}
          >
            <GitBranch size={12} />
            {t('dialogs.gitlabTab', { defaultValue: 'GitLab' })} {gitlabAuthenticated && gitlabUser?.username && `(${gitlabUser.username})`}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {tab === 'url' ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">
                  {t('clone.url')}
                </label>
                <input
                  type="text"
                  className="w-full text-sm font-mono"
                  placeholder="https://github.com/user/repo.git"
                  value={url}
                  autoFocus
                  onChange={(e) => handleUrlChange(e.target.value)}
                />
              </div>
              {sshRes?.isSsh && (
                <div className="rounded border border-border-subtle bg-bg-secondary/60 px-2.5 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 text-xs">
                      <Lock size={12} className="text-text-tertiary flex-shrink-0" />
                      <span className="font-mono truncate">
                        {sshRes.user || 'git'}@{sshRes.host}{sshRes.port ? `:${sshRes.port}` : ''}
                      </span>
                    </div>
                    {sshRes.profile && (
                      <button
                        className="btn btn-secondary text-2xs py-0.5 px-2 flex-shrink-0"
                        onClick={testSshForClone}
                        disabled={sshTesting}
                      >
                        {sshTesting ? <Loader size={10} className="animate-spin" /> : null}
                        {sshTesting ? t('clone.ssh.testing') : t('clone.ssh.test')}
                      </button>
                    )}
                  </div>
                  {sshRes.fallback === 'profile' && sshRes.profile && (
                    <div className="text-2xs text-text-secondary flex items-center gap-1.5 flex-wrap">
                      <span className="text-status-added">●</span>
                      <span className="truncate">
                        {t('clone.ssh.usingProfile', {
                          name: sshRes.profile.label || `${sshRes.profile.user}@${sshRes.profile.host}`,
                        })}
                        {' · '}
                        {sshRes.profile.authMethod === 'password'
                          ? 'password'
                          : sshRes.keyLabel || 'key'}
                      </span>
                    </div>
                  )}
                  {sshRes.fallback === 'key' && (
                    <div className="text-2xs text-text-secondary flex items-center gap-1.5">
                      <span className="text-status-added">●</span>
                      <span className="truncate">{t('clone.ssh.usingKey', { name: sshRes.keyLabel || '' })}</span>
                    </div>
                  )}
                  {sshRes.fallback === 'system' && (
                    <div className="text-2xs space-y-0.5">
                      <div className="text-status-modified">{t('clone.ssh.usingSystem')}</div>
                      <div className="text-text-tertiary">{t('clone.ssh.hintSystem')}</div>
                    </div>
                  )}
                  {sshTestResult && (
                    <div
                      className={cn(
                        'text-2xs space-y-0.5',
                        sshTestResult.ok ? 'text-status-added' : 'text-status-deleted'
                      )}
                    >
                      <div>{sshTestResult.ok ? t('clone.ssh.ok') : t('clone.ssh.failed')}</div>
                      {sshTestResult.output && (
                        <div className="font-mono text-text-tertiary line-clamp-2" title={sshTestResult.output}>
                          {sshTestResult.output.split('\n').filter(Boolean).slice(-2).join('\n')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="text-xs text-text-tertiary block mb-1">
                  {t('clone.target')}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 text-sm font-mono"
                    placeholder="/path/to/clone"
                    value={targetPath}
                    onChange={(e) => setTargetPath(e.target.value)}
                  />
                  <button className="btn btn-secondary" onClick={handleBrowse}>
                    <Folder size={12} />
                    {t('dialogs.browse')}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-tertiary block mb-1 flex items-center gap-2">
                    {t('clone.branch')}
                    {detectingBranch && <span className="text-2xs text-accent">{t('dialogs.detecting')}</span>}
                    {detectedBranch && !detectingBranch && (
                      <span className="text-2xs text-status-added">✓ {detectedBranch}</span>
                    )}
                  </label>
                  <input
                    type="text"
                    className="w-full text-sm"
                    placeholder="main"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-text-tertiary block mb-1">
                    {t('clone.depth')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    className="w-full text-sm"
                    placeholder={t('dialogs.fullClonePlaceholder')}
                    value={depth}
                    onChange={(e) => setDepth(e.target.value ? Number(e.target.value) : '')}
                  />
                </div>
              </div>
              <label
                className="flex items-center gap-2 text-sm cursor-pointer"
                title={t('dialogs.mirrorTooltip')}
              >
                <input
                  type="checkbox"
                  checked={mirror}
                  onChange={(e) => setMirror(e.target.checked)}
                />
                {t('clone.mirror')}
              </label>
              <label
                className="flex items-center gap-2 text-sm cursor-pointer"
                title={t('dialogs.partialTooltip')}
              >
                <input
                  type="checkbox"
                  checked={partialClone}
                  onChange={(e) => setPartialClone(e.target.checked)}
                />
                {t('clone.partial')}
              </label>
              <label
                className="flex items-center gap-2 text-sm cursor-pointer"
                title={t('dialogs.credHelperTooltip')}
              >
                <input
                  type="checkbox"
                  checked={setupCredentialHelper}
                  onChange={(e) => setSetupCredentialHelper(e.target.checked)}
                />
                {t('clone.credentialHelper')}
              </label>
              <label
                className="flex items-center gap-2 text-sm cursor-pointer"
                title={t('dialogs.skipSubmodulesTooltip')}
              >
                <input
                  type="checkbox"
                  checked={noRecursive}
                  onChange={(e) => setNoRecursive(e.target.checked)}
                />
                {t('clone.skipSubmodules')}
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                placeholder={t('dialogs.searchRepos')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full text-sm"
              />
              <div className="max-h-80 overflow-y-auto border border-border-default rounded">
                {loadingRepos ? (
                  <div className="p-4 text-center text-sm text-text-tertiary flex items-center justify-center gap-2">
                    <Loader size={14} className="animate-spin" />
                    {t('common.loading')}
                  </div>
                ) : filteredRepos.length === 0 ? (
                  <div className="p-4 text-center text-sm text-text-tertiary">
                    {t('dialogs.noReposFound')}
                  </div>
                ) : (
                  filteredRepos.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-bg-hover border-b border-border-subtle"
                      onClick={() => selectGithubRepo(r)}
                    >
                      <Github size={14} className="text-text-tertiary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{r.full_name}</div>
                        {r.description && (
                          <div className="text-xs text-text-tertiary truncate">
                            {r.description}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-text-tertiary">
                        {r.private && <span className="badge badge-modified">PRIVATE</span>}
                        <span>{r.default_branch}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          {tab === 'gitlab' && (
            <div className="space-y-3">
              {/* GitLab auth form — shown when not authenticated. Mirrors
                  the GitHub PAT form in SettingsPage but inline so the
                  user can auth without leaving the Clone modal. */}
              {!gitlabAuthenticated ? (
                <div className="space-y-2 p-3 bg-bg-tertiary rounded border border-border-default">
                  <div className="text-sm font-medium">{t('dialogs.gitlabConnect', { defaultValue: 'Connect to GitLab' })}</div>
                  <div className="text-xs text-text-tertiary">
                    {t('dialogs.gitlabConnectHint', { defaultValue: 'Enter your GitLab personal access token (PAT) and instance URL to browse and clone your projects.' })}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      className="col-span-2 text-xs font-mono"
                      placeholder="https://gitlab.com"
                      value={gitlabBaseUrl}
                      onChange={(e) => setGitlabBaseUrl(e.target.value)}
                      title={t('dialogs.gitlabBaseUrlTitle', { defaultValue: 'GitLab instance URL (cloud: https://gitlab.com, self-hosted: https://gitlab.example.com)' })}
                    />
                    <input
                      type="password"
                      className="text-xs font-mono"
                      placeholder="glpat-..."
                      value={gitlabPat}
                      onChange={(e) => setGitlabPat(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleGitlabAuth()}
                      title={t('dialogs.gitlabPatTitle', { defaultValue: 'GitLab personal access token — create at https://gitlab.com/-/user_settings/personal_access_tokens (scopes: read_api, read_repository)' })}
                    />
                  </div>
                  <button
                    className="btn btn-primary text-xs"
                    onClick={handleGitlabAuth}
                    disabled={gitlabAuthLoading || !gitlabPat.trim()}
                  >
                    {gitlabAuthLoading ? <Loader size={12} className="animate-spin" /> : <GitBranch size={12} />}
                    {t('dialogs.gitlabConnectButton', { defaultValue: 'Connect' })}
                  </button>
                </div>
              ) : (
                <>
                  {/* GitLab projects list — mirrors the GitHub tab layout. */}
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      placeholder={t('dialogs.searchRepos')}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="flex-1 text-sm"
                    />
                    <button
                      className="btn btn-secondary text-xs"
                      onClick={loadGitlabProjects}
                      title={t('common.refresh')}
                    >
                      {t('common.refresh')}
                    </button>
                    <button
                      className="btn btn-secondary text-xs"
                      onClick={handleGitlabLogout}
                      title={t('dialogs.gitlabDisconnect', { defaultValue: 'Disconnect from GitLab' })}
                    >
                      {t('settings.logout')}
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto border border-border-default rounded">
                    {loadingRepos ? (
                      <div className="p-4 text-center text-sm text-text-tertiary flex items-center justify-center gap-2">
                        <Loader size={14} className="animate-spin" />
                        {t('common.loading')}
                      </div>
                    ) : gitlabProjects.length === 0 ? (
                      <div className="p-4 text-center text-sm text-text-tertiary">
                        {t('dialogs.noGitlabProjects', { defaultValue: 'No GitLab projects found' })}
                      </div>
                    ) : (
                      gitlabProjects
                        .filter((p) => {
                          const q = search.trim().toLowerCase();
                          if (!q) return true;
                          return p.path_with_namespace.toLowerCase().includes(q) ||
                            p.name.toLowerCase().includes(q) ||
                            (p.description ?? '').toLowerCase().includes(q);
                        })
                        .map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-bg-hover border-b border-border-subtle"
                            onClick={() => selectGitlabProject(p)}
                          >
                            <GitBranch size={14} className="text-text-tertiary flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm truncate">{p.path_with_namespace}</div>
                              {p.description && (
                                <div className="text-xs text-text-tertiary truncate">
                                  {p.description}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-text-tertiary">
                              {p.visibility === 'private' && <span className="badge badge-modified">PRIVATE</span>}
                              {p.visibility === 'internal' && <span className="badge badge-renamed">INTERNAL</span>}
                              <span>{p.default_branch}</span>
                              {p.star_count != null && p.star_count > 0 && <span>★ {p.star_count}</span>}
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border-default">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleClone}
            disabled={loading || !url.trim() || !targetPath.trim()}
          >
            {loading ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
            {t('clone.clone')}
          </button>
        </div>
      </div>
    </div>
  );
}
