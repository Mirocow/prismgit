import { useState, useEffect } from 'react';
import { Folder, X, Github, Loader, Download } from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { api, type GithubRepository } from '../lib/api';
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
  const [tab, setTab] = useState<'url' | 'github'>('url');
  const [repos, setRepos] = useState<GithubRepository[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [search, setSearch] = useState('');
  // SmartGit 24.1: recent clone directories for easier selection
  const [recentDirs, setRecentDirs] = useState<string[]>([]);
  const [showRecentDirs, setShowRecentDirs] = useState(false);
  // SmartGit 24.1: detect active branch from remote
  const [detectedBranch, setDetectedBranch] = useState<string>('');
  const [detectingBranch, setDetectingBranch] = useState(false);

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
      if (authenticated) {
        loadRepos();
      }
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
      const output = await api.git.raw('', ['ls-remote', '--symref', cloneUrl, 'HEAD']);
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
