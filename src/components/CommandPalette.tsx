import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw, Upload, Download, CloudDownload, GitCommit, Search, Sun, Moon,
  Settings as SettingsIcon, FolderPlus, FolderGit, X, GitMerge, Plus, FileText,
  CheckCircle, BookOpen, ExternalLink,
} from './icons';
import { NAV_ITEMS, NAV_SHORTCUTS } from './navItems';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useGitStore } from '../stores/gitStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastStore } from '../stores/toastStore';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { cn } from '../lib/utils';

/** Minimal icon contract shared with ./icons */
type IconType = typeof GitCommit;

export interface PaletteDialogTriggers {
  onFind: () => void;
  onGitFlow: () => void;
  onInteractiveRebase: () => void;
  onRepoInfo: () => void;
  onApplyPatch: () => void;
  onClone: () => void;
  onInit: () => void;
}

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  keywords?: string;
  icon?: IconType;
  action: () => void;
}

/**
 * Command Palette (Ctrl+K / Ctrl+P).
 *
 * One keyboard-driven entry point to the whole app: navigation to every page,
 * the common git actions, tool dialogs and repository switching. Commands that
 * need an open repository are simply not offered when no repo is open, so the
 * palette never produces dead actions.
 */
export function CommandPalette({ open, onClose, triggers }: {
  open: boolean;
  onClose: () => void;
  triggers: PaletteDialogTriggers;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const repos = useRepositoryStore((s) => s.repos);
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const theme = useSettingsStore((s) => s.theme);
  const toast = useToastStore();

  useEscapeKey(open, onClose);

  const buildCommands = useCallback((): Command[] => {
    const repo = useRepositoryStore.getState().currentRepo;
    const git = useGitStore.getState();
    const withRepo = repo ? [
      // --- Git actions -------------------------------------------------------
      {
        id: 'act-push', label: 'Push', group: 'Git Actions', icon: Upload,
        keywords: 'upload publish remote', hint: 'git push',
        action: () => git.push(repo.path).then(() => toast.success('Pushed successfully')).catch((e) => toast.error('Push failed', String(e))),
      },
      {
        id: 'act-pull', label: 'Pull', group: 'Git Actions', icon: Download,
        keywords: 'update remote fetch merge', hint: 'git pull',
        action: () => git.pull(repo.path).then(() => toast.success('Pulled successfully')).catch((e) => toast.error('Pull failed', String(e))),
      },
      {
        id: 'act-fetch', label: 'Fetch All', group: 'Git Actions', icon: CloudDownload,
        keywords: 'sync remote prune', hint: 'git fetch',
        action: () => git.fetch(repo.path).then(() => toast.success('Fetched successfully')).catch((e) => toast.error('Fetch failed', String(e))),
      },
      {
        id: 'act-refresh', label: 'Refresh Status', group: 'Git Actions', icon: RefreshCw,
        keywords: 'reload update working tree', hint: 'F5',
        action: () => { git.refreshStatus(repo.path); },
      },
      {
        id: 'act-stageall', label: 'Stage All Changes', group: 'Git Actions', icon: Plus,
        keywords: 'add all index', hint: 'git add .',
        action: () => git.stageAll(repo.path).then(() => toast.success('All changes staged')).catch((e) => toast.error('Stage failed', String(e))),
      },
      {
        id: 'act-commit', label: 'Commit', group: 'Git Actions', icon: GitCommit,
        keywords: 'changes staged message', hint: 'Ctrl+1',
        action: () => navigate('/changes'),
      },
      // --- Tools (repo-scoped) ----------------------------------------------
      { id: 'tool-find', label: 'Find Object…', group: 'Tools', icon: Search, keywords: 'search commit hash', hint: 'Ctrl+F', action: triggers.onFind },
      { id: 'tool-repoinfo', label: 'Repository Info', group: 'Tools', icon: BookOpen, keywords: 'details summary objects gc', action: triggers.onRepoInfo },
      { id: 'tool-applypatch', label: 'Apply Patch…', group: 'Tools', icon: FileText, keywords: 'patch diff import', action: triggers.onApplyPatch },
      { id: 'tool-gitflow', label: 'Git-Flow…', group: 'Tools', icon: GitMerge, keywords: 'feature release hotfix workflow', hint: 'Ctrl+Shift+G', action: triggers.onGitFlow },
      { id: 'tool-irebase', label: 'Interactive Rebase…', group: 'Tools', icon: ExternalLink, keywords: 'squash reword drop rebase', hint: 'Ctrl+Shift+R', action: triggers.onInteractiveRebase },
      // --- Repositories ------------------------------------------------------
      { id: 'repo-close', label: 'Close Repository', group: 'Repositories', icon: X, keywords: 'exit release memory', action: () => useRepositoryStore.getState().closeRepository() },
    ] : [];

    const repoSwitchers: Command[] = repos
      .filter((r) => r.path !== repo?.path)
      .map((r) => ({
        id: `repo-open-${r.path}`,
        label: `Switch to "${r.name}"`,
        group: 'Repositories',
        icon: FolderGit,
        keywords: r.path,
        action: () => useRepositoryStore.getState().openRepository(r.path).catch((e) => toast.error('Failed to open repository', String(e))),
      }));

    return [
      // Navigation — only meaningful with an open repository
      ...(repo ? NAV_ITEMS.map<Command>((n) => ({
        id: `nav-${n.path}`,
        label: `Go to ${n.label}`,
        group: 'Navigation',
        icon: n.icon,
        hint: NAV_SHORTCUTS[n.path],
        keywords: n.group,
        action: () => navigate(n.path),
      })) : []),
      ...withRepo,
      ...repoSwitchers,
      { id: 'repo-open-picker', label: 'Open Repository…', group: 'Repositories', icon: FolderPlus, keywords: 'folder add directory', action: () => useRepositoryStore.getState().openRepositoryPicker() },
      { id: 'repo-clone', label: 'Clone Repository…', group: 'Repositories', icon: CloudDownload, keywords: 'url download copy', action: triggers.onClone },
      { id: 'repo-init', label: 'Init New Repository…', group: 'Repositories', icon: Plus, keywords: 'create new folder', action: triggers.onInit },
      // Always available
      {
        id: 'ui-theme', label: theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme',
        group: 'Interface', icon: theme === 'dark' ? Sun : Moon,
        keywords: 'appearance dark light mode', hint: 'Ctrl+Shift+T',
        action: () => useSettingsStore.getState().toggleTheme(),
      },
      { id: 'ui-shortcuts', label: 'Keyboard Shortcuts Help', group: 'Interface', icon: CheckCircle, keywords: 'keys hotkeys help', hint: '?', action: () => { window.dispatchEvent(new CustomEvent('prismgit:show-shortcuts')); } },
      { id: 'ui-settings', label: 'Open Settings', group: 'Interface', icon: SettingsIcon, keywords: 'preferences options config', action: () => navigate('/settings') },
    ];
  }, [navigate, repos, theme, toast, triggers]);

  const commands = useMemo(() => buildCommands(), [buildCommands]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    const scored: { c: Command; s: number }[] = [];
    for (const c of commands) {
      const label = c.label.toLowerCase();
      let s = -1;
      if (label.startsWith(q)) s = 0;
      else if (label.includes(` ${q}`)) s = 1;
      else if (label.includes(q)) s = 2;
      else if (`${c.keywords ?? ''} ${c.group}`.toLowerCase().includes(q)) s = 3;
      if (s >= 0) scored.push({ c, s });
    }
    scored.sort((a, b) => a.s - b.s);
    return scored.map((x) => x.c);
  }, [query, commands]);

  // Reset state whenever the palette opens / query changes
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus after mount (palette renders conditionally)
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the active row visible
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, filtered.length]);

  const execute = useCallback((cmd: Command | undefined) => {
    if (!cmd) return;
    onClose();
    // Let the palette unmount before running side effects
    setTimeout(() => cmd.action(), 0);
  }, [onClose]);

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(filtered[active]);
    }
    // Escape is handled globally by useEscapeKey
  };

  if (!open) return null;

  // Render with group headers (visible only where the group changes)
  const rows: { cmd?: Command; header?: string; idx: number }[] = [];
  let lastGroup = '';
  filtered.forEach((cmd, idx) => {
    if (cmd.group !== lastGroup) {
      rows.push({ header: cmd.group, idx });
      lastGroup = cmd.group;
    }
    rows.push({ cmd, idx });
  });

  return (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[12vh] z-[70] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-[560px] max-w-[92vw] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-default">
          <Search size={15} className="text-text-tertiary flex-shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
            placeholder="Type a command or page name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            spellCheck={false}
          />
          <kbd className="text-2xs text-text-tertiary border border-border-subtle rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[340px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-text-tertiary">
              No commands matching “{query}”
            </div>
          ) : (
            rows.map((row) =>
              row.header ? (
                <div
                  key={`h-${row.header}-${row.idx}`}
                  className="px-3 pt-2 pb-1 text-2xs font-bold uppercase tracking-wider text-text-tertiary"
                >
                  {row.header}
                </div>
              ) : (() => {
                const cmd = row.cmd!;
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.id}
                    data-idx={row.idx}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors cursor-pointer',
                      row.idx === active
                        ? 'bg-accent-muted text-accent'
                        : 'text-text-secondary hover:bg-bg-hover'
                    )}
                    onMouseEnter={() => setActive(row.idx)}
                    onClick={() => execute(cmd)}
                  >
                    {Icon && <Icon size={14} className="flex-shrink-0 opacity-80" />}
                    <span className="flex-1 truncate">{cmd.label}</span>
                    {cmd.hint && (
                      <kbd className="text-2xs text-text-tertiary border border-border-subtle rounded px-1.5 py-0.5 flex-shrink-0">
                        {cmd.hint}
                      </kbd>
                    )}
                  </button>
                );
              })()
            )
          )}
        </div>

        <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border-default text-2xs text-text-tertiary">
          <span><kbd className="border border-border-subtle rounded px-1">↑↓</kbd> move</span>
          <span><kbd className="border border-border-subtle rounded px-1">↵</kbd> run</span>
          <span><kbd className="border border-border-subtle rounded px-1">esc</kbd> close</span>
          <span className="ml-auto">{filtered.length} commands</span>
        </div>
      </div>
    </div>
  );
}
