import { useState, useEffect, useCallback } from 'react';
import {
  GitCommit,
  RefreshCw,
  Plus,
  Minus,
  ChevronDown,
  ChevronRight,
  GitPullRequestArrow,
  RotateCcw,
  EyeOff,
  Folder,
  ExternalLink,
  Trash2,
  Pencil,
} from 'lucide-react';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useToastStore } from '../stores/toastStore';
import { api, type DiffResult, type FileStatus } from '../lib/api';
import { DiffViewer } from '../components/DiffViewer';
import { cn, getStatusColor } from '../lib/utils';

interface FileGroup {
  label: string;
  files: FileStatus[];
  empty: boolean;
}

export function ChangesPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { status, refreshStatus, stageFiles, stageAll, commit, push, pull } = useGitStore();
  const toast = useToastStore();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [amend, setAmend] = useState(false);
  const [showStaged, setShowStaged] = useState(true);
  const [showUnstaged, setShowUnstaged] = useState(true);

  const loadDiff = useCallback(
    async (file: string, staged: boolean) => {
      setDiffLoading(true);
      try {
        const result = await api.git.diff(repo.path, file, { staged });
        setDiff(result);
      } catch (e) {
        toast.error('Failed to load diff', String(e));
        setDiff(null);
      } finally {
        setDiffLoading(false);
      }
    },
    [repo.path, toast]
  );

  useEffect(() => {
    if (!selectedFile) {
      setDiff(null);
      return;
    }
    // Determine if file is staged
    const isStaged = status?.staged.some((s) => s.path === selectedFile) ?? false;
    loadDiff(selectedFile, isStaged);
  }, [selectedFile, status, loadDiff]);

  const handleRefresh = () => refreshStatus(repo.path);

  const handleStageAll = async () => {
    try {
      await stageAll(repo.path);
      toast.success('All changes staged');
    } catch (e) {
      toast.error('Failed to stage', String(e));
    }
  };

  const handleStageFile = async (file: string) => {
    try {
      await stageFiles(repo.path, [file]);
    } catch (e) {
      toast.error('Failed to stage file', String(e));
    }
  };

  const handleUnstageFile = async (file: string) => {
    try {
      // Use git reset to unstage
      await api.git.raw(repo.path, ['reset', 'HEAD', '--', file]);
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Failed to unstage', String(e));
    }
  };

  const handleRestoreFile = async (file: string) => {
    if (!confirm(`Restore '${file}' to last commit? Local changes will be lost.`)) return;
    try {
      await api.git.restore(repo.path, [file]);
      toast.success('File restored');
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Restore failed', String(e));
    }
  };

  const handleIgnoreFile = async (file: string, isDir = false) => {
    try {
      const pattern = isDir ? `${file}/` : file;
      await api.git.ignore(repo.path, [pattern]);
      toast.success('Added to .gitignore');
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Failed to ignore', String(e));
    }
  };

  const handleDeleteFile = async (file: string) => {
    if (!confirm(`Delete '${file}'? This cannot be undone.`)) return;
    try {
      await api.git.raw(repo.path, ['rm', '-f', '--', file]);
      toast.success('File deleted');
      await refreshStatus(repo.path);
    } catch (e) {
      toast.error('Delete failed', String(e));
    }
  };

  const handleRevealFile = async (file: string) => {
    try {
      const fullPath = `${repo.path}/${file}`.replace(/\/+/g, '/');
      await api.git.revealInFileManager(fullPath);
    } catch (e) {
      toast.error('Failed to reveal', String(e));
    }
  };

  const handleEditIgnore = async () => {
    try {
      await api.git.editIgnoreFile(repo.path, 'local');
      toast.info('.gitignore is ready for editing');
    } catch (e) {
      toast.error('Failed to open .gitignore', String(e));
    }
  };

  const handleOpenInBrowser = async () => {
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      if (info.webUrl && info.provider !== 'unknown') {
        api.app.openExternal(info.webUrl);
      } else {
        toast.info('Repository has no remote URL');
      }
    } catch (e) {
      toast.error('Failed to open in browser', String(e));
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      toast.warning('Commit message is required');
      return;
    }
    try {
      const hash = await commit(repo.path, commitMsg, amend);
      toast.success('Commit created', `Hash: ${hash.substring(0, 7)}`);
      setCommitMsg('');
      setAmend(false);
    } catch (e) {
      toast.error('Commit failed', String(e));
    }
  };

  const handleCommitAndPush = async () => {
    await handleCommit();
    try {
      await push(repo.path);
      toast.success('Pushed successfully');
    } catch (e) {
      toast.error('Push failed', String(e));
    }
  };

  const stagedFiles: FileStatus[] = (status?.files || []).filter((f) => {
    const staged = status?.staged.find((s) => s.path === f.path);
    if (!staged) return false;
    // staged if index is not ' ' AND not '?' AND not '!'
    const idx = staged.index as string;
    return idx !== ' ' && idx !== '?' && idx !== '!';
  });

  const unstagedFiles: FileStatus[] = (status?.files || []).filter((f) => {
    const staged = status?.staged.find((s) => s.path === f.path);
    if (!staged) {
      // file is in status.files but not in staged means it's untracked or has working dir changes
      const wd = f.working_dir as string;
      return wd !== ' ' && wd !== '!';
    }
    // unstaged if working_dir shows change
    const wd = staged.working_dir as string;
    return wd !== ' ' && wd !== '!';
  });

  const untrackedFiles: FileStatus[] = (status?.files || []).filter((f) => {
    const idx = f.index as string;
    const wd = f.working_dir as string;
    return idx === '?' && wd === '?';
  });

  const renderFileRow = (file: FileStatus, isStaged: boolean) => {
    const isSelected = selectedFile === file.path;
    const idx = file.index as string;
    const wd = file.working_dir as string;
    const code = idx !== ' ' && idx !== '?' ? idx : wd;
    const statusCode =
      code === '?' ? 'untracked' :
      code === 'U' ? 'conflict' :
      code === 'M' ? 'modified' :
      code === 'A' ? 'added' :
      code === 'D' ? 'deleted' :
      code === 'R' ? 'renamed' :
      code === 'C' ? 'copied' :
      'modified';
    const isUntracked = idx === '?' && wd === '?';
    return (
      <div
        key={file.path}
        className={cn(
          'group flex items-center gap-2 px-3 py-1 cursor-pointer text-xs',
          isSelected ? 'bg-accent-muted' : 'hover:bg-bg-hover'
        )}
        onClick={() => setSelectedFile(file.path)}
      >
        <span
          className="font-mono font-bold w-4 text-center"
          style={{ color: getStatusColor(statusCode) }}
        >
          {code}
        </span>
        <span className="flex-1 truncate font-mono">{file.path}</span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          {isStaged ? (
            <button
              className="icon-btn !w-5 !h-5"
              title="Unstage"
              onClick={(e) => {
                e.stopPropagation();
                handleUnstageFile(file.path);
              }}
            >
              <Minus size={11} />
            </button>
          ) : (
            <>
              <button
                className="icon-btn !w-5 !h-5"
                title="Stage"
                onClick={(e) => {
                  e.stopPropagation();
                  handleStageFile(file.path);
                }}
              >
                <Plus size={11} />
              </button>
              {!isUntracked && (
                <button
                  className="icon-btn !w-5 !h-5"
                  title="Restore to last commit"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRestoreFile(file.path);
                  }}
                >
                  <RotateCcw size={11} />
                </button>
              )}
              {isUntracked && (
                <>
                  <button
                    className="icon-btn !w-5 !h-5"
                    title="Add to .gitignore"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleIgnoreFile(file.path);
                    }}
                  >
                    <EyeOff size={11} />
                  </button>
                  <button
                    className="icon-btn !w-5 !h-5 hover:!text-status-deleted"
                    title="Delete file"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFile(file.path);
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </>
              )}
              <button
                className="icon-btn !w-5 !h-5"
                title="Reveal in file manager"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRevealFile(file.path);
                }}
              >
                <Folder size={11} />
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const totalChanged = (status?.files.length ?? 0);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Changes</span>
          {totalChanged > 0 && (
            <span className="text-2xs text-text-tertiary">
              {stagedFiles.length} staged · {unstagedFiles.length + untrackedFiles.length} unstaged
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button className="icon-btn" title="Refresh" onClick={handleRefresh}>
            <RefreshCw size={13} />
          </button>
          <button
            className="icon-btn"
            title="Edit .gitignore"
            onClick={handleEditIgnore}
          >
            <Pencil size={13} />
          </button>
          <button
            className="icon-btn"
            title="Open in browser"
            onClick={handleOpenInBrowser}
          >
            <ExternalLink size={13} />
          </button>
          <button
            className="btn btn-ghost text-xs"
            title="Stage all"
            onClick={handleStageAll}
          >
            <Plus size={12} />
            Stage All
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: File lists + commit editor */}
        <div className="w-1/2 flex flex-col border-r border-border-default overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {/* Staged */}
            <div>
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary hover:bg-bg-hover"
                onClick={() => setShowStaged(!showStaged)}
              >
                {showStaged ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Staged Changes ({stagedFiles.length})
              </button>
              {showStaged && stagedFiles.map((f) => renderFileRow(f, true))}
              {showStaged && stagedFiles.length === 0 && (
                <div className="px-3 py-3 text-xs text-text-tertiary">No staged files</div>
              )}
            </div>

            {/* Unstaged */}
            <div className="border-t border-border-default">
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary hover:bg-bg-hover"
                onClick={() => setShowUnstaged(!showUnstaged)}
              >
                {showUnstaged ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Changes ({unstagedFiles.length})
              </button>
              {showUnstaged && unstagedFiles.map((f) => renderFileRow(f, false))}
              {showUnstaged && unstagedFiles.length === 0 && (
                <div className="px-3 py-3 text-xs text-text-tertiary">No unstaged changes</div>
              )}
            </div>

            {/* Untracked */}
            {untrackedFiles.length > 0 && (
              <div className="border-t border-border-default">
                <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary bg-bg-tertiary">
                  Untracked ({untrackedFiles.length})
                </div>
                {untrackedFiles.map((f) => renderFileRow(f, false))}
              </div>
            )}

            {totalChanged === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-text-tertiary">
                <GitCommit size={32} className="mb-2 opacity-50" />
                <div className="text-sm">Working tree clean</div>
                <div className="text-xs mt-1">No changes to commit</div>
              </div>
            )}
          </div>

          {/* Commit editor */}
          <div className="border-t border-border-default bg-bg-secondary p-2">
            <textarea
              className="w-full h-20 text-sm font-mono resize-none"
              placeholder="Commit message..."
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleCommit();
                }
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <label className="flex items-center gap-1 text-xs text-text-secondary cursor-pointer">
                <input
                  type="checkbox"
                  checked={amend}
                  onChange={(e) => setAmend(e.target.checked)}
                />
                Amend
              </label>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-secondary"
                  onClick={handleCommitAndPush}
                  disabled={!commitMsg.trim() || stagedFiles.length === 0}
                  title="Commit then push"
                >
                  <GitPullRequestArrow size={13} />
                  Commit & Push
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleCommit}
                  disabled={!commitMsg.trim() || stagedFiles.length === 0}
                  title="Ctrl+Enter"
                >
                  <GitCommit size={13} />
                  Commit
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Diff viewer */}
        <div className="w-1/2 flex flex-col overflow-hidden">
          <DiffViewer diff={diff} loading={diffLoading} />
        </div>
      </div>
    </div>
  );
}
