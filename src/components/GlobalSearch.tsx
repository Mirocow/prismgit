import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, GitCommit, GitBranch, Tag, FileText, GitPullRequest, FolderGit, X, ChevronRight,
} from './icons';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastStore, useToastActions } from '../stores/toastStore';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { cn } from '../lib/utils';
import { useI18n } from '../lib/i18n';
import { api, type LogEntry, type BranchInfo, type TagInfo, type StashEntry } from '../lib/api';

/**
 * GlobalSearch — cross-entity search modal.
 *
 * Searches ACROSS multiple entity types IN PARALLEL:
 *   1. Repositories — match by name/path (instant, from store)
 *   2. Branches     — match by name (instant, after branches loaded)
 *   3. Tags         — match by name (instant, after tags loaded)
 *   4. Commits      — match by hash prefix OR message content (debounced 300ms)
 *   5. Files        — match by path (instant, after trackedFiles loaded)
 *   6. Stashes      — match by message (instant, after stashList loaded)
 *
 * Results are grouped by type with icons. Keyboard navigation (↑↓ Enter)
 * works across all groups. Selecting a result navigates to the appropriate
 * page:
 *   - Commit  → History page with that commit selected
 *   - Branch  → Branches page with that branch selected
 *   - Tag     → History page filtered to that tag's commit
 *   - File    → Changes page (or Diff if committed)
 *   - Stash   → Stashes page with that stash selected
 *   - Repo    → opens that repository
 *
 * Triggered by Ctrl+Shift+F (or a Toolbar button).
 */

// ── Result type definitions ──────────────────────────────────────────────────
type ResultKind = 'repo' | 'commit' | 'branch' | 'tag' | 'file' | 'stash';

interface SearchResult {
  id: string;
  kind: ResultKind;
  /** Primary label (branch name, commit subject, file path, etc.). */
  label: string;
  /** Secondary text shown below the label (hash, author, date, etc.). */
  secondary?: string;
  /** Tertiary text shown on the right (date, type tag). */
  tertiary?: string;
  /** Action to run when the result is selected (navigates, opens, etc.). */
  action: () => void;
  /** Match score — lower = better. Used to sort within a group. */
  score: number;
}

// ── Helper: score a match (lower = better) ──────────────────────────────────
function matchScore(text: string, q: string): number {
  const lower = text.toLowerCase();
  if (lower === q) return 0;
  if (lower.startsWith(q)) return 1;
  if (lower.includes(` ${q}`)) return 2;
  if (lower.includes(`/${q}`)) return 3; // path segment start
  if (lower.includes(q)) return 4;
  return -1; // no match
}

// ── Icon picker per kind ─────────────────────────────────────────────────────
function KindIcon({ kind }: { kind: ResultKind }) {
  switch (kind) {
    case 'repo': return <FolderGit size={14} className="flex-shrink-0 opacity-80 text-accent" />;
    case 'commit': return <GitCommit size={14} className="flex-shrink-0 opacity-80 text-status-renamed" />;
    case 'branch': return <GitBranch size={14} className="flex-shrink-0 opacity-80 text-accent-purple" />;
    case 'tag': return <Tag size={14} className="flex-shrink-0 opacity-80 text-status-modified" />;
    case 'file': return <FileText size={14} className="flex-shrink-0 opacity-80 text-text-secondary" />;
    case 'stash': return <GitPullRequest size={14} className="flex-shrink-0 opacity-80 text-status-untracked" />;
  }
}

// ── Group labels (i18n keys) ────────────────────────────────────────────────
const GROUP_LABEL_KEY: Record<ResultKind, string> = {
  repo: 'search.groupRepos',
  commit: 'search.groupCommits',
  branch: 'search.groupBranches',
  tag: 'search.groupTags',
  file: 'search.groupFiles',
  stash: 'search.groupStashes',
};

// ── Order in which groups appear ─────────────────────────────────────────────
const GROUP_ORDER: ResultKind[] = ['repo', 'commit', 'branch', 'tag', 'file', 'stash'];

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const toast = useToastActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);

  // Live data — fetched when the modal opens
  const repos = useRepositoryStore((s) => s.repos);
  const currentRepo = useRepositoryStore((s) => s.currentRepo);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [trackedFiles, setTrackedFiles] = useState<string[]>([]);
  const [commits, setCommits] = useState<LogEntry[]>([]);

  useEscapeKey(open, onClose);

  // ── Fetch reference data when the modal opens ──────────────────────────────
  // Branches/tags/files/stashes are cheap (single git call each) — load them
  // once when the modal opens so subsequent typing filters instantly.
  useEffect(() => {
    if (!open) return;
    const repo = useRepositoryStore.getState().currentRepo;
    if (!repo) return;
    // Fire all four lookups in parallel — they're independent.
    Promise.allSettled([
      api.git.branches(repo.path).catch(() => []),
      api.git.tags(repo.path).catch(() => []),
      api.git.stashList(repo.path).catch(() => []),
      api.git.trackedFiles(repo.path).catch(() => []),
    ]).then(([b, tg, st, tf]) => {
      if (b.status === 'fulfilled') setBranches(b.value);
      if (tg.status === 'fulfilled') setTags(tg.value);
      if (st.status === 'fulfilled') setStashes(st.value);
      if (tf.status === 'fulfilled') setTrackedFiles(tf.value);
    });
  }, [open]);

  // ── Debounced commit search ────────────────────────────────────────────────
  // Commit search is expensive (git log --grep scans every commit message).
  // Debounce 300ms so we only fire after the user stops typing. Also
  // short-circuits for very short queries (< 2 chars) — a single-char search
  // would match almost every commit and overwhelm the results.
  useEffect(() => {
    if (!open || !currentRepo) return;
    const q = query.trim();
    if (q.length < 2) {
      setCommits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        // Try hash-prefix match first (fast, indexed) — returns at most 1.
        const byHash = await api.git.findCommit(currentRepo.path, q).catch(() => null);
        // Then message-content match (slower, scans messages) — capped at 30.
        const byMessage = await api.git
          .log(currentRepo.path, { grep: q, grepIgnoreCase: true, maxCount: 30 })
          .catch(() => []);
        if (cancelled) return;
        // Dedupe: if findCommit returned a result, make sure it's not also
        // in the message-search results (it usually won't be, but be safe).
        const seen = new Set<string>();
        const combined: LogEntry[] = [];
        if (byHash) {
          combined.push(byHash);
          seen.add(byHash.hash);
        }
        for (const c of byMessage) {
          if (!seen.has(c.hash)) {
            combined.push(c);
            seen.add(c.hash);
          }
        }
        if (!cancelled) setCommits(combined);
      } catch {
        if (!cancelled) setCommits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, currentRepo]);

  // ── Build all results from all sources ─────────────────────────────────────
  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchResult[] = [];

    // Repositories — match by name or path
    for (const r of repos) {
      const sName = matchScore(r.name, q);
      const sPath = matchScore(r.path, q);
      const s = Math.max(sName, sPath);
      if (s >= 0) {
        out.push({
          id: `repo-${r.path}`,
          kind: 'repo',
          label: r.name,
          secondary: r.path,
          tertiary: r.path !== currentRepo?.path ? '' : 'current',
          score: s,
          action: () => {
            useRepositoryStore.getState().openRepository(r.path).catch((e) =>
              toast.error(t('shell.openRepoFailed'), String(e))
            );
          },
        });
      }
    }

    // Branches — match by name
    for (const b of branches) {
      const s = matchScore(b.name, q);
      if (s >= 0) {
        out.push({
          id: `branch-${b.name}`,
          kind: 'branch',
          label: b.name,
          secondary: b.lastCommit ? `${b.lastCommit.hash.slice(0, 7)} · ${b.lastCommit.message}` : '',
          tertiary: b.current ? 'HEAD' : (b.remote ? 'remote' : ''),
          score: s,
          action: () => {
            useSelectionStore.getState().selectBranch(b.name);
            navigate('/branches');
          },
        });
      }
    }

    // Tags — match by name
    for (const tg of tags) {
      const s = matchScore(tg.name, q);
      if (s >= 0) {
        out.push({
          id: `tag-${tg.name}`,
          kind: 'tag',
          label: tg.name,
          secondary: tg.hashAbbrev || '',
          tertiary: tg.date || '',
          score: s,
          action: () => {
            useSelectionStore.getState().selectTag(tg.name);
            // Tags don't have their own page — navigate to History where
            // the tag's commit will be highlighted via selectionStore.
            navigate('/history');
          },
        });
      }
    }

    // Commits — match by hash (from findCommit) or message (from log --grep)
    for (const c of commits) {
      const sHash = matchScore(c.hash, q);
      const sHashAbbrev = matchScore(c.hashAbbrev || '', q);
      const sSubject = matchScore(c.subject || '', q);
      const s = Math.max(sHash, sHashAbbrev, sSubject);
      if (s >= 0) {
        out.push({
          id: `commit-${c.hash}`,
          kind: 'commit',
          label: c.subject || '(no subject)',
          secondary: `${c.hashAbbrev} · ${c.author?.name || ''}`,
          tertiary: c.author?.date || '',
          score: s,
          action: () => {
            // Navigate to History with this commit selected — selectionStore
            // carries the hash, HistoryPage scrolls to it on mount.
            useSelectionStore.getState().selectCommit(c.hash);
            navigate('/history');
          },
        });
      }
    }

    // Files — match by path
    for (const f of trackedFiles) {
      const s = matchScore(f, q);
      if (s >= 0) {
        out.push({
          id: `file-${f}`,
          kind: 'file',
          label: f.split('/').pop() || f,
          secondary: f,
          score: s,
          action: () => {
            useSelectionStore.getState().selectFile(f);
            navigate('/changes');
          },
        });
      }
    }

    // Stashes — match by message
    for (const st of stashes) {
      const s = matchScore(st.message, q);
      if (s >= 0) {
        out.push({
          id: `stash-${st.index}`,
          kind: 'stash',
          label: st.message,
          secondary: `stash@{${st.index}}`,
          score: s,
          action: () => {
            useSelectionStore.getState().selectStash(st.index, st.hash);
            navigate('/stashes');
          },
        });
      }
    }

    // Sort within each group by score (best matches first)
    out.sort((a, b) => a.score - b.score);
    return out;
  }, [query, repos, branches, tags, commits, trackedFiles, stashes, currentRepo, navigate, t, toast]);

  // Group results by kind (preserving GROUP_ORDER)
  const grouped = useMemo(() => {
    const map = new Map<ResultKind, SearchResult[]>();
    for (const r of results) {
      if (!map.has(r.kind)) map.set(r.kind, []);
      map.get(r.kind)!.push(r);
    }
    // Return only non-empty groups in GROUP_ORDER
    return GROUP_ORDER
      .filter((k) => map.has(k) && map.get(k)!.length > 0)
      .map((k) => ({ kind: k, items: map.get(k)! }));
  }, [results]);

  // Flat index for keyboard navigation (across all groups, in display order)
  const flatResults = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

  // ── Reset state when modal opens ────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setCommits([]);
      setSearching(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep active row visible during keyboard navigation
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, flatResults.length]);

  const execute = useCallback((result: SearchResult | undefined) => {
    if (!result) return;
    onClose();
    setTimeout(() => result.action(), 0);
  }, [onClose]);

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(flatResults[active]);
    }
  };

  if (!open) return null;

  // Build render rows: group headers + items, with a flat idx for navigation
  const rows: { header?: string; result?: SearchResult; idx: number }[] = [];
  let flatIdx = 0;
  for (const g of grouped) {
    rows.push({ header: t(GROUP_LABEL_KEY[g.kind]), idx: flatIdx });
    for (const r of g.items) {
      rows.push({ result: r, idx: flatIdx });
      flatIdx++;
    }
  }

  const totalResults = flatResults.length;

  return (
    <div
      className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-start justify-center pt-[8vh] z-[70] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="panel w-[680px] max-w-[94vw] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('search.title')}
      >
        {/* ─── Search input ─── */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-default">
          <Search size={15} className="text-text-tertiary flex-shrink-0" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary"
            placeholder={currentRepo ? t('search.placeholderWithRepo', { name: currentRepo.name }) : t('search.placeholderNoRepo')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            spellCheck={false}
            autoFocus
          />
          {searching && (
            <span className="text-2xs text-text-tertiary animate-pulse">{t('search.searching')}</span>
          )}
          <kbd className="text-2xs text-text-tertiary border border-border-subtle rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* ─── No repo open — show hint ─── */}
        {!currentRepo && (
          <div className="px-4 py-8 text-center text-sm text-text-tertiary">
            {t('search.openRepoFirst')}
          </div>
        )}

        {/* ─── Results ─── */}
        {currentRepo && (
          <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
            {query.trim().length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-text-tertiary">
                <Search size={28} className="mx-auto mb-2 opacity-30" />
                {t('search.typeToSearch')}
              </div>
            ) : totalResults === 0 && !searching ? (
              <div className="px-4 py-8 text-center text-sm text-text-tertiary">
                {t('search.noResults', { query })}
              </div>
            ) : (
              rows.map((row) =>
                row.header ? (
                  <div
                    key={`h-${row.header}-${row.idx}`}
                    className="px-3 pt-2 pb-1 text-2xs font-bold uppercase tracking-wider text-text-tertiary sticky top-0 bg-bg-secondary/95 backdrop-blur-sm"
                  >
                    {row.header}
                  </div>
                ) : (() => {
                  const r = row.result!;
                  return (
                    <button
                      key={r.id}
                      data-idx={row.idx}
                      className={cn(
                        'w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors cursor-pointer',
                        row.idx === active
                          ? 'bg-accent-muted text-accent'
                          : 'text-text-secondary hover:bg-bg-hover'
                      )}
                      onMouseEnter={() => setActive(row.idx)}
                      onClick={() => execute(r)}
                    >
                      <KindIcon kind={r.kind} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{r.label}</div>
                        {r.secondary && (
                          <div className="text-2xs text-text-tertiary truncate font-mono">{r.secondary}</div>
                        )}
                      </div>
                      {r.tertiary && (
                        <span className="text-2xs text-text-tertiary flex-shrink-0 px-1.5 py-0.5 rounded bg-bg-tertiary">
                          {r.tertiary}
                        </span>
                      )}
                      {row.idx === active && (
                        <ChevronRight size={12} className="flex-shrink-0 text-text-tertiary" />
                      )}
                    </button>
                  );
                })()
              )
            )}
          </div>
        )}

        {/* ─── Footer ─── */}
        <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border-default text-2xs text-text-tertiary">
          <span><kbd className="border border-border-subtle rounded px-1">↑↓</kbd> {t('search.navigate')}</span>
          <span><kbd className="border border-border-subtle rounded px-1">↵</kbd> {t('search.open')}</span>
          <span><kbd className="border border-border-subtle rounded px-1">esc</kbd> {t('search.close')}</span>
          {totalResults > 0 && (
            <span className="ml-auto">{t('search.resultsCount', { count: totalResults })}</span>
          )}
        </div>
      </div>
    </div>
  );
}
