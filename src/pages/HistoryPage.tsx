import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { CommitFileTree } from '../components/CommitFileTree';
import { DiffViewer } from '../components/DiffViewer';
import { FileHistoryViewer } from '../components/FileHistoryViewer';
import { ActivityWave } from '../components/ActivityWave';
import { FilterInput } from '../components/FilterInput';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown, ChevronRight,
  Copy,
  CornerDownRight,
  ExternalLink, FileText,
  Filter,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Pencil,
  PlugConnected,
  PlugDisconnected,
  RefreshCw,
  RotateCcw,
  StickyNote,
  Tag as TagIcon,
  Undo,
  X
} from '../components/icons';
import { RepoStateBanner } from '../components/RepoStateBanner';
import { ResizableSplitter, useResizableWidth } from '../components/ResizableSplitter';
import { CommitHashLink } from '../components/StatusBar';
import type { BugtraqConfig, CommitCheckStatus } from '../lib/api';
import { api, type BranchInfo, type CommitFile, type LogEntry, type RecyclableCommit, type StashEntry } from '../lib/api';
import { formatTime, getAuthorColor, getInitials } from '../lib/authorBadges';
import { linkifyCommitMessage } from '../lib/bugtraq';
import { buildFileMenu, runFileAction } from '../lib/fileContextMenu';
import { bezierPath, BRANCH_COLORS, computeGraph, laneColor } from '../lib/gitGraph';
import { createAncestryResolver } from '../lib/graphAncestry';
import { useI18n } from '../lib/i18n';
import { RefBadges } from '../lib/refBadge';
import { buildRepoStateHandlers } from '../lib/repoState';
import { useContextMenu, type ContextMenuItem } from '../lib/useContextMenu';
import { useLazyList } from '../lib/useLazyList';
import { cn, copyToClipboard, shortHash } from '../lib/utils';
import { useAuthStore } from '../stores/authStore';
import { useGitStore } from '../stores/gitStore';
import { useOperationLogStore } from '../stores/operationLogStore';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useSelectionStore } from '../stores/selectionStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useToastActions } from '../stores/toastStore';

import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useEscapeKey } from '../hooks/useEscapeKey';
const ROW_HEIGHT = 28;
const LANE_WIDTH = 24;
const GRAPH_PAD = 8;

// Re-export for backwards compatibility (other files may import BRANCH_COLORS from here)
export { BRANCH_COLORS };

export function HistoryPage() {
  const repo = useRepositoryStore((s) => s.currentRepo)!;
  const { t } = useI18n();
  const toast = useToastActions();
  const refreshStatus = useGitStore((s) => s.refreshStatus);
  const status = useGitStore((s) => s.status);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  // Set of commit hashes that are ONLY reachable from remote-tracking refs
  // (not from any local branch). Used to draw them with a dashed/hollow style
  // in the graph, like VS Code does for incoming commits.
  const [incomingHashes, setIncomingHashes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  // ── Lazy-loading state ────────────────────────────────────────────────
  // The History list now loads in pages (initial: 50 commits, then 50 more
  // each time the user scrolls near the bottom). This avoids the 500-commit
  // hard cap that previously hid older commits — the user can now scroll
  // all the way back to the very first commit in the repo.
  //
  // PAGE_SIZE = 50 — tuned for fast first paint (graph calc + virtualized
  // rows take ~30ms for 50 commits on a mid-tier laptop, vs. 200ms+ for
  // 100). Combined with the head+upstream default (which typically yields
  // 50-300 commits for a single branch instead of thousands for --all),
  // the History page now opens in ~150ms instead of 1-2 seconds on the
  // ollama-code repo (4764 total commits).
  const PAGE_SIZE = 50;
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  // Commit stats for Activity Wave — fetched lazily after entries load.
  const [commitStatsMap, setCommitStatsMap] = useState<Record<string, { additions: number; deletions: number; files: number }>>({});
  const [search, setSearch] = useState('');
  // Debounced search — avoids re-filtering on every keystroke for large repos.
  // The filter runs on `debouncedSearch` (updated 250ms after typing stops).
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const [showGraph, setShowGraph] = useState(true);
  const [commitFiles, setCommitFiles] = useState<CommitFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  // Merge-commit enrichment: nested commits the merge brought in + tag
  // metadata (annotated tag message) for tags pointing at the selected commit.
  const [nestedCommits, setNestedCommits] = useState<LogEntry[]>([]);
  const [loadingNested, setLoadingNested] = useState(false);
  const [showNested, setShowNested] = useState(true);
  const [tagsHere, setTagsHere] = useState<{ name: string; annotated: boolean; tagger?: string; date?: string; message?: string }[]>([]);
  const [showFiles, setShowFiles] = useState(true);
  const [filesPage, setFilesPage] = useState(0);
  const [filesViewMode, setFilesViewMode] = useState<'list' | 'tree'>('list');
  const [expandedFileDirs, setExpandedFileDirs] = useState<Set<string>>(new Set());
  const [editingMessage, setEditingMessage] = useState(false);
  const [editMsgValue, setEditMsgValue] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  // Author filter — synced with the global selectionStore so the Toolbar chip
  // and other tools see the same filter (cleared there → cleared here too).
  const globalAuthorFilter = useSelectionStore((s) => s.authorFilter);
  const setGlobalAuthorFilter = useSelectionStore((s) => s.setAuthorFilter);
  const [authorFilter, setAuthorFilterLocal] = useState(globalAuthorFilter ?? '');
  const setAuthorFilter = (v: string) => {
    setAuthorFilterLocal(v);
    setGlobalAuthorFilter(v || null);
  };
  // Two-way: when the author filter is cleared/changed from the Toolbar chip
  useEffect(() => {
    const g = globalAuthorFilter ?? '';
    setAuthorFilterLocal((prev) => (prev === g ? prev : g));
  }, [globalAuthorFilter]);
  // "Recent" smart-view preset (last 7 days) — date-based, independent of author filter
  const [recentActive, setRecentActive] = useState(false);
  // "Tagged" smart-view preset — show only commits that have at least one tag
  // pointing at them (refs/tags/*). Mirrors the "Mine"/"Merges"/"Recent"
  // quick-filter pattern so the user can scope History to release points.
  const [taggedActive, setTaggedActive] = useState(false);
  // Cache of all tags in the repo (name + hash) — used for the Tagged filter
  // and the Tags header section. Loaded once per repo, refreshed on demand.
  const [allTags, setAllTags] = useState<{ name: string; hash: string }[]>([]);
  useEffect(() => {
    api.git.tags(repo.path).then(tags => {
      setAllTags(tags.map(t => ({ name: t.name, hash: t.hash })));
    }).catch(() => setAllTags([]));
  }, [repo.path]);
  // Current user's git config user.name — for "Mine" quick filter
  const [myAuthorName, setMyAuthorName] = useState('');
  useEffect(() => {
    api.git.configGet(repo.path, 'user.name').then(v => setMyAuthorName(v || '')).catch(() => {});
  }, [repo.path]);
  const [pathFilter, setPathFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchFilter, setBranchFilter] = useState<string>('head+upstream');
  // Multi-branch selection — stored GLOBALLY so the Toolbar shows the set and
  // other tools see the same branch scope (SmartGit: Log reflects ref selection).
  const selectedBranches = useSelectionStore((s) => s.selectedBranches);
  const toggleBranch = useSelectionStore((s) => s.toggleBranch);
  const clearBranches = useSelectionStore((s) => s.clearBranches);
  const [useRegex, setUseRegex] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  // Hash lookup: when the search query looks like a commit hash prefix and no loaded
  // commit matches, resolve it via git (works for commits outside the loaded window).
  const [hashHit, setHashHit] = useState<LogEntry | null>(null);
  // SmartGit Log groups: besides the commit graph the Log window shows
  // Local/Remote commits (the graph itself), Stashes and Recyclable Commits.
  // Stashes are shown by default; Recyclable commits are opt-in (SmartGit
  // manual: "Recyclable Commits checkbox").
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [recyclable, setRecyclable] = useState<RecyclableCommit[]>([]);
  const [showStashes, setShowStashes] = useState(true);
  const [showRecyclable, setShowRecyclable] = useState(false);
  const [cpBusyHash, setCpBusyHash] = useState<string | null>(null);
  const { width: detailWidth, handleResize: handleDetailResize } = useResizableWidth(320, 200, 600);
  const showContextMenu = useContextMenu();

  // ===== SmartGit integrations =====
  // Bugtraq: issue-tracker links in commit messages (.gitbugtraq / [bugtraq])
  const [bugtraq, setBugtraq] = useState<BugtraqConfig | null>(null);
  useEffect(() => {
    api.git.bugtraqConfig(repo.path).then(setBugtraq).catch(() => setBugtraq(null));
  }, [repo.path]);


  const scrollRef = useRef<HTMLDivElement>(null);
  // Global selection — selecting a commit here propagates to Tags, Annotate, etc.
  const selectCommit = useSelectionStore((s) => s.selectCommit);
  const selectBranch = useSelectionStore((s) => s.selectBranch);
  const selectTag = useSelectionStore((s) => s.selectTag);
  const globalPathFilter = useSelectionStore((s) => s.pathFilter);
  const setGlobalPathFilter = useSelectionStore((s) => s.setPathFilter);
  // When viewing file history (globalPathFilter is set), auto-expand Files section
  // so user immediately sees which file in the commit matches the filter.
  useEffect(() => {
    if (globalPathFilter) {
      setShowFiles(true);
    }
  }, [globalPathFilter]);
  // Global selected branch — when user clicks a branch in Branches page (with Ctrl),
  // it's stored here; we apply it as a filter on next load.
  const globalSelectedBranch = useSelectionStore((s) => s.selectedBranch);
  // Sync local branchFilter with global selectedBranch (two-way):
  //  - a branch picked in Branches/Toolbar → applied as filter here
  //  - selection cleared in Toolbar → filter resets to head+upstream (the
  //    new default — was 'all', but that loaded every branch's history and
  //    was slow on large repos; 'head+upstream' shows only the current
  //    branch and its remote tracking branch, which is what 90% of users
  //    want when they open the History page).
  useEffect(() => {
    if (globalSelectedBranch) {
      if (branchFilter !== globalSelectedBranch) setBranchFilter(globalSelectedBranch);
    } else if (branchFilter !== 'head+upstream' && selectedBranches.size === 0) {
      // Selection was cleared elsewhere and no multi-select is active
      setBranchFilter('head+upstream');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSelectedBranch]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    // Reset lazy-load state on every fresh load (filter change, repo switch,
    // manual refresh) — the user might now be looking at a different history.
    setHasMore(true);
    try {
      // Initial page: PAGE_SIZE commits (100). Lazy-load older pages on
      // scroll via loadMore(). Previously this loaded up to 500 commits
      // upfront, hiding anything older — the user could not scroll back to
      // the first commit. With paging, the user can scroll indefinitely.
      const logOpts: { maxCount: number; skip?: number; all?: boolean; branch?: string; branches?: string[]; file?: string; follow?: boolean } = { maxCount: PAGE_SIZE };
      // Resolve which refs to walk commits from. Priority:
      //   1. Multi-branch selection (Ctrl+click in Branches page).
      //   2. 'head+upstream' — default: HEAD branch + its remote-tracking
      //      branch (origin/<current>). Shows commits on the current branch
      //      AND any incoming commits from origin that haven't been merged
      //      yet — the most common view for "what's the state of my work
      //      vs. the remote". Much faster than --all (which walks every
      //      branch's history).
      //   3. 'all' — explicit "show every branch".
      //   4. Single named branch (e.g. 'main').
      if (selectedBranches.size > 0) {
        logOpts.branches = Array.from(selectedBranches);
      } else if (branchFilter === 'head+upstream') {
        // Resolve the HEAD branch and its upstream.
        // status.current is the local branch name (e.g. 'main'); status.tracking
        // is the upstream ref in 'origin/main' form.
        // We pass both to git log so the user sees:
        //   - commits reachable from HEAD (their local work)
        //   - commits reachable from origin/<branch> (incoming/pushed work)
        // Local-only commits are drawn solid; remote-only as dashed/hollow
        // (the existing incomingHashes logic tags them).
        const currentBranch = status?.current;
        const upstream = status?.tracking;
        const refs: string[] = [];
        if (currentBranch) refs.push(currentBranch);
        if (upstream && upstream !== currentBranch) refs.push(upstream);
        if (refs.length > 0) {
          logOpts.branches = refs;
        } else {
          // No current branch (detached HEAD) and no upstream — fall back
          // to HEAD so we at least show something.
          logOpts.branch = 'HEAD';
        }
      } else if (branchFilter === 'all' || !branchFilter) {
        logOpts.all = true;
      } else {
        logOpts.branch = branchFilter;
      }
      // File-history mode: when a global path filter is set (e.g. user clicked "View file history"
      // from Changes view), pass it to git log -- <path> with --follow to track renames.
      if (globalPathFilter) {
        logOpts.file = globalPathFilter;
        logOpts.follow = true;
      }
      const result = await api.git.log(repo.path, logOpts);
      setEntries(result);
      // Fetch commit stats for Activity Wave — non-blocking, runs after
      // entries paint. The wave shows heights based on additions+deletions.
      void api.git.commitStats(repo.path, { maxCount: result.length, branch: logOpts.branch }).then(stats => {
        setCommitStatsMap(stats);
      }).catch(() => { /* non-critical — wave just shows flat bars */ });
      // If we got fewer than PAGE_SIZE commits, there are no more to load.
      // Otherwise assume more exist (we'll discover the end on the next fetch).
      setHasMore(result.length >= PAGE_SIZE);
      // Compute incoming commits: reachable from remote-tracking refs
      // (refs/remotes/*) but NOT from any local branch (refs/heads/*).
      // These are "not yet pulled" commits — drawn dashed/hollow in graph.
      //
      // Run AFTER setEntries so the commit list renders immediately — the
      // incoming hashes are only used to TINT the rows that are remote-only,
      // which is a visual nicety the user can wait ~200ms for. Doing these
      // calls before setEntries was delaying the first paint by 500ms-2s on
      // large repos (rev-list --remotes --not --branches walks the entire
      // commit graph). Now: entries paint first, then incoming hashes
      // trickle in and update the row styling.
      void (async () => {
        try {
          // Run both rev-lists in parallel — they're independent and
          // previously ran sequentially, doubling latency.
          // localList is fetched but not currently used (kept for parity
          // with the original code which also computed it; may be needed
          // when we add "local-only" tinting in a future iteration).
          const [, remoteOnly] = await Promise.all([
            api.git.raw(repo.path, ['rev-list', '--branches']),
            api.git.raw(repo.path, ['rev-list', '--remotes', '--not', '--branches']),
          ]);
          // Commits reachable from remote-tracking branches but NOT from local branches
          // = commits that exist on the remote but haven't been pulled yet
          const incoming = new Set<string>();
          for (const line of remoteOnly.trim().split('\n')) {
            if (line.trim()) incoming.add(line.trim());
          }
          setIncomingHashes(incoming);
        } catch {
          setIncomingHashes(new Set());
        }
      })();
      // Load branches for the filter dropdown — also non-blocking.
      void api.git.branches(repo.path).then(setBranches).catch(() => {});
      // SmartGit Log groups — stashes and (opt-in) recyclable commits load
      // alongside the graph; failures degrade to empty sections.
      // Stashes are shown by default — load eagerly.
      api.git.stashList(repo.path).then((s) => setStashes(s)).catch(() => setStashes([]));
      // Recyclable commits are opt-in (showRecyclable=false by default) —
      // defer the expensive `git reflog --all` + `git rev-list --all` calls
      // until the user actually expands that section.
      // (Previously fired on every History page open, blocking UI for seconds
      //  on large repos for data the user wasn't viewing.)
      setSelectedIdx(0);
      // Preserve an existing global selection when it is still visible in the
      // (re)loaded log — clobbering it with the first commit broke other tools
      // (e.g. Notes "Add note" silently attached to the wrong commit).
      // Only fall back to the first commit when nothing is selected or the
      // selected commit is not part of the current filter result.
      if (result.length > 0) {
        const current = useSelectionStore.getState().selectedCommitHash;
        const idx = current ? result.findIndex((e) => e.hash === current) : -1;
        if (idx >= 0) {
          setSelectedIdx(idx);
        } else {
          selectCommit(result[0].hash);
        }
      }
    } catch (e) { toast.error(t('toast.history.loadFailed'), String(e)); }
    finally { setLoading(false); }
    // NOTE: status?.current / status?.tracking are intentionally in the
    // deps — when the user switches branches (or pulls/fetches new
    // upstream commits), the head+upstream filter needs to re-resolve to
    // the new branch name. Without these deps, switching from 'main' to
    // 'feature/x' would still show 'main' history.
  }, [repo.path, toast, branchFilter, selectedBranches, globalPathFilter, selectCommit, status?.current, status?.tracking]);

  // ── Lazy-load older commits on scroll ───────────────────────────────────
  // When the user scrolls near the bottom of the commit list, fetch the
  // next PAGE_SIZE commits using `git log --skip=<currentLen> -<PAGE_SIZE>`.
  // Append them to `entries` and update `hasMore` accordingly.
  //
  // NB: --skip is sensitive to filter changes — we re-derive the same
  // branch/file options as loadHistory. If filters change while a loadMore
  // is in-flight, the result is appended but may be momentarily out of
  // order; loadHistory() runs on filter change and resets the list, so this
  // self-corrects.
  const loadMore = useCallback(async () => {
    // Guard against duplicate fetches + the "no more pages" case.
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      // Snapshot the current entries length — we'll skip past these.
      const currentLen = entries.length;
      if (currentLen === 0) return; // nothing loaded yet — let loadHistory handle it
      const logOpts: { maxCount: number; skip: number; all?: boolean; branch?: string; branches?: string[]; file?: string; follow?: boolean } = {
        maxCount: PAGE_SIZE,
        skip: currentLen,
      };
      if (selectedBranches.size > 0) {
        logOpts.branches = Array.from(selectedBranches);
      } else if (branchFilter === 'head+upstream') {
        // Same ref-resolution as loadHistory — keep them in sync.
        const refs: string[] = [];
        if (status?.current) refs.push(status.current);
        if (status?.tracking && status.tracking !== status.current) refs.push(status.tracking);
        if (refs.length > 0) logOpts.branches = refs;
        else logOpts.branch = 'HEAD';
      } else if (branchFilter === 'all' || !branchFilter) {
        logOpts.all = true;
      } else {
        logOpts.branch = branchFilter;
      }
      if (globalPathFilter) {
        logOpts.file = globalPathFilter;
        logOpts.follow = true;
      }
      const nextPage = await api.git.log(repo.path, logOpts);
      if (nextPage.length === 0) {
        // No more commits — reached the end of history.
        setHasMore(false);
        return;
      }
      // Deduplicate: in rare cases (concurrent refresh + loadMore), git log
      // may return commits we already have. Filter by hash before appending.
      setEntries(prev => {
        const seen = new Set(prev.map(e => e.hash));
        const merged = [...prev, ...nextPage.filter(e => !seen.has(e.hash))];
        return merged;
      });
      // If we got fewer than PAGE_SIZE, this was the last page.
      setHasMore(nextPage.length >= PAGE_SIZE);
    } catch (e) {
      // Surface as toast so the user knows the next page failed to load —
      // otherwise they'd think the list "ended" when it actually didn't.
      toast.error(t('toast.history.loadMoreFailed'), String(e));
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, loading, entries.length, repo.path, branchFilter, selectedBranches, globalPathFilter, toast, status?.current, status?.tracking]);

  // Recyclable commits are opt-in — only load `git reflog --all` + `git rev-list --all`
  // when the user expands the section. Previously this fired on every History
  // page open and could block the UI for seconds on large repos.
  useEffect(() => {
    if (!showRecyclable) {
      setRecyclable([]);
      return;
    }
    let cancelled = false;
    api.git.recyclableCommits(repo.path)
      .then((r) => { if (!cancelled) setRecyclable(r); })
      .catch(() => { if (!cancelled) setRecyclable([]); });
    return () => { cancelled = true; };
  }, [showRecyclable, repo.path]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Task 7 — auto-refresh History ONLY after explicit user-initiated Pull /
  // Fetch / Push (NOT on every watcher-triggered refresh).
  //
  // ROOT CAUSE of "вечный рефреш": the file watcher fires on .git/index
  // changes → App.tsx scheduleRefresh() → refreshStatus() → bumps
  // `lastRefresh` → this useEffect re-runs → loadHistory() calls git log
  // → which reads .git/index → watcher fires again → infinite loop.
  //
  // Fix: subscribe to the `smartgit:history-refresh` event instead, which
  // is dispatched ONLY by explicit Pull/Fetch/Push handlers (App.tsx).
  // Watcher-triggered refreshes don't need to reload the whole git log
  // graph — they only need to update the Changes page file list (handled
  // separately via `useGitStore.status`).
  useEffect(() => {
    const handler = () => loadHistory();
    window.addEventListener('smartgit:history-refresh', handler);
    return () => window.removeEventListener('smartgit:history-refresh', handler);
  }, [loadHistory]);

  // User-configurable periodic auto-refresh — Settings → Git →
  // "Auto-refresh History page". When enabled, re-runs `git log` on this
  // cadence so new commits appear without manual refresh. When disabled
  // (default), NO periodic `git log` calls happen — the previous behaviour
  // re-ran git log on every lastRefresh bump which the user reported as
  // "летит огромное кол-во запросов". Min interval 30s.
  const autoRefreshHistory = useSettingsStore((s) => s.settings.autoRefreshHistory ?? false);
  const historyRefreshSec = useSettingsStore((s) => s.settings.historyAutoRefreshIntervalSec ?? 0);
  useEffect(() => {
    if (!autoRefreshHistory) return;
    if (!Number.isFinite(historyRefreshSec) || historyRefreshSec <= 0) return;
    const ms = Math.max(30, historyRefreshSec) * 1000;
    const id = setInterval(() => {
      // Only refresh when the document is visible — no point re-running
      // git log in a background tab.
      if (document.visibilityState === 'visible') {
        loadHistory();
      }
    }, ms);
    return () => clearInterval(id);
  }, [autoRefreshHistory, historyRefreshSec, loadHistory]);

  // Background fetch removed — it caused a double refresh on History open.
  // The initial loadHistory() already loads the log; the background fetch
  // would fetch all remotes (network call) then reload history again.
  // Users can manually Fetch via the toolbar button when needed.

  // ⚠ selectedIdx indexes the FILTERED list — resolving the hash against the
  // UNfiltered `entries` used to clobber selectedIdx with an out-of-range
  // index whenever a search/author/date filter was active: the detail panel
  // then showed "Select a commit" even though a row was clicked (found in the
  // merge-commit e2e). Effect lives below the `filtered` memo and resolves in
  // `filtered` space; if the commit is hidden by the LOCAL filters, clear them
  // so cross-tool navigation (tag click, commit link) still lands.
  const selectedCommitHash = useSelectionStore((s) => s.selectedCommitHash);
  const scrollToIndexRef = useRef<((idx: number) => void) | null>(null);

  // Search pool: loaded entries + (optionally) the commit resolved by hash prefix lookup.
  // The hit is prepended so it stays visible even when it's outside the loaded log window.
  const searchPool = useMemo(() => {
    if (hashHit && !entries.some(e => e.hash === hashHit.hash)) {
      return [hashHit, ...entries];
    }
    return entries;
  }, [entries, hashHit]);

  const filtered = useMemo(() => {
    let result = searchPool;
    // Text search (subject, author, hash) — supports regex.
    // Uses debouncedSearch to avoid re-filtering on every keystroke.
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.toLowerCase();
      if (useRegex) {
        try {
          const re = new RegExp(debouncedSearch, 'i');
          result = result.filter(e =>
            re.test(e.subject) || re.test(e.author.name) || re.test(e.hash)
          );
        } catch {
          // Invalid regex — fall back to literal
          result = result.filter(e =>
            e.subject.toLowerCase().includes(q) ||
            e.author.name.toLowerCase().includes(q) ||
            e.hash.toLowerCase().includes(q)
          );
        }
      } else {
        result = result.filter(e =>
          e.subject.toLowerCase().includes(q) ||
          e.author.name.toLowerCase().includes(q) ||
          e.hash.toLowerCase().includes(q)
        );
      }
    }
    // Author filter
    if (authorFilter.trim()) {
      const a = authorFilter.toLowerCase();
      result = result.filter(e => e.author.name.toLowerCase().includes(a) || e.author.email.toLowerCase().includes(a));
    }
    // Path filter — would require server-side git log -- path; we filter client-side by commitFiles lookup
    // For simplicity here we just leave path filter as a UI hint (the actual filtering happens via api.git.log with file option).
    // Date filters (ISO date strings)
    if (dateFrom) {
      const fromTs = new Date(dateFrom).getTime();
      if (!isNaN(fromTs)) result = result.filter(e => e.author.timestamp >= fromTs);
    }
    if (dateTo) {
      const toTs = new Date(dateTo).getTime() + 86400000; // end of day
      if (!isNaN(toTs)) result = result.filter(e => e.author.timestamp <= toTs);
    }
    // Tagged-only filter — show only commits that have at least one tag pointing
    // at them. `entry.refs` from `git log --decorate=full` contains entries
    // like "tag: refs/tags/v1.0.0" — we look for that prefix.
    if (taggedActive) {
      result = result.filter(e => e.refs.some(r => r.startsWith('tag:') || r.includes('refs/tags/')));
    }
    return result;
  }, [searchPool, debouncedSearch, authorFilter, pathFilter, dateFrom, dateTo, useRegex, taggedActive]);

  // Auto-scroll to the globally selected commit (set here or from another tool —
  // e.g. a tag click in Tags page). See the index-space warning above.
  // prevSelectedRef guards the filter-reset: only a NEW external selection may
  // clear filters — otherwise clearing would wipe the user's query mid-typing
  // whenever the currently selected commit falls outside their filter.
  const prevSelectedRef = useRef<string | null>(null);
  // Task 2 — pending scroll retry: when the user clicks a commit in
  // GlobalSearch while NOT on the History page, the action plants the
  // hash and navigates here. HistoryPage mounts, but the lazy list
  // might not have rows measured yet → scrollToIndex falls back to 0
  // (no-op). Retry a few times over the next 500ms until the lazy
  // list's offsets are populated.
  useEffect(() => {
    if (!selectedCommitHash || entries.length === 0) return;
    const idxF = filtered.findIndex(e => e.hash === selectedCommitHash);
    if (idxF >= 0) {
      prevSelectedRef.current = selectedCommitHash;
      if (idxF !== selectedIdx) {
        setSelectedIdx(idxF);
        // Scroll into view via lazyList's scrollToIndex (works with virtualized list)
        // Task 2 — retry the scroll a few times so the lazy list has time
        // to compute offsets even if entries just loaded.
        const tryScroll = (attempt: number) => {
          requestAnimationFrame(() => {
            scrollToIndexRef.current?.(idxF);
            // After the first attempt, the scrollTop should be set.
            // If the rows weren't measured yet (offsets all 0), retry.
            const el = listScrollRef.current;
            if (el && Math.abs(el.scrollTop - (idxF * ROW_HEIGHT)) > ROW_HEIGHT && attempt < 5) {
              setTimeout(() => tryScroll(attempt + 1), 100);
            }
          });
        };
        tryScroll(0);
      }
      return;
    }
    // The commit exists in the log but is hidden by local filters — reset them,
    // but ONLY for a fresh (cross-tool) selection, not while the user filters.
    if (prevSelectedRef.current !== selectedCommitHash) {
      prevSelectedRef.current = selectedCommitHash;
      if (debouncedSearch || authorFilter || dateFrom || dateTo) {
        setSearch('');
        setDebouncedSearch('');
        setAuthorFilter('');
        setDateFrom('');
        setDateTo('');
      }
    }
  }, [selectedCommitHash, entries, filtered, selectedIdx, debouncedSearch, authorFilter, dateFrom, dateTo]);

  const { rows: graphRows, maxLane } = useMemo(() => {
    if (!showGraph || filtered.length === 0) return { rows: [], maxLane: 0 };

    // If a filter is applied, the visible list is a subset of `entries`.
    // Hidden commits' children still point to them as parents — the lane-assignment
    // algorithm would wait for parents that never arrive. The ancestry resolver
    // walks up the true parent chain (from `entries`, the unfiltered list) and
    // rewires each hidden parent to its nearest visible ancestor. The link is
    // then drawn as a dashed line, signalling "there were commits here, but
    // they are filtered out".
    const hasFilter = filtered.length !== searchPool.length;
    if (hasFilter) {
      const ancestry = createAncestryResolver(filtered, searchPool);
      return computeGraph(filtered, { ancestry });
    }
    return computeGraph(filtered);
  }, [showGraph, filtered, searchPool]);

  // Keyboard navigation: j/k (or ArrowUp/Down) to move commit selection,
  // Esc to clear. Only when not typing in an input.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInInput) return;
      if (filtered.length === 0) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = selectedIdx === null ? 0 : Math.min(selectedIdx + 1, filtered.length - 1);
        setSelectedIdx(next);
        const entry = filtered[next];
        if (entry) {
          selectCommit(entry.hash);
          requestAnimationFrame(() => scrollToIndexRef.current?.(next));
        }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = selectedIdx === null ? filtered.length - 1 : Math.max(selectedIdx - 1, 0);
        setSelectedIdx(prev);
        const entry = filtered[prev];
        if (entry) {
          selectCommit(entry.hash);
          requestAnimationFrame(() => scrollToIndexRef.current?.(prev));
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedIdx(null);
        selectCommit(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filtered, selectedIdx, selectCommit]);

  // Debounced hash-prefix lookup: resolves commits outside the loaded log window
  // (log is capped at maxCount, so an old commit's hash would otherwise never match).
  useEffect(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!/^[0-9a-f]{4,40}$/.test(q)) {
      setHashHit(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const hit = await api.git.findCommit(repo.path, q);
        setHashHit(prev => (hit && !entries.some(e => e.hash === hit.hash)) ? hit : null);
      } catch {
        setHashHit(null);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [debouncedSearch, repo.path, entries]);

  // Jump straight to the hash-lookup hit: select it so the list + detail panel show it.
  const handledHashHitRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hashHit || handledHashHitRef.current === hashHit.hash) return;
    handledHashHitRef.current = hashHit.hash;
    const idx = filtered.findIndex(e => e.hash === hashHit.hash);
    if (idx >= 0) {
      setSelectedIdx(idx);
      selectCommit(hashHit.hash);
    }
  }, [hashHit, filtered, selectCommit]);

  const graphWidth = (maxLane + 1) * LANE_WIDTH + GRAPH_PAD * 2;

  // Virtualize the commit list — only render rows that are in the visible scroll window.
  // SVG graph is kept full-size (browser handles SVG efficiently), but commit rows
  // (which are heavy DOM elements with badges, buttons, etc.) are windowed.
  // overscan=6 — was 12, but on a 1080p viewport with ROW_HEIGHT=28, only
  // ~25 rows fit on screen. Overscan=12 means rendering ~49 rows total,
  // almost 2x what's visible. 6 keeps it tight (~37 rows) and avoids the
  // scroll-triggered re-render flash that 12 was causing.
  const lazyList = useLazyList({
    itemCount: graphRows.length,
    estimateRowHeight: ROW_HEIGHT,
    overscan: 6,
  });
  // Keep scrollToIndex in a ref so the auto-scroll useEffect (declared above) can call it
  // without creating a dependency cycle.
  scrollToIndexRef.current = lazyList.scrollToIndex;
  // Override scrollRef to use lazyList's ref (which tracks scroll position)
  const listScrollRef = lazyList.scrollRef;

  // ── Infinite scroll: detect when the user is near the bottom ─────────────
  // Attaches a 'scroll' listener to the list container. When scrollTop is
  // within ~3 viewports of the bottom AND there are more commits to load,
  // calls loadMore(). The useLazyList hook already tracks scroll position
  // for virtualization, but it doesn't expose scroll-bottom detection —
  // we use a separate listener here so we don't disturb virtualization.
  //
  // Threshold = max(300px, 3 * viewportHeight) from the bottom — early
  // enough that the next page is loaded before the user reaches the very
  // bottom, avoiding a visible "loading…" gap on fast scroll.
  //
  // We use a ref to hold the latest loadMore so the effect can be attached
  // ONCE (on mount) without re-attaching on every loadMore identity change
  // — re-attaching the scroll listener on every render would drop the
  // user's scroll position in some browsers.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  useEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const e = listScrollRef.current;
        if (!e) return;
        const distanceFromBottom = e.scrollHeight - e.scrollTop - e.clientHeight;
        const threshold = Math.max(300, e.clientHeight * 3);
        if (distanceFromBottom < threshold) {
          void loadMoreRef.current();
        }
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [listScrollRef]);

  useEffect(() => {
    if (selectedIdx === null || selectedIdx < 0) { setCommitFiles([]); return; }
    setFilesPage(0); // Reset pagination when commit changes
    const selected = filtered[selectedIdx];
    if (!selected) return;
    setLoadingFiles(true);
    api.git.commitFiles(repo.path, selected.hash)
      .then(setCommitFiles)
      .catch(() => setCommitFiles([]))
      .finally(() => setLoadingFiles(false));
    // Merge-commit enrichment: nested commits brought in by the merge +
    // annotated-tag metadata for tags pointing at this commit. Both are
    // empty/fast for regular commits, so they run on every selection.
    setLoadingNested(true);
    api.git.mergeNestedCommits(repo.path, selected.hash)
      .then(setNestedCommits)
      .catch(() => setNestedCommits([]))
      .finally(() => setLoadingNested(false));
    api.git.tagsAt(repo.path, selected.hash)
      .then(setTagsHere)
      .catch(() => setTagsHere([]));
  }, [selectedIdx, repo.path, filtered]);

  // GitHub Actions CI badges (Standard Window "My History" feature) — only for
  // GitHub repos with an authenticated user; batched per visible commits.
  const authUser = useAuthStore((s) => s.user);
  const [ciStatus, setCiStatus] = useState<Record<string, CommitCheckStatus>>({});
  const ciLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!authUser) return;
    // repo identity — resolve once
    let cancelled = false;
    let ownerRepo: { owner: string; repo: string } | null = null;
    api.git.extractRepoInfo(repo.path).then((info) => {
      if (cancelled) return;
      const m = info.webUrl?.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (m) ownerRepo = { owner: m[1], repo: m[2] };
    }).catch(() => {}).finally(() => {
      if (cancelled || !ownerRepo) return;
      // (Re)load CI status when the visible page of commits changes (debounced)
      if (ciLoadTimer.current) clearTimeout(ciLoadTimer.current);
      ciLoadTimer.current = setTimeout(async () => {
        const shas = filtered.slice(0, 25).map((c) => c.hash);
        if (shas.length === 0) return;
        try {
          const res = await api.github.getCheckRuns(ownerRepo!.owner, ownerRepo!.repo, shas);
          if (!cancelled) setCiStatus((prev) => ({ ...prev, ...res }));
        } catch { /* CI badges degrade silently */ }
      }, 800);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo.path, authUser, filtered.length]);

  // Git Notes badge for the selected commit
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  useEffect(() => {
    if (selectedIdx === null || selectedIdx < 0) { setSelectedNote(null); return; }
    const sel = filtered[selectedIdx];
    if (!sel) { setSelectedNote(null); return; }
    let cancelled = false;
    api.git.notesShow(repo.path, 'commits', sel.hash)
      .then((n) => { if (!cancelled) setSelectedNote(n && n.trim() ? n.trim() : null); })
      .catch(() => { if (!cancelled) setSelectedNote(null); });
    return () => { cancelled = true; };
  }, [selectedIdx, filtered, repo.path]);

  // SmartGit: while ANY sequencer state is in progress (cherry-pick / revert /
  // merge / rebase / bisect) no other HEAD-moving operation may start — it
  // would discard the unfinished work. We surface a single guard so the user
  // sees the same message + can Abort *right here* (no need to navigate to
  // Changes just to call `git merge --abort`).
  const blockedByRepoState = async (): Promise<boolean> => {
    if (!status) return false;
    const state =
      status.isMerging ? 'merge'
        : status.isRebasing ? 'rebase'
          : status.isCherryPicking ? 'cherry-pick'
            : status.isReverting ? 'revert'
              : status.isBisecting ? 'bisect'
                : null;
    if (!state) return false;
    const title =
      state === 'merge' ? t('history.blockedBy.mergeInProgress')
        : state === 'rebase' ? t('history.blockedBy.rebaseInProgress')
          : state === 'cherry-pick' ? t('history.blockedBy.cherryPickInProgress')
            : state === 'revert' ? t('history.blockedBy.revertInProgress')
              : t('history.blockedBy.bisectInProgress');
    // Offer an in-place Abort button — the user shouldn't have to leave
    // History just to discard a stale merge.
    const abortNow = await confirmDialog({
      title,
      message: t('history.blockedBy.message', { state }),
      confirmLabel: t('history.blockedBy.abortNow', { state }),
      cancelLabel: t('history.blockedBy.goToChanges'),
      danger: true,
    });
    if (abortNow) {
      try {
        switch (state) {
          case 'merge': await api.git.abortMerge(repo.path); break;
          case 'rebase': await api.git.rebase(repo.path, '', { abort: true }); break;
          case 'cherry-pick': await api.git.cherryPickAbort(repo.path); break;
          case 'revert': await api.git.revertAbort(repo.path); break;
          case 'bisect': await api.git.bisectReset(repo.path); break;
        }
        toast.success(t('history.blockedBy.aborted', { state }));
        await refreshStatus(repo.path);
        await loadHistory();
      } catch (e) { toast.error(t('toast.merge.abortStateFailed', { state }), String(e)); }
      return true;
    }
    // User clicked "Go to Changes" — navigate there so they can use the banner.
    window.location.hash = '#/changes';
    return true;
  };

  const handleCherryPick = async (entry: { hash: string; subject: string }) => {
    if (await blockedByRepoState()) return;
    if (!(await confirmDialog({
      title: t('history.cherryPickTitle', { hash: shortHash(entry.hash) }),
      message: t('history.cherryPickMessage', { subject: entry.subject }),
      confirmLabel: t('history.cherryPickAction'),
    }))) return;
    setCpBusyHash(entry.hash);
    try {
      const result = await api.git.cherryPick(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) {
        toast.warning(t('history.nConflicts', { count: result.conflicts.length }), t('history.cherryPickConflictsDetail'));
      } else if (result.empty) {
        toast.warning(
          t('history.cherryPickEmpty'),
          t('history.cherryPickEmptyDetail')
        );
      } else if (result.error) {
        toast.error(t('toast.cherryPick.failed'), result.error);
      } else {
        toast.success(t('toast.cherryPick.cherryPicked'));
      }
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error(t('toast.cherryPick.failed'), String(e)); }
    finally { setCpBusyHash(null); }
  };

  // Compare a commit with the current working tree — shows a diff dialog
  const [compareDiff, setCompareDiff] = useState<{ result: import('../lib/api').DiffResult; title: string } | null>(null);
  useEscapeKey(!!compareDiff, () => setCompareDiff(null));
  // FileHistoryViewer — opens when user clicks "View file history" on a file
  const [fileHistoryPath, setFileHistoryPath] = useState<string | null>(null);
  useEscapeKey(!!fileHistoryPath, () => setFileHistoryPath(null));

  const handleRevert = async (entry: LogEntry) => {
    if (await blockedByRepoState()) return;
    if (!(await confirmDialog({
      title: t('history.revertTitle', { hash: shortHash(entry.hash) }),
      message: t('history.revertMessage', { subject: entry.subject }),
      confirmLabel: t('history.revertAction'),
    }))) return;
    try {
      const result = await api.git.revert(repo.path, [entry.hash]);
      if (result.conflicts.length > 0) toast.warning(t('history.nConflicts', { count: result.conflicts.length }));
      else toast.success(t('toast.revert.reverted'));
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error(t('toast.revert.failed'), String(e)); }
  };

  const handleReset = async (hash: string, mode: 'soft' | 'mixed' | 'hard' | 'keep') => {
    if (await blockedByRepoState()) return;
    if (!(await confirmDialog({
      title: t('history.resetTitle', { hash: shortHash(hash), mode }),
      message: mode === 'hard'
        ? t('history.resetHardWarning')
        : t('history.resetMessage', { hash: shortHash(hash), mode }),
      confirmLabel: t('history.resetAction'),
      danger: mode === 'hard',
    }))) return;
    try {
      await api.git.reset(repo.path, mode, hash);
      toast.success(t('toast.reset.success', { mode, hash: shortHash(hash) }));
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error(t('toast.reset.failed'), String(e)); }
  };

  const handleRebase = async (hash: string) => {
    if (await blockedByRepoState()) return;
    if (!(await confirmDialog({
      title: t('history.rebaseTitle'),
      message: t('history.rebaseMessage', { hash: shortHash(hash) }),
      confirmLabel: t('history.rebaseAction'),
    }))) return;
    try {
      await api.git.rebase(repo.path, hash);
      toast.success(t('toast.merge.rebaseStarted'));
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error(t('toast.merge.rebaseFailed'), String(e)); }
  };

  // Full commit diff via git diff <hash>^..<hash> — rendered in the compare modal
  const handleShowCommitDiff = async (entry: LogEntry) => {
    try {
      const result = await api.git.diffCommit(repo.path, entry.hash);
      setCompareDiff({ result, title: t('history.commitVsParent', { hash: shortHash(entry.hash) }) });
    } catch (e) { toast.error(t('toast.history.commitDiffFailed'), String(e)); }
  };

  // VS Code: open the full commit patch (git show) as a highlighted .patch file
  const handleOpenCommitPatch = async (entry: LogEntry) => {
    try {
      const res = await api.vscode.openCommitPatch(repo.path, entry.hash);
      if (res.ok) toast.success(t('toast.vscode.opened'));
      else toast.error(res.detail || t('history.vscodeCliNotFound'));
    } catch (e) { toast.error(t('toast.vscode.openFailed'), String(e)); }
  };

  // Start an interactive rebase stopped at this commit ('edit') — the user then
  // splits the commit by staging parts and continuing via the Rebase panel.
  const handleStartSplitCommit = async (entry: LogEntry) => {
    if (!(await confirmDialog({
      title: t('history.splitTitle', { hash: shortHash(entry.hash) }),
      message: t('history.splitMessage'),
      confirmLabel: t('history.splitAction'),
    }))) return;
    try {
      const res = await api.git.splitCommit(repo.path, entry.hash);
      if (res.started) {
        toast.success(t('toast.merge.startEditStarted'));
        await refreshStatus(repo.path); await loadHistory();
      } else {
        toast.error(t('toast.merge.splitStartFailed'), res.message);
      }
    } catch (e) { toast.error(t('toast.merge.splitFailed'), String(e)); }
  };

  // Split-off dialog: move the selected files from this commit into a NEW commit
  // that is created right after it (git rebase --onto machinery via splitOffFiles).
  const [showSplitOff, setShowSplitOff] = useState(false);
  useEscapeKey(showSplitOff, () => setShowSplitOff(false));
  const [splitOffEntry, setSplitOffEntry] = useState<LogEntry | null>(null);
  const [splitOffSelected, setSplitOffSelected] = useState<Set<string>>(new Set());
  const [splitOffMessage, setSplitOffMessage] = useState('');
  const [splitOffFileList, setSplitOffFileList] = useState<CommitFile[]>([]);
  const [splitOffBusy, setSplitOffBusy] = useState(false);

  const handleOpenSplitOff = (entry: LogEntry) => {
    setSplitOffEntry(entry);
    setSplitOffSelected(new Set());
    setSplitOffMessage(t('history.splitOffInitialMsg', { subject: entry.subject }));
    setShowSplitOff(true);
    api.git.commitFiles(repo.path, entry.hash)
      .then(setSplitOffFileList)
      .catch(() => setSplitOffFileList([]));
  };

  const handleSplitOffExecute = async () => {
    if (!splitOffEntry) return;
    if (splitOffSelected.size === 0) { toast.warning(t('toast.merge.selectFileRequired')); return; }
    if (!splitOffMessage.trim()) { toast.warning(t('toast.merge.messageRequired')); return; }
    setSplitOffBusy(true);
    try {
      await api.git.splitOffFiles(repo.path, splitOffEntry.hash, Array.from(splitOffSelected), splitOffMessage.trim());
      toast.success(t('toast.merge.splitMoved', { count: splitOffSelected.size }));
      setShowSplitOff(false);
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error(t('toast.merge.splitOffFailed'), String(e)); }
    finally { setSplitOffBusy(false); }
  };

  const handleCheckout = async (hash: string) => {
    if (await blockedByRepoState()) return;
    if (!(await confirmDialog({
      title: t('history.checkoutTitle', { hash: shortHash(hash) }),
      message: t('history.checkoutMessage'),
      confirmLabel: t('history.checkoutAction'),
    }))) return;
    try {
      await api.git.checkout(repo.path, hash);
      toast.success(t('toast.git.checkoutSuccess', { ref: shortHash(hash) }));
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error(t('toast.git.checkoutFailed'), String(e)); }
  };

  const handleEditMessage = (entry: LogEntry) => {
    setEditingMessage(true);
    setEditMsgValue(`${entry.subject}\n\n${entry.body}`.trim());
  };

  const handleSaveMessage = async () => {
    if (selectedIdx === null) return;
    const selected = filtered[selectedIdx];
    if (!selected) return;
    try {
      await api.git.editCommitMessage(repo.path, selected.hash, editMsgValue);
      toast.success(t('toast.edit.messageUpdated'));
      setEditingMessage(false);
      await loadHistory();
    } catch (e) { toast.error(t('toast.generic.failed'), String(e)); }
  };

  const handleEditAuthor = async (entry: LogEntry) => {
    const value = await promptDialog({
      title: t('history.editAuthorTitle'),
      message: t('history.editAuthorMessage', { hash: shortHash(entry.hash), author: entry.author.name, email: entry.author.email }),
      input: { initialValue: `${entry.author.name} <${entry.author.email}>` },
    });
    if (!value) return;
    const m = value.match(/^([^<]+)<([^>]+)>\s*$/);
    if (!m) { toast.error(t('toast.git.invalidFormat'), t('history.authorFormatHint')); return; }
    try {
      await api.git.editCommitAuthor(repo.path, entry.hash, m[1].trim(), m[2].trim());
      toast.success(t('toast.edit.authorUpdated'));
      await loadHistory();
    } catch (e) { toast.error(t('toast.edit.authorFailed'), String(e)); }
  };

  const handleAddNote = async (entry: LogEntry) => {
    const existing = await api.git.notesShow(repo.path, 'commits', entry.hash).catch(() => null);
    const message = await promptDialog({
      title: existing ? t('history.editNoteTitle') : t('history.addNoteTitle'),
      message: t('history.noteMessage', { hash: shortHash(entry.hash) }),
      input: { initialValue: existing ?? '' },
    });
    if (message === null) return;
    if (message.trim() === '') {
      if (existing) {
        try { await api.git.notesRemove(repo.path, 'commits', entry.hash); toast.success(t('toast.edit.noteRemoved')); }
        catch (e) { toast.error(t('toast.edit.noteRemoveFailed'), String(e)); }
      }
      return;
    }
    try {
      await api.git.notesAdd(repo.path, 'commits', entry.hash, message.trim(), true);
      toast.success(t('history.noteSaved'));
      await loadHistory();
    } catch (e) { toast.error(t('history.saveNoteFailed'), String(e)); }
  };

  const handleFormatPatch = async (entry: LogEntry) => {
    const outDir = await promptDialog({
      title: t('history.formatPatchTitle'),
      message: t('history.formatPatchMessage', { hash: shortHash(entry.hash) }),
      input: { initialValue: `${repo.path}/patches` },
    });
    if (!outDir) return;
    try {
      const files = await api.git.formatPatch(repo.path, { outputDir: outDir, commit: entry.hash });
      await confirmDialog({ title: t('history.formatPatchTitle'), message: t('history.formatPatchWritten', { files: files.join('\n') }), confirmLabel: t('history.closeAction'), hideCancel: true });
    } catch (e) { toast.error(t('history.formatPatchFailed'), String(e)); }
  };

  const handleOpenInBrowser = async () => {
    if (selectedIdx === null) return;
    const selected = filtered[selectedIdx];
    if (!selected) return;
    try {
      const info = await api.git.extractRepoInfo(repo.path);
      if (info.webUrl) api.app.openExternal(`${info.webUrl}/commit/${selected.hash}`);
      else toast.info(t('history.noRemoteUrl'));
    } catch (e) { toast.error(t('toast.generic.failed'), String(e)); }
  };

  const showCommitContextMenu = async (e: React.MouseEvent, entry: LogEntry, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedIdx(idx);
    // Load tags pointing at THIS commit (not the currently selected one) so
    // the context menu can offer Edit/Delete actions for them.
    let commitTags: { name: string; annotated: boolean; tagger?: string; date?: string; message?: string }[] = [];
    try {
      commitTags = await api.git.tagsAt(repo.path, entry.hash);
    } catch { /* ignore — empty tag list */ }

    const items: ContextMenuItem[] = [
      { label: t('history.cherryPick'), clickId: 'cherry-pick' },
      { label: t('history.revertCommit'), clickId: 'revert' },
      { type: 'separator' },
      // Bisect — mark this commit as good/bad for binary search
      { label: '🔬 Mark Good (Bisect)', clickId: 'bisect-good' },
      { label: '🐛 Mark Bad (Bisect)', clickId: 'bisect-bad' },
      { type: 'separator' },
      { label: t('history.checkoutDetached'), clickId: 'checkout' },
      { type: 'separator' },
      { label: t('history.resetToThis'), clickId: 'reset-header' },
      { label: t('history.resetSoft'), clickId: 'reset-soft' },
      { label: t('history.resetMixed'), clickId: 'reset-mixed' },
      { label: t('history.resetHard'), clickId: 'reset-hard' },
      { label: t('history.resetKeep'), clickId: 'reset-keep' },
      { type: 'separator' },
      { label: t('history.rebaseOnto'), clickId: 'rebase' },
      { type: 'separator' },
      { label: t('history.createTagHere'), clickId: 'create-tag' },
      { label: t('history.createBranchHere'), clickId: 'create-branch' },
    ];
    // If tags point at this commit, add Edit/Delete actions for each.
    // Annotated tags can be edited (message); lightweight tags can only be deleted.
    if (commitTags.length > 0) {
      items.push({ type: 'separator' });
      for (const tag of commitTags) {
        const label = tag.annotated
          ? t('history.editTag', { name: tag.name })
          : t('history.tagLightweight', { name: tag.name });
        items.push({ label, clickId: `edit-tag:${tag.name}` });
        items.push({ label: t('history.deleteTag', { name: tag.name }), clickId: `delete-tag:${tag.name}` });
      }
    }
    items.push(
      { type: 'separator' },
      { label: t('history.openInDiff'), clickId: 'open-in-diff' },
      { label: t('history.compareWithWT'), clickId: 'compare-wt' },
      { label: t('history.showFullDiff'), clickId: 'show-commit-diff' },
      { label: t('history.openPatchInVSCode'), clickId: 'open-vscode-patch' },
      { type: 'separator' },
      { label: t('history.splitOffFiles'), clickId: 'split-off' },
      { label: t('history.startInteractiveEdit'), clickId: 'split-commit' },
      { type: 'separator' },
      { label: t('history.addNote'), clickId: 'add-note' },
      { label: t('history.showNote'), clickId: 'show-note' },
      { label: t('history.removeNote'), clickId: 'remove-note' },
      { type: 'separator' },
      { label: t('history.copyShortHash'), clickId: 'copy-short' },
      { label: t('history.copyFullHash'), clickId: 'copy-full' },
      { label: t('history.copyCommitMessage'), clickId: 'copy-msg' },
      { type: 'separator' },
      { label: t('history.editCommitMessage'), clickId: 'edit-msg' },
      { label: t('history.editCommitAuthor'), clickId: 'edit-author' },
      { type: 'separator' },
      { label: t('history.formatPatch'), clickId: 'format-patch' },
      { label: t('history.openInBrowser'), clickId: 'browser' },
    );
    showContextMenu(items, async (action) => {
      // Tag actions — dynamic clickId with tag name encoded after ':'
      if (action.startsWith('edit-tag:')) {
        const tagName = action.slice('edit-tag:'.length);
        handleEditTag(tagName, entry);
        return;
      }
      if (action.startsWith('delete-tag:')) {
        const tagName = action.slice('delete-tag:'.length);
        handleDeleteTag(tagName);
        return;
      }
      switch (action) {
        case 'cherry-pick': handleCherryPick(entry); break;
        case 'revert': handleRevert(entry); break;
        case 'bisect-good':
          try { await api.git.bisectGood(repo.path, entry.hash); toast.success('Marked good — bisect continues'); await refreshStatus(repo.path); }
          catch (e) { toast.error('Bisect failed', String(e)); }
          break;
        case 'bisect-bad':
          try { await api.git.bisectBad(repo.path, entry.hash); toast.success('Marked bad — bisect continues'); await refreshStatus(repo.path); }
          catch (e) { toast.error('Bisect failed', String(e)); }
          break;
        case 'checkout': handleCheckout(entry.hash); break;
        case 'reset-soft': handleReset(entry.hash, 'soft'); break;
        case 'reset-mixed': handleReset(entry.hash, 'mixed'); break;
        case 'reset-hard': handleReset(entry.hash, 'hard'); break;
        case 'reset-keep': handleReset(entry.hash, 'keep'); break;
        case 'rebase': handleRebase(entry.hash); break;
        case 'create-tag': handleCreateTag(entry); break;
        case 'create-branch': handleCreateBranchAt(entry); break;
        case 'open-in-diff': {
          // SmartGit Manual: "Open in Diff tool" — compare the commit's changes
          // (commit^ vs commit) so the Diff tool shows exactly what this commit
          // changed, NOT the working tree state vs the commit.
          useSelectionStore.getState().selectCommit(entry.hash);
          useSelectionStore.getState().selectFile('.');
          useSelectionStore.getState().setDiffRequest({
            baseRef: `${entry.hash}^`,
            compareRef: entry.hash,
            filePath: '.',
          });
          window.location.hash = '#/diff';
          break;
        }
        case 'compare-wt': {
          // Compare with Working Tree — shows commit vs current working tree
          useSelectionStore.getState().selectCommit(entry.hash);
          useSelectionStore.getState().selectFile('.');
          window.location.hash = '#/diff';
          break;
        }
        case 'copy-short': copyToClipboard(shortHash(entry.hash)); toast.success(t('history.copied')); break;
        case 'copy-full': copyToClipboard(entry.hash); toast.success(t('history.copied')); break;
        case 'copy-msg': copyToClipboard(entry.subject); toast.success(t('history.copied')); break;
        case 'edit-msg': handleEditMessage(entry); break;
        case 'edit-author': handleEditAuthor(entry); break;
        case 'add-note': handleAddNote(entry); break;
        case 'format-patch': handleFormatPatch(entry); break;
        case 'browser': handleOpenInBrowser(); break;
        case 'show-commit-diff': handleShowCommitDiff(entry); break;
        case 'open-vscode-patch': handleOpenCommitPatch(entry); break;
        case 'split-off': handleOpenSplitOff(entry); break;
        case 'split-commit': handleStartSplitCommit(entry); break;
        case 'show-note': handleShowNote(entry); break;
        case 'remove-note': handleRemoveNote(entry); break;
      }
    });
  };

  // Git Notes — SmartGit Manual: Notes with custom categories

  const handleShowNote = async (entry: LogEntry) => {
    try {
      const note = await api.git.noteShow(repo.path, entry.hash);
      if (note.trim()) {
        toast.info(t('history.noteFor', { hash: shortHash(entry.hash) }), note);
      } else {
        toast.info(t('history.noNote'));
      }
    } catch (e) { toast.error(t('history.noteLoadFailed'), String(e)); }
  };

  const handleRemoveNote = async (entry: LogEntry) => {
    if (!(await confirmDialog({
      title: t('history.removeNoteTitle'),
      message: t('history.removeNoteMessage', { hash: shortHash(entry.hash) }),
      confirmLabel: t('history.removeAction'),
      danger: true,
    }))) return;
    try {
      await api.git.noteRemove(repo.path, entry.hash);
      toast.success(t('toast.edit.noteRemoved'));
    } catch (e) { toast.error(t('history.noteRemoveFailed'), String(e)); }
  };

  // Tag-from-commit dialog state
  const [showTagDialog, setShowTagDialog] = useState(false);
  useEscapeKey(showTagDialog, () => setShowTagDialog(false));
  const [tagTarget, setTagTarget] = useState<string | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const [tagAnnotated, setTagAnnotated] = useState(true);

  const handleCreateTag = (entry: LogEntry) => {
    setTagTarget(entry.hash);
    setTagName('');
    setTagMessage('');
    setTagAnnotated(true);
    setEditingTagName(null);
    setShowTagDialog(true);
  };

  const handleSaveTag = async () => {
    if (!tagTarget || !tagName.trim()) return;
    try {
      // When editing (editingTagName is set), use force=true to overwrite
      // the existing tag at the same commit with the new message.
      const force = !!editingTagName;
      await api.git.createTag(repo.path, tagName.trim(), tagMessage || undefined, tagTarget, force, tagAnnotated);
      toast.success(
        force ? t('history.tagUpdatedToast', { name: tagName }) : t('history.tagCreatedToast', { name: tagName }),
        t('history.tagPointsTo', { hash: shortHash(tagTarget) })
      );
      setShowTagDialog(false);
      setEditingTagName(null);
      await loadHistory();
    } catch (e) { toast.error(t('history.tagCreateFailed'), String(e)); }
  };

  // Edit an existing tag's message (annotated tags only). Re-creates the tag
  // with force=true at the same commit so the message is updated. Lightweight
  // tags have no message to edit — the menu offers Delete instead.
  const handleEditTag = async (tagName: string, entry: LogEntry) => {
    // Fetch the existing tag's annotation (if annotated) to pre-fill the dialog
    try {
      const tags = await api.git.tagsAt(repo.path, entry.hash);
      const existing = tags.find(t => t.name === tagName);
      const isAnnotated = existing?.annotated ?? false;
      if (!isAnnotated) {
        toast.info(t('history.lightweightTagTitle'), t('history.lightweightTagMessage', { name: tagName }));
        return;
      }
      // Open the tag dialog in "edit" mode — pre-fill name + message,
      // reuse the same dialog as Create (save uses force=true when editing).
      setTagTarget(entry.hash);
      setTagName(tagName);
      setTagMessage(existing?.message ?? '');
      setTagAnnotated(true);
      setEditingTagName(tagName);
      setShowTagDialog(true);
    } catch (e) { toast.error(t('history.tagLoadFailed'), String(e)); }
  };

  // Track whether the dialog is in edit mode (vs create). When set, handleSaveTag
  // uses force=true to overwrite the existing tag at the same commit.
  const [editingTagName, setEditingTagName] = useState<string | null>(null);

  const handleDeleteTag = async (tagName: string) => {
    if (!(await confirmDialog({
      title: t('history.deleteTagConfirmTitle', { name: tagName }),
      message: t('history.deleteTagConfirmMsg'),
      confirmLabel: t('history.deleteTagButton'),
      danger: true,
    }))) return;
    try {
      await api.git.deleteTag(repo.path, tagName);
      toast.success(t('history.tagDeletedToast', { name: tagName }));
      await loadHistory();
    } catch (e) { toast.error(t('history.tagDeleteFailed'), String(e)); }
  };

  // Branch-from-commit dialog state
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  useEscapeKey(showBranchDialog, () => setShowBranchDialog(false));
  const [branchTarget, setBranchTarget] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('');
  const [branchCheckout, setBranchCheckout] = useState(true);

  const handleCreateBranchAt = (entry: LogEntry) => {
    setBranchTarget(entry.hash);
    setBranchName('');
    setBranchCheckout(true);
    setShowBranchDialog(true);
  };

  const handleSaveBranch = async () => {
    if (!branchTarget || !branchName.trim()) return;
    try {
      await api.git.createBranch(repo.path, branchName.trim(), branchTarget);
      if (branchCheckout) await api.git.checkout(repo.path, branchName.trim());
      toast.success(t('history.branchCreatedToast', { name: branchName }), t('history.branchFrom', { hash: shortHash(branchTarget) }));
      setShowBranchDialog(false);
      await loadHistory();
    } catch (e) { toast.error(t('history.branchCreateFailed'), String(e)); }
  };

  // ===== SmartGit Log groups: Stashes + Recyclable Commits — row actions =====
  const handleStashApply = async (s: StashEntry) => {
    try {
      await useOperationLogStore.getState().logOperation(
        `Apply Stash {${s.index}}`, repo.path, `git stash apply stash@{${s.index}}`,
        () => api.git.stashApply(repo.path, s.index)
      );
      toast.success(t('toast.stash.applied'));
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error(t('toast.stash.applyFailed'), String(e)); }
  };
  const handleStashPop = async (s: StashEntry) => {
    try {
      await useOperationLogStore.getState().logOperation(
        `Pop Stash {${s.index}}`, repo.path, `git stash pop stash@{${s.index}}`,
        () => api.git.stashPop(repo.path, s.index)
      );
      toast.success(t('toast.stash.popped'));
      await refreshStatus(repo.path); await loadHistory();
    } catch (e) { toast.error(t('toast.stash.popFailed'), String(e)); }
  };
  const handleStashDrop = async (s: StashEntry) => {
    if (!(await confirmDialog({
      title: t('history.dropStashTitle', { index: s.index }),
      message: t('history.dropStashMessage', { message: s.message }),
      confirmLabel: t('history.dropAction'),
      danger: true,
    }))) return;
    try {
      await useOperationLogStore.getState().logOperation(
        `Drop Stash {${s.index}}`, repo.path, `git stash drop stash@{${s.index}}`,
        () => api.git.stashDrop(repo.path, s.index)
      );
      toast.success(t('toast.stash.dropped'));
      await loadHistory();
    } catch (e) { toast.error(t('toast.stash.dropFailed'), String(e)); }
  };
  const handleRecyclableBranch = async (c: RecyclableCommit) => {
    const name = await promptDialog({
      title: t('history.recyclableBranchTitle'),
      message: t('history.recyclableBranchMessage', { hash: shortHash(c.hash) }),
      input: { initialValue: `recover/${c.hash.substring(0, 8)}` },
    });
    if (!name) return;
    try {
      await api.git.createBranch(repo.path, name, c.hash);
      toast.success(t('history.branchCreatedToast', { name }), t('history.branchFrom', { hash: shortHash(c.hash) }));
      await loadHistory();
    } catch (e) { toast.error(t('history.branchCreateFailed'), String(e)); }
  };
  const handleShowCommit = (hash: string) => {
    // Highlight the commit in the graph (when reachable from a loaded ref)
    useSelectionStore.getState().selectCommit(hash);
    setSelectedIdx(filtered.findIndex((e) => e.hash === hash));
  };

  const selected = selectedIdx !== null && selectedIdx >= 0 ? filtered[selectedIdx] : null;
  const hasUncommitted = status && !status.isClean;
  const wtOffset = hasUncommitted ? ROW_HEIGHT : 0;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* RepoStateBanner — same as in DiffPage and ChangesPage: surfaces the
          Continue/Abort/Mark HEAD/etc. actions for any in-progress git state
          (merge / rebase / cherry-pick / revert / bisect). Renders nothing
          when the working tree is idle. */}
      <RepoStateBanner
        status={status}
        busy={false}
        handlers={buildRepoStateHandlers(
          repo.path,
          (args) => api.git.raw(repo.path, args),
          () => refreshStatus(repo.path),
          toast,
        )}
      />
      {/* Bisect status banner — shown when bisect is in progress.
          Shows the current commit being tested + remaining steps.
          Right-click any commit → "Mark Good/Bad" to step through. */}
      {status?.isBisecting && (
        <div className="flex items-center gap-2 px-3 py-1 bg-status-info/10 border-b border-status-info/30 text-xs">
          <span className="text-status-info font-medium">🔬 Bisecting</span>
          <span className="text-text-tertiary">·</span>
          <span className="text-text-secondary">
            Right-click a commit → Mark Good/Bad to narrow down the bug.
          </span>
          <span className="text-text-tertiary ml-auto">Use Bisect page for full control</span>
        </div>
      )}
      {/* Activity Wave — visual timeline of commit sizes.
          Each bar = one commit, height = lines changed (sqrt-scaled).
          Click a spike to jump to that commit. */}
      <ActivityWave
        commits={filtered}
        selectedHash={selectedIdx !== null ? filtered[selectedIdx]?.hash : null}
        onSelect={(hash) => {
          const idx = filtered.findIndex(e => e.hash === hash);
          if (idx !== -1) setSelectedIdx(idx);
        }}
        commitStats={commitStatsMap}
        height={48}
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default bg-bg-tertiary" style={{ height: 32 }}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">Graph</span>
          <span className="text-2xs text-text-tertiary">{filtered.length} commits</span>
          {/* Incoming count badge — shows how many remote-only commits are visible */}
          {(() => {
            const visibleIncoming = filtered.filter(e => incomingHashes.has(e.hash)).length;
            if (visibleIncoming === 0) return null;
            return (
              <span className="text-2xs px-1.5 py-0.5 rounded border border-dashed border-status-info text-status-info font-medium flex items-center gap-0.5"
                title={`${visibleIncoming} incoming commit(s) — exist on remote but not yet pulled`}>
                ↓ {visibleIncoming} incoming
              </span>
            );
          })()}
          {(authorFilter || dateFrom || dateTo || pathFilter || useRegex) && (
            <span className="text-2xs text-accent flex items-center gap-1" title="Active filters">
              <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block" />filtered
            </span>
          )}
          {selectedBranches.size > 0 && (
            <div className="flex items-center gap-1 ml-2">
              {Array.from(selectedBranches).slice(0, 3).map(b => (
                <span key={b} className="text-2xs px-1.5 py-0.5 rounded border border-accent/40 bg-accent-muted text-accent flex items-center gap-1">
                  <GitBranch size={8} />{b}
                  <button onClick={() => toggleBranch(b)} title="Remove">
                    <X size={8} />
                  </button>
                </span>
              ))}
              {selectedBranches.size > 3 && (
                <span className="text-2xs text-text-tertiary">+{selectedBranches.size - 3} more</span>
              )}
            </div>
          )}
          {globalPathFilter && (
            <span className="text-2xs px-1.5 py-0.5 rounded border border-status-modified/40 bg-status-modified/10 text-status-modified flex items-center gap-1 ml-2">
              <FileText size={9} />{globalPathFilter}
              <button onClick={() => setGlobalPathFilter(null)} title="Clear file filter">
                <X size={8} />
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <FilterInput
            value={search}
            onChange={setSearch}
            placeholder={useRegex ? 'Regex...' : 'Filter / hash...'}
            ariaLabel="Filter commits"
            isRegex={useRegex}
            onToggleRegex={() => setUseRegex(!useRegex)}
            regexTitle="Toggle regex"
          />
          <button className={cn('icon-btn !w-5 !h-5', showFilters && 'active')}
            title="More filters" onClick={() => setShowFilters(!showFilters)}>
            <Filter size={11} />
          </button>
          {/* Quick-filter chips — one-click filters without expanding the panel */}
          <div className="flex items-center gap-1">
            <button
              className={cn('text-2xs px-1.5 py-0.5 rounded border transition-colors',
                authorFilter === myAuthorName && myAuthorName ? 'border-accent bg-accent-muted text-accent' : 'border-border-default bg-bg-tertiary text-text-secondary hover:bg-bg-hover')}
              onClick={() => setAuthorFilter(authorFilter ? '' : myAuthorName)}
              title="Show only my commits"
            >
              Mine
            </button>
            <button
              className={cn('text-2xs px-1.5 py-0.5 rounded border transition-colors',
                search.toLowerCase() === 'merge' ? 'border-accent bg-accent-muted text-accent' : 'border-border-default bg-bg-tertiary text-text-secondary hover:bg-bg-hover')}
              onClick={() => setSearch(search.toLowerCase() === 'merge' ? '' : 'merge')}
              title="Show only merge commits"
            >
              Merges
            </button>
            {/* Tagged-only filter — show only commits that have at least one tag
                pointing at them (refs/tags/*). Useful for finding release points. */}
            <button
              className={cn('text-2xs px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1',
                taggedActive ? 'border-accent bg-accent-muted text-accent' : 'border-border-default bg-bg-tertiary text-text-secondary hover:bg-bg-hover')}
              onClick={() => setTaggedActive(!taggedActive)}
              title={taggedActive ? 'Showing only tagged commits — click to clear' : 'Show only commits with a tag (release points)'}
            >
              <TagIcon size={10} />
              Tagged{allTags.length > 0 ? ` (${allTags.length})` : ''}
            </button>
          </div>

          <button className={cn('icon-btn !w-5 !h-5', showGraph && 'active')}
            title="Toggle graph" onClick={() => setShowGraph(!showGraph)}>
            <GitBranch size={11} />
          </button>
          <button className="icon-btn !w-5 !h-5" title="Refresh" onClick={loadHistory}>
            <RefreshCw size={11} />
          </button>
        </div>
      </div>

      {/* Extended filters panel */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border-default bg-bg-secondary text-2xs">
          {/* Multi-branch picker */}
          <div className="relative">
            <button
              className={cn('text-xs px-2 py-0.5 border rounded flex items-center gap-1',
                selectedBranches.size > 0
                  ? 'border-accent bg-accent-muted text-accent'
                  : 'border-border-default bg-bg-tertiary text-text-secondary')}
              onClick={() => setShowBranchPicker(!showBranchPicker)}
            >
              <GitBranch size={10} />
              Branches: {selectedBranches.size > 0 ? `${selectedBranches.size} selected` : (branchFilter === 'all' ? 'All' : branchFilter === 'head+upstream' ? 'Head + Upstream' : branchFilter)}
              <ChevronDown size={9} />
            </button>
            {showBranchPicker && (
              <div className="absolute top-full left-0 mt-1 bg-bg-elevated border border-border-default rounded shadow-lg z-50 max-h-72 overflow-y-auto min-w-64">
                {/* Head + Upstream option — the new default. Shows only the
                    current local branch + its remote-tracking branch. */}
                <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer text-xs border-b border-border-subtle">
                  <input
                    type="radio"
                    checked={selectedBranches.size === 0 && branchFilter === 'head+upstream'}
                    onChange={() => {
                      clearBranches();
                      setBranchFilter('head+upstream');
                      setShowBranchPicker(false);
                    }}
                  />
                  <span className="font-medium">Head + Upstream</span>
                  {status?.tracking && (
                    <span className="text-2xs text-text-tertiary ml-auto truncate max-w-32" title={status.tracking}>
                      {status.current} → {status.tracking}
                    </span>
                  )}
                </label>
                {/* All branches option — clears selection */}
                <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-bg-hover cursor-pointer text-xs border-b border-border-subtle">
                  <input
                    type="radio"
                    checked={selectedBranches.size === 0 && branchFilter === 'all'}
                    onChange={() => {
                      clearBranches();
                      setBranchFilter('all');
                      setShowBranchPicker(false);
                    }}
                  />
                  <span className="font-medium">All branches</span>
                </label>
                {branches.filter(b => !b.remote).length > 0 && (
                  <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary">Local</div>
                )}
                {branches.filter(b => !b.remote).map(b => (
                  <label key={b.name} className="flex items-center gap-2 px-3 py-1 hover:bg-bg-hover cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={selectedBranches.has(b.name)}
                      onChange={() => {
                        toggleBranch(b.name);
                        // Reset single-branch filter when using multi-select
                        if (selectedBranches.size > 0 || !selectedBranches.has(b.name)) setBranchFilter('all');
                      }}
                    />
                    <span className={cn('truncate', b.current && 'text-accent font-medium')}>{b.name}</span>
                    {b.current && <span className="text-2xs text-text-tertiary ml-auto">HEAD</span>}
                  </label>
                ))}
                {branches.filter(b => b.remote).length > 0 && (
                  <div className="px-3 py-1 text-2xs uppercase text-text-tertiary bg-bg-tertiary">Remote</div>
                )}
                {branches.filter(b => b.remote).map(b => (
                  <label key={b.name} className="flex items-center gap-2 px-3 py-1 hover:bg-bg-hover cursor-pointer text-xs">
                    <input
                      type="checkbox"
                      checked={selectedBranches.has(b.name)}
                      onChange={() => {
                        toggleBranch(b.name);
                        if (selectedBranches.size > 0 || !selectedBranches.has(b.name)) setBranchFilter('all');
                      }}
                    />
                    <span className="truncate">{b.name}</span>
                  </label>
                ))}
                <div className="px-3 py-1 border-t border-border-subtle flex items-center justify-between">
                  <button className="text-2xs text-accent"
                    onClick={() => {
                      clearBranches();
                      setBranchFilter('head+upstream');
                    }}>
                    Reset to default
                  </button>
                  <button className="text-2xs btn btn-primary !py-0.5 !px-2"
                    onClick={() => setShowBranchPicker(false)}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
          <label className="flex items-center gap-1">
            <span className="text-text-tertiary">Author:</span>
            <input type="text" value={authorFilter} placeholder="name or email"
              onChange={(e) => setAuthorFilter(e.target.value)}
              className="text-xs w-32 px-1 py-0.5 bg-bg-tertiary border border-border-default rounded" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-text-tertiary">From:</span>
            <input type="date" value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="text-xs px-1 py-0.5 bg-bg-tertiary border border-border-default rounded" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-text-tertiary">To:</span>
            <input type="date" value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="text-xs px-1 py-0.5 bg-bg-tertiary border border-border-default rounded" />
          </label>
          <label className="flex items-center gap-1">
            <span className="text-text-tertiary">Path:</span>
            <input type="text" value={pathFilter} placeholder="src/*"
              onChange={(e) => setPathFilter(e.target.value)}
              className="text-xs w-32 px-1 py-0.5 bg-bg-tertiary border border-border-default rounded font-mono" />
          </label>
          {(authorFilter || dateFrom || dateTo || pathFilter) && (
            <button className="btn btn-secondary text-2xs !py-0.5 !px-2"
              onClick={() => { setAuthorFilter(''); setDateFrom(''); setDateTo(''); setPathFilter(''); }}>
              Clear
            </button>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Graph + Commit list */}
        <div className="flex-1 overflow-y-auto" ref={listScrollRef} style={{ position: 'relative' }}>
          {loading ? (
            <div className="p-8 text-center text-text-tertiary text-sm">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-text-tertiary text-sm">
              {taggedActive ? 'No tagged commits found — tags point at commits outside the loaded window. Try scrolling down or increase the commit limit.' : search ? 'No commits match' : 'No commits yet'}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              {/* Graph SVG — drawn per-row, with passing lanes that span full row height.
                  PERF-1: virtualize the SVG the same way commit rows are virtualized
                  via lazyList.visibleRange. Slicing + repositioning with
                  top:lazyList.offsetY gives identical visual output but ~50-200x
                  fewer SVG nodes for 10k+ commit repos. */}
              {showGraph && graphRows.length > 0 && (() => {
                const start = lazyList.visibleRange.start;
                const end = lazyList.visibleRange.end;
                const sliceHeight = Math.max(0, (end - start) * ROW_HEIGHT);
                const sliceRows = graphRows.slice(start, end);
                // The SVG must align with the commit rows, which live inside
                // the spacer div that starts AFTER the Working Tree row.
                // Add wtOffset so the SVG's top matches the rows' top.
                const svgTop = lazyList.offsetY + wtOffset;
                return (
                <svg
                  width={graphWidth}
                  height={sliceHeight}
                  style={{ position: 'absolute', top: svgTop, left: 0, pointerEvents: 'none', zIndex: 5 }}
                >
                  {sliceRows.map((row, idx) => {
                    // idx is local to the visible slice; rowY is relative
                    // to the SVG's own origin (which is already at
                    // lazyList.offsetY in container coords).
                    const rowY = idx * ROW_HEIGHT;
                    const cy = rowY + ROW_HEIGHT / 2;
                    const x = (lane: number) => lane * LANE_WIDTH + LANE_WIDTH / 2 + GRAPH_PAD;
                    // Stroke dash array for dashed (rewired) connections
                    const strokeDash = (d?: boolean) => d ? '4 3' : undefined;

                    return (
                      <g key={`r-${start + idx}`}>
                        {/* Passing lanes — thinner, more transparent for cleaner look */}
                        {row.passing.map((p, pi) => (
                          <line key={`p-${start + idx}-${pi}`}
                            x1={x(p.lane)} y1={rowY}
                            x2={x(p.lane)} y2={rowY + ROW_HEIGHT}
                            stroke={laneColor(p.color)} strokeWidth={2} opacity={0.5}
                            strokeDasharray={strokeDash(p.dashed)} strokeLinecap="round" />
                        ))}

                        {row.node && (
                          <>
                            {/* Closing curves — smooth bezier into node */}
                            {row.node.closing.map((c, ci) => (
                              <path key={`c-${start + idx}-${ci}`}
                                d={bezierPath(x(c.lane), rowY, x(row.node!.lane), cy)}
                                stroke={laneColor(c.color)} strokeWidth={2} fill="none" opacity={0.7}
                                strokeDasharray={strokeDash(c.dashed)} strokeLinecap="round" />
                            ))}

                            {/* Incoming vertical line (top → node center) */}
                            {row.node.hasIncoming && (
                              <line
                                x1={x(row.node.lane)} y1={rowY}
                                x2={x(row.node.lane)} y2={cy}
                                stroke={laneColor(row.node.color)} strokeWidth={2} opacity={0.7}
                                strokeDasharray={strokeDash(row.node.firstParentDashed)} strokeLinecap="round" />
                            )}

                            {/* Continues vertical line (node center → bottom) */}
                            {row.node.continues && (
                              <line
                                x1={x(row.node.lane)} y1={cy}
                                x2={x(row.node.lane)} y2={rowY + ROW_HEIGHT}
                                stroke={laneColor(row.node.color)} strokeWidth={2} opacity={0.7}
                                strokeDasharray={strokeDash(row.node.firstParentDashed)} strokeLinecap="round" />
                            )}

                            {/* Merge curves — smooth bezier from node to parent lane */}
                            {row.node.merges.map((m, mi) => (
                              <path key={`m-${idx}-${mi}`}
                                d={bezierPath(x(row.node!.lane), cy, x(m.lane), rowY + ROW_HEIGHT)}
                                stroke={laneColor(m.color)} strokeWidth={2} fill="none" opacity={0.7}
                                strokeDasharray={strokeDash(m.dashed)} strokeLinecap="round" />
                            ))}

                            {/* Node circle — VS Code style: solid filled, colored ring */}
                            {(() => {
                              const cx = x(row.node!.lane);
                              // Use GLOBAL index (start + idx) to match selectedIdx —
                              // previously used local idx which was wrong after scrolling
                              // (selectedIdx=50 would match idx=50 in a 0..20 slice → never).
                              const isSelected = selectedIdx === (start + idx);
                              const isMerge = row.node!.isMerge;
                              const isTruncated = row.node!.truncated;
                              const isIncoming = incomingHashes.has(row.node!.entry.hash);
                              const r = isMerge ? 6 : 5;
                              const color = laneColor(row.node!.color);
                              return (
                                <g>
                                  {isMerge && (
                                    <circle cx={cx} cy={cy} r={r + 3} fill="none"
                                      stroke={color} strokeWidth={1.5} opacity={0.3} />
                                  )}
                                  <circle cx={cx} cy={cy} r={r}
                                    fill={isSelected ? color : 'var(--graph-node-fill)'}
                                    stroke={color} strokeWidth={2.5}
                                    strokeDasharray={isTruncated ? '2 2' : isIncoming ? '3 2' : undefined}
                                    opacity={isIncoming ? 0.6 : 1} />
                                  {isIncoming && (
                                    <circle cx={cx} cy={cy} r={r + 3} fill="none"
                                      stroke={color} strokeWidth={1}
                                      strokeDasharray="2 3" opacity={0.35} />
                                  )}
                                </g>
                              );
                            })()}
                          </>
                        )}
                      </g>
                    );
                  })}
                </svg>
                );
              })()}

              {/* Working Tree row */}
              {hasUncommitted && (
                <div
                  className={cn('flex items-center gap-2 px-2 border-b border-border-subtle cursor-pointer relative',
                    selectedIdx === -1 ? 'bg-bg-selected' : 'hover:bg-bg-hover')}
                  style={{ height: ROW_HEIGHT, paddingLeft: showGraph ? graphWidth + 8 : 8, zIndex: 4 }}
                  onClick={() => { setSelectedIdx(-1); window.location.hash = '#/changes'; }}
                >
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--status-deleted)' }} />
                  <span className="text-xs font-medium">Working Tree ({status?.files.length || 0} changed)</span>
                </div>
              )}

              {/* Commit rows — virtualized: only render visible window + overscan.
                  The container has a spacer div with totalHeight to maintain scrollbar,
                  and an inner div with translateY(offsetY) to position the visible rows. */}
              <div style={{ height: lazyList.totalHeight, position: 'relative' }}>
                <div style={{ position: 'absolute', top: lazyList.offsetY, left: 0, right: 0 }}>
                  {graphRows.slice(lazyList.visibleRange.start, lazyList.visibleRange.end).map((row, idx) => {
                    const realIdx = lazyList.visibleRange.start + idx;
                    if (!row.node) return null;
                    const entry = row.node.entry;
                    const initials = getInitials(entry.author.name);
                const color = getAuthorColor(entry.author.name);
                const isSelected = selectedIdx === realIdx;
                const isHEAD = entry.refs.some(r => r.includes('HEAD'));
                const isFirstOverall = realIdx === 0;
                return (
                  <div
                    key={entry.hash}
                    className={cn('flex items-center gap-2 border-b border-border-subtle cursor-pointer relative',
                      isSelected ? 'bg-bg-selected' : 'hover:bg-bg-hover',
                      // Incoming (remote-only) commits get a subtle tinted background
                      incomingHashes.has(entry.hash) && !isSelected && 'bg-blue-50/30 dark:bg-blue-950/10')}
                    style={{ height: ROW_HEIGHT, paddingLeft: showGraph ? graphWidth + 8 : 8, zIndex: 4 }}
                    onClick={() => { setSelectedIdx(realIdx); selectCommit(entry.hash); }}
                    onContextMenu={(e) => showCommitContextMenu(e, entry, realIdx)}
                  >
                    {isHEAD && <span className="text-2xs text-text-primary flex-shrink-0" style={{ width: 8 }}>▶</span>}

                    {/**  Sync indicator */}
                    {isFirstOverall && status?.current && status?.tracking && (
                      <div
                        className={cn('flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-2xs font-medium',
                          status.ahead > 0 && status.behind > 0
                            ? 'border-status-modified/40 bg-status-modified/10 text-status-modified'
                            : status.ahead > 0
                              ? 'border-status-added/40 bg-status-added/10 text-status-added'
                              : status.behind > 0
                                ? 'border-status-info/40 bg-status-info/10 text-status-info'
                                : 'border-status-added/30 bg-status-added/5 text-status-added')}
                        title={
                          status.ahead === 0 && status.behind === 0
                            ? `In sync with ${status.tracking}`
                            : `Local: ${status.current} · Upstream: ${status.tracking}\n` +
                              `↑ ${status.ahead} commit(s) ahead · ↓ ${status.behind} commit(s) behind`
                        }
                      >
                        {status.ahead === 0 && status.behind === 0 ? (
                          /* In sync — plug CONNECTED (вилка в розетке) */
                          <span className="flex items-center gap-0.5">
                            <PlugConnected size={14} />
                          </span>
                        ) : (
                          /* Out of sync — plug DISCONNECTED (вилка отдельно) + counts */
                          <>
                            <PlugDisconnected size={14} />
                            {status.ahead > 0 && (
                              <span className="flex items-center gap-0.5 ml-0.5">
                                <ArrowUp size={9} />
                                {status.ahead}
                              </span>
                            )}
                            {status.behind > 0 && (
                              <span className="flex items-center gap-0.5 ml-0.5">
                                <ArrowDown size={9} />
                                {status.behind}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {!isHEAD && <span style={{ width: 8 }} className="flex-shrink-0" />}

                    {/* Decorations: tags first, then HEAD/branches/remotes — parsed
                        from BOTH short and --decorate=full shapes (see refBadge). */}
                    {/* Show up to 5 ref badges per row so tags (often grouped with
                        branches and remotes) are visible at a glance. */}
                    <RefBadges refs={entry.refs} max={5} hash={entry.hash} onChanged={loadHistory} />

                    {/* Incoming badge — commit exists only on remote, not yet pulled.
                        In VS Code style: a dashed "↓ incoming" label with the remote
                        branch name. */}
                    {incomingHashes.has(entry.hash) && (
                      <span className="flex-shrink-0 text-2xs px-1.5 py-0.5 rounded border border-dashed border-status-info text-status-info font-medium flex items-center gap-0.5"
                        title="Incoming — this commit exists on a remote but has not been pulled into a local branch yet. Use Pull to bring it into your local branch.">
                        ↓
                        {entry.refs.some(r => r.includes('refs/remotes/') || r.includes('/')) && (
                          <span className="opacity-75">
                            {entry.refs.find(r => r.includes('refs/remotes/'))?.replace('refs/remotes/', '') || entry.refs.find(r => r.includes('/'))}
                          </span>
                        )}
                      </span>
                    )}

                    {/* GitHub Actions CI badge (SmartGit "My History" CI integrations) */}
                    {ciStatus[entry.hash]?.conclusion && (
                      <span
                        className="flex-shrink-0 text-2xs"
                        title={`CI: ${ciStatus[entry.hash].conclusion} (${ciStatus[entry.hash].totalChecks} checks)`}
                      >
                        {ciStatus[entry.hash].conclusion === 'success' && <span className="text-green-500">●</span>}
                        {ciStatus[entry.hash].conclusion === 'failure' && <span className="text-red-500">●</span>}
                        {ciStatus[entry.hash].conclusion === 'running' && <span className="text-yellow-500 animate-pulse">●</span>}
                      </span>
                    )}

                    <span className={cn('flex-1 truncate text-xs', isSelected ? 'font-semibold text-text-primary' : 'font-medium text-text-primary')}>
                      {bugtraq
                        ? linkifyCommitMessage(entry.subject, bugtraq).map((seg, i) =>
                            seg.url ? (
                              <a
                                key={i}
                                href={seg.url}
                                className="text-accent hover:underline"
                                onClick={(e) => { e.stopPropagation(); api.app.openExternal(seg.url!); }}
                              >
                                {seg.text}
                              </a>
                            ) : (
                              <span key={i}>{seg.text}</span>
                            )
                          )
                        : entry.subject}
                    </span>

                    {/* Hash — clicking ANY commit hash opens History focused on
                        that commit (same as PARENTS links); copy lives in the
                        right-click menu and the row menu. */}
                    <CommitHashLink
                      hash={entry.hash}
                      plain
                      display={entry.hashAbbrev || shortHash(entry.hash)}
                      className="text-text-tertiary/60 flex-shrink-0 truncate"
                    />

                    {/* Author avatar — Gravatar image if the author's email
                        is from a known provider (GitHub / GitLab noreply),
                        otherwise the colored-initial fallback badge.
                        QW-6 / Task (gravatar). */}
                    <Avatar name={entry.author.name} email={entry.author.email} size={16} />
                    <span className="text-2xs text-text-tertiary flex-shrink-0" style={{ width: 70, textAlign: 'right' }}>
                      {formatTime(entry.author.date)}
                    </span>
                  </div>
                );
              })}
                </div>
              </div>

              {/* Lazy-load indicator — shown at the bottom of the list when
                  more commits are being fetched OR when we've reached the end
                  of history. Rendered as a normal block (not virtualized) so
                  it stays visible after the last row scrolls into view. */}
              {loadingMore && (
                <div className="flex items-center justify-center gap-2 py-3 text-xs text-text-tertiary">
                  <span className="spinner" />
                  <span>Loading more commits…</span>
                </div>
              )}
              {!loadingMore && !hasMore && filtered.length > 0 && (
                <div className="py-3 text-center text-2xs text-text-tertiary italic">
                  End of history — reached the very first commit.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <ResizableSplitter direction="horizontal" onResize={(d) => handleDetailResize(-d)} />
        <div className="bg-bg-secondary overflow-y-auto flex-shrink-0" style={{ width: detailWidth }}>
          {selected ? (
            <div className="p-3">
              <div className="flex items-start gap-2 mb-2">
                <Avatar name={selected.author.name} email={selected.author.email} size={20} className="mt-0.5 flex-shrink-0" />
                <div className="text-sm font-medium text-text-primary flex-1 min-w-0">
                  {bugtraq
                    ? linkifyCommitMessage(selected.subject, bugtraq).map((seg, i) =>
                        seg.url ? (
                          <a key={i} href={seg.url} className="text-accent hover:underline" onClick={(e) => { e.preventDefault(); api.app.openExternal(seg.url!); }}>
                            {seg.text}
                          </a>
                        ) : (
                          <span key={i}>{seg.text}</span>
                        )
                      )
                    : selected.subject}
                </div>
              </div>
              {selectedNote && (
                <div className="mb-2 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 flex items-start gap-1.5">
                  <StickyNote size={12} className="text-amber-500 mt-0.5 shrink-0" />
                  <pre className="text-2xs whitespace-pre-wrap flex-1 text-text-secondary">{selectedNote}</pre>
                </div>
              )}
              {/* Tags and branch refs on this commit (shared badge renderer) */}
              <RefBadges refs={selected.refs} className="mb-3" hash={selected.hash} onChanged={loadHistory} />
              {/* Annotated-tag details — SmartGit shows the tag message in the
                  commit description. Lightweight tags only get a badge above. */}
              {tagsHere.filter(t => t.annotated).length > 0 && (
                <div className="mb-3 space-y-1">
                  {tagsHere.filter(t => t.annotated).map((t) => (
                    <div key={t.name} className="px-2 py-1.5 rounded bg-tag-bg/40 border border-tag-border/40">
                      <div className="flex items-center gap-1.5 text-2xs text-tag-text">
                        <TagIcon size={11} />
                        <span className="font-semibold">{t.name}</span>
                        {t.tagger && <span className="text-text-tertiary">· {t.tagger}</span>}
                        {t.date && <span className="text-text-tertiary">· {formatTime(t.date)}</span>}
                      </div>
                      {t.message && (
                        <div className="text-2xs text-text-secondary mt-0.5 whitespace-pre-wrap">{t.message}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 mb-3">
                <CommitHashLink hash={selected.hash} />
                <button className="icon-btn !w-5 !h-5" title="Copy" onClick={() => { copyToClipboard(selected.hash); toast.success(t('history.copied')); }}>
                  <Copy size={10} />
                </button>
                <button className="icon-btn !w-5 !h-5" title={t('history.browserTitle')} onClick={handleOpenInBrowser}>
                  <ExternalLink size={11} />
                </button>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <span className="flex-shrink-0 rounded author-badge text-center"
                  style={{ backgroundColor: getAuthorColor(selected.author.name).bg, width: 28, height: 18, fontSize: 9, lineHeight: '18px' }}>
                  {getInitials(selected.author.name)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-primary">{selected.author.name}</div>
                  <div className="text-2xs text-text-tertiary">{formatTime(selected.author.date)}</div>
                </div>
              </div>
              {selected.parents.length > 0 && (
                <div className="mb-3">
                  <div className="text-2xs uppercase text-text-tertiary mb-1">Parents</div>
                  {selected.parents.map((p, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <CornerDownRight size={10} className="text-text-tertiary" />
                      <CommitHashLink hash={p} />
                    </div>
                  ))}
                </div>
              )}
              {/* MERGE commit: list every nested commit the merge brought in
                  (`git log <merge>^1..<merge>` — includes the merge itself, so
                  a real merge shows ≥ 2 rows). Octopus merges list commits from
                  ALL merged branches. Click a row → that commit is selected. */}
              {nestedCommits.length > 1 && (
                <div className="mb-3">
                  <button
                    className="w-full flex items-center justify-between text-2xs uppercase text-text-tertiary mb-1"
                    onClick={() => setShowNested(!showNested)}
                    title="Commits merged by this merge commit (relative to the first parent)"
                  >
                    <span className="flex items-center gap-1">
                      {showNested ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      <GitMerge size={10} /> Merged commits ({nestedCommits.length - 1})
                    </span>
                  </button>
                  {showNested && (
                    <div className="space-y-0.5">
                      {loadingNested && <div className="text-2xs text-text-tertiary">Loading...</div>}
                      {nestedCommits.map((c) => (
                        <div
                          key={c.hash}
                          className={cn(
                            'flex items-center gap-1 text-2xs px-1 py-0.5 rounded hover:bg-bg-hover cursor-pointer',
                            c.hash === selected.hash && 'text-text-tertiary'
                          )}
                          onClick={() => selectCommit(c.hash)}
                          title={c.hash === selected.hash ? 'This merge commit' : 'Jump to commit'}
                        >
                          {c.hash === selected.hash
                            ? <GitMerge size={10} className="text-text-tertiary flex-shrink-0" />
                            : <CornerDownRight size={10} className="text-text-tertiary flex-shrink-0" />}
                          <span className="font-mono flex-shrink-0">{c.hashAbbrev || shortHash(c.hash)}</span>
                          <span className="truncate flex-1 min-w-0">{c.subject}</span>
                          <span className="text-text-tertiary flex-shrink-0">{c.author.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {selected.body && !editingMessage && (
                <div className="mb-3">
                  <div className="text-2xs uppercase text-text-tertiary mb-1 flex items-center justify-between">
                    <span>Message</span>
                    <button className="icon-btn !w-4 !h-4" title="Edit" onClick={() => handleEditMessage(selected)}>
                      <Pencil size={9} />
                    </button>
                  </div>
                  <pre className="text-2xs font-mono whitespace-pre-wrap text-text-secondary bg-bg-tertiary p-2 rounded">{selected.body}</pre>
                </div>
              )}
              {editingMessage && (
                <div className="mb-3">
                  <textarea className="w-full text-xs font-mono h-20 resize-none mb-1"
                    value={editMsgValue} onChange={(e) => setEditMsgValue(e.target.value)} />
                  <div className="flex gap-1">
                    <button className="btn btn-primary text-2xs" onClick={handleSaveMessage}>{t('action.button.save')}</button>
                    <button className="btn btn-secondary text-2xs" onClick={() => setEditingMessage(false)}>{t('action.button.cancel')}</button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-1 mb-3 pb-3 border-b border-border-default">
                <button className="btn btn-secondary text-2xs" onClick={() => handleCherryPick(selected)}>
                  <GitPullRequest size={10} /> Cherry Pick
                </button>
                <button className="btn btn-secondary text-2xs" onClick={() => handleRevert(selected)}>
                  <Undo size={10} /> Revert
                </button>
                <button className="btn btn-secondary text-2xs" onClick={() => handleReset(selected.hash, 'mixed')}
                  title="Reset to this commit (mixed)">
                  <RotateCcw size={10} /> Reset
                </button>
              </div>
              <div>
                <div className="w-full flex items-center justify-between text-2xs uppercase text-text-tertiary mb-1">
                  <button className="flex items-center gap-1" onClick={() => setShowFiles(!showFiles)}>
                    {showFiles ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    <FileText size={10} /> Files ({commitFiles.length})
                  </button>
                  <div className="flex items-center gap-2 normal-case">
                    {/* View mode toggle: List / Tree */}
                    <div className="flex bg-bg-tertiary rounded text-2xs">
                      <button
                        className={cn('px-1.5 py-0.5 rounded-l', filesViewMode === 'list' ? 'bg-accent text-text-inverse' : 'text-text-secondary')}
                        onClick={() => setFilesViewMode('list')}
                        title="Flat list view"
                      >List</button>
                      <button
                        className={cn('px-1.5 py-0.5 rounded-r', filesViewMode === 'tree' ? 'bg-accent text-text-inverse' : 'text-text-secondary')}
                        onClick={() => setFilesViewMode('tree')}
                        title="Tree view (collapsible folders)"
                      >Tree</button>
                    </div>
                    {/* Pagination for large commits */}
                    {commitFiles.length > 50 && filesViewMode === 'list' && (
                      <span className="flex items-center gap-1">
                        <button className="text-2xs hover:text-accent" onClick={() => setFilesPage(Math.max(0, filesPage - 1))} disabled={filesPage === 0}>‹</button>
                        <span className="text-2xs">{filesPage * 50 + 1}-{Math.min((filesPage + 1) * 50, commitFiles.length)}/{commitFiles.length}</span>
                        <button className="text-2xs hover:text-accent" onClick={() => setFilesPage(Math.min(Math.ceil(commitFiles.length / 50) - 1, filesPage + 1))} disabled={filesPage >= Math.ceil(commitFiles.length / 50) - 1}>›</button>
                      </span>
                    )}
                  </div>
                </div>
                {showFiles && (
                  <div className="space-y-0.5">
                    {loadingFiles ? <div className="text-2xs text-text-tertiary">Loading...</div> :
                      filesViewMode === 'tree' ? (
                        <CommitFileTree
                          files={commitFiles}
                          expandedDirs={expandedFileDirs}
                          onToggleDir={(dir) => {
                            setExpandedFileDirs(prev => {
                              const next = new Set(prev);
                              if (next.has(dir)) next.delete(dir);
                              else next.add(dir);
                              return next;
                            });
                          }}
                          globalPathFilter={globalPathFilter}
                          onFileClick={(f) => {
                            useSelectionStore.getState().selectFile(f.path);
                            useSelectionStore.getState().setPathFilter(f.path);
                            window.location.hash = '#/history';
                          }}
                          onFileContextMenu={(e, f) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const fileCtx = {
                              repoPath: repo.path,
                              path: f.path,
                              mode: 'history' as const,
                              commitSha: selected.hash,
                              onOpenDiff: () => {
                                // Compare what THIS COMMIT changed for this file:
                                // baseRef = commit^ (parent), compareRef = commit
                                useSelectionStore.getState().selectFile(f.path);
                                useSelectionStore.getState().selectCommit(selected.hash);
                                useSelectionStore.getState().setDiffRequest({
                                  baseRef: `${selected.hash}^`,
                                  compareRef: selected.hash,
                                  filePath: f.path,
                                });
                                window.location.hash = '#/diff';
                              },
                            };
                            showContextMenu([
                              ...buildFileMenu(fileCtx),
                              { type: 'separator' },
                              { label: t('pages.viewFileHistory', { defaultValue: 'View file history...' }), clickId: 'view-file-history' },
                            ], async (action) => {
                              if (action === 'view-file-history') {
                                setFileHistoryPath(f.path);
                              } else {
                                await runFileAction(action, fileCtx);
                              }
                            });
                          }}
                        />
                      ) : (
                      commitFiles.slice(filesPage * 50, (filesPage + 1) * 50).map((f, i) => {
                        // Highlight the file that matches the active file-history filter
                        const isHighlighted = globalPathFilter === f.path || globalPathFilter === f.oldPath;
                        return (
                        <div key={i} className={cn(
                          'flex items-center gap-1 text-2xs px-1 py-0.5 rounded hover:bg-bg-hover cursor-pointer group',
                          isHighlighted && 'bg-accent-muted border-l-2 border-accent'
                        )}
                          onClick={() => {
                            useSelectionStore.getState().selectFile(f.path);
                            useSelectionStore.getState().setPathFilter(f.path);
                            window.location.hash = '#/history';
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const fileCtx = {
                              repoPath: repo.path,
                              path: f.path,
                              mode: 'history' as const,
                              commitSha: selected.hash,
                              onOpenDiff: () => {
                                // Compare what THIS COMMIT changed for this file:
                                // baseRef = commit^ (parent), compareRef = commit
                                useSelectionStore.getState().selectFile(f.path);
                                useSelectionStore.getState().selectCommit(selected.hash);
                                useSelectionStore.getState().setDiffRequest({
                                  baseRef: `${selected.hash}^`,
                                  compareRef: selected.hash,
                                  filePath: f.path,
                                });
                                window.location.hash = '#/diff';
                              },
                            };
                            showContextMenu(buildFileMenu(fileCtx), async (action) => {
                              await runFileAction(action, fileCtx);
                            });
                          }}
                          title={isHighlighted ? `${f.path} — matches your file-history filter` : 'Click to view file history · Right-click for more actions'}
                        >
                          <span className="font-mono font-bold w-3 text-center"
                            style={{ color: f.status === 'A' ? 'var(--status-added)' : f.status === 'D' ? 'var(--status-deleted)' : f.status === 'R' ? 'var(--status-renamed)' : 'var(--status-modified)' }}>
                            {f.status}
                          </span>
                          <span className={cn('flex-1 truncate font-mono text-text-secondary group-hover:text-text-primary',
                            isHighlighted && 'text-accent font-medium')}>{f.path}</span>
                          {!f.binary && (f.additions > 0 || f.deletions > 0) && (
                            <span className="text-2xs flex-shrink-0">
                              <span className="text-status-added">+{f.additions}</span>
                              <span className="text-status-deleted ml-1">-{f.deletions}</span>
                            </span>
                          )}
                        </div>
                        );
                      })
                      )
                    }
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-text-tertiary text-sm">Select a commit</div>
          )}
        </div>
      </div>

      {/* Create Tag dialog */}
      {showTagDialog && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setShowTagDialog(false)}>
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-1 flex items-center gap-2">
              <TagIcon size={16} /> Create Tag at {shortHash(tagTarget || '')}
            </h3>
            <div className="text-2xs text-text-tertiary mb-4">Tag will point to this commit.</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Tag name</label>
                <input type="text" className="w-full text-sm font-mono" placeholder="v1.0.0"
                  value={tagName} autoFocus
                  onChange={(e) => setTagName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveTag()} />
              </div>
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Message (optional, for annotated tags)</label>
                <textarea className="w-full text-sm h-20 resize-none"
                  value={tagMessage}
                  onChange={(e) => setTagMessage(e.target.value)}
                  placeholder="Release 1.0.0" />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={tagAnnotated}
                  onChange={(e) => setTagAnnotated(e.target.checked)} />
                <span>Annotated tag (recommended — stores tagger + date + message)</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowTagDialog(false)}>{t('action.button.cancel')}</button>
              <button className="btn btn-primary" onClick={handleSaveTag} disabled={!tagName.trim()}>
                <TagIcon size={13} /> Create Tag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Branch dialog */}
      {showBranchDialog && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setShowBranchDialog(false)}>
          <div className="panel w-96 p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-medium mb-1 flex items-center gap-2">
              <GitBranch size={16} /> Create Branch at {shortHash(branchTarget || '')}
            </h3>
            <div className="text-2xs text-text-tertiary mb-4">Branch will start from this commit.</div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-text-tertiary block mb-1">Branch name</label>
                <input type="text" className="w-full text-sm font-mono" placeholder="feature/my-branch"
                  value={branchName} autoFocus
                  onChange={(e) => setBranchName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveBranch()} />
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={branchCheckout}
                  onChange={(e) => setBranchCheckout(e.target.checked)} />
                <span>Checkout after creation</span>
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => setShowBranchDialog(false)}>{t('action.button.cancel')}</button>
              <button className="btn btn-primary" onClick={handleSaveBranch} disabled={!branchName.trim()}>
                <GitBranch size={13} /> Create Branch
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Compare with Working Tree dialog */}
      {compareDiff && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setCompareDiff(null)}>
          <div className="panel w-[80vw] h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border-default">
              <h3 className="text-sm font-medium">{compareDiff.title}</h3>
              <button className="icon-btn" onClick={() => setCompareDiff(null)}>✕</button>
            </div>
            <div className="flex-1 overflow-hidden">
              <DiffViewer diff={compareDiff.result} filePath={compareDiff.title} />
            </div>
          </div>
        </div>
      )}
      {/* File History Viewer — shows commit graph + snapshot + diff + actions */}
      {fileHistoryPath && (
        <FileHistoryViewer filePath={fileHistoryPath} onClose={() => setFileHistoryPath(null)} />
      )}

      {/* Split Off Files dialog */}
      {showSplitOff && splitOffEntry && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/55 flex items-center justify-center z-50" onClick={() => setShowSplitOff(false)}>
          <div className="panel w-[560px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 pt-4">
              <h3 className="text-base font-medium">Split Off Files Into New Commit</h3>
              <div className="text-xs text-text-tertiary mt-1">
                From {shortHash(splitOffEntry.hash)} "{splitOffEntry.subject}" — selected files move into a NEW commit right after this one.
              </div>
            </div>
            <div className="flex-1 overflow-y-auto mx-4 my-3 border border-border-default rounded">
              {splitOffFileList.length === 0 ? (
                <div className="p-4 text-xs text-text-tertiary text-center">Loading files...</div>
              ) : (
                splitOffFileList.map((f) => (
                  <label
                    key={f.path}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-subtle last:border-b-0 cursor-pointer hover:bg-bg-hover"
                  >
                    <input
                      type="checkbox"
                      checked={splitOffSelected.has(f.path)}
                      onChange={(e) => {
                        const next = new Set(splitOffSelected);
                        if (e.target.checked) next.add(f.path); else next.delete(f.path);
                        setSplitOffSelected(next);
                      }}
                    />
                    <span className="badge badge-renamed w-6 text-center flex-shrink-0">{f.status}</span>
                    <span className="font-mono truncate">{f.path}</span>
                    <span className="ml-auto flex-shrink-0 text-text-tertiary">
                      +{f.additions} −{f.deletions}
                    </span>
                  </label>
                ))
              )}
            </div>
            <div className="px-4 pb-3 space-y-2">
              <input
                type="text"
                className="w-full text-sm"
                placeholder="Message for the new commit"
                value={splitOffMessage}
                onChange={(e) => setSplitOffMessage(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <button className="btn btn-secondary text-xs" onClick={() => setShowSplitOff(false)}>{t('action.button.cancel')}</button>
                <button
                  className="btn btn-primary text-xs"
                  onClick={handleSplitOffExecute}
                  disabled={splitOffBusy || splitOffSelected.size === 0}
                >
                  {splitOffBusy ? 'Splitting...' : `Split Off ${splitOffSelected.size} File${splitOffSelected.size === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
