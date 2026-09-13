/**
 * Unified SmartGit-style context menu for file rows, shared by every file
 * list (Changes grid, Diff file list, History commit files).
 *
 * Every item is backed by a REAL git / filesystem operation — no stubs:
 *   Open / Reveal            → shell openPath / showItemInFolder (via api.git)
 *   Show Changes             → loads the file diff in the Changes split view
 *   File History (Log)       → History page filtered to the file
 *   Blame                    → Blame page for the file
 *   Stage / Unstage          → git add / git reset
 *   Commit...                → stage file + focus the commit message box
 *   Stash Selection...       → git stash push -- <file> (prompted message)
 *   Discard Changes...       → git restore (confirm first)
 *   Restore from Ref...      → git checkout <ref> -- <file>
 *   Ignore                   → append to .gitignore
 *   Move or Rename...        → git mv (tracked) / fs rename (untracked)
 *   Remove / Delete          → git rm -f (tracked) / fs delete (untracked)
 *   Assume Unchanged /       → git update-index (checkbox shows live state
 *   Skip Worktree              from git ls-files -v)
 *   Resolve Conflict         → opens the Conflict Solver
 *   Copy Name / Path / Full  → clipboard
 *   Select Directory / Root  → scopes the Changes dir tree
 */
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { useSelectionStore } from '../stores/selectionStore';
import { useToastStore } from '../stores/toastStore';
import { api } from './api';
import { t as i18nT } from './i18n';
import type { ContextMenuItem } from './useContextMenu';
import { copyToClipboard } from './utils';

export interface IndexFlags {
  assumeUnchanged: boolean;
  skipWorktree: boolean;
  tracked: boolean;
}

export interface FileMenuCtx {
  /** Absolute repository path. */
  repoPath: string;
  /** Repo-relative file path (the clicked file — primary/diff target). */
  path: string;
  /**
   * FULL multi-selection (Ctrl/Cmd+click, Ctrl/Cmd+A) the menu was opened
   * on — ALWAYS including `path`. When absent/empty the menu works on the
   * clicked file only. Bulk operations (Stage/Unstage/Discard/Stash/
   * Ignore/Delete/flags/copy) apply to every path; navigation actions
   * (Show Changes, Blame, File History, Move/Rename, conflict solver)
   * stay on the clicked file.
   */
  paths?: string[];
  /** Which file list the menu is opened from. */
  mode: 'changes' | 'diff' | 'history';
  /** Changes-page working-tree state. */
  isStaged?: boolean;
  isUntracked?: boolean;
  isConflicted?: boolean;
  /** Live index flags (fetched before the menu opens, changes-mode only). */
  indexFlags?: IndexFlags;
  /** Load this file's diff into the Changes split view. */
  onShowChanges?: () => void;
  /** Scope the Changes directory tree to a dir (null = repo root). */
  onSelectDirectory?: (dir: string | null) => void;
  /** Focus the commit message box (after the file was staged). */
  onFocusCommit?: () => void;
  /** Open the commit diff (History mode: "Open in Diff tool"). */
  onOpenDiff?: () => void;
  /** Commit hash the file list belongs to (History mode) — enables the
   * VS Code commit-archaeology actions (open version / parent↔commit diff). */
  commitSha?: string;
  /** Refresh repo status after a mutation. */
  refresh?: () => void;
}

const toast = () => useToastStore.getState();

/**
 * Fetch live index flags for a file before opening the changes-mode menu
 * (so the checkbox items reflect the real `git ls-files -v` state).
 * Never throws — falls back to { tracked: true, …false } on IPC errors.
 *
 * ── Cache ─────────────────────────────────────────────────────────────
 * The user reported that the right-click context menu in Changes was slow
 * to open. Root cause: every right-click awaited this IPC + git subprocess
 * call before showing the menu, adding 100-300ms latency. The flags rarely
 * change between two right-clicks on the same file, so we cache them for
 * 10 seconds. The first click still pays the IPC cost, but subsequent
 * clicks on the same file (or within a rapid session) are instant.
 *
 * Cache key: `${repoPath}|${path}`. TTL: 10s — long enough to absorb
 * repeated right-clicks on the same file, short enough that a real
 * assume-unchanged / skip-worktree toggle (which sets the flag via git
 * config) is reflected on the next menu open.
 */
const indexFlagsCache = new Map<string, { ts: number; flags: IndexFlags }>();
const INDEX_FLAGS_CACHE_TTL_MS = 10_000;

export async function getIndexFlagsAsync(repoPath: string, path: string): Promise<IndexFlags> {
  const cacheKey = `${repoPath}|${path}`;
  const cached = indexFlagsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < INDEX_FLAGS_CACHE_TTL_MS) {
    return cached.flags;
  }
  let flags: IndexFlags;
  try {
    flags = await api.git.getIndexFlags(repoPath, path);
  } catch {
    flags = { assumeUnchanged: false, skipWorktree: false, tracked: true };
  }
  // Store in cache — cap at 256 entries so the cache can't grow unbounded.
  if (indexFlagsCache.size >= 256) {
    const firstKey = indexFlagsCache.keys().next().value;
    if (firstKey) indexFlagsCache.delete(firstKey);
  }
  indexFlagsCache.set(cacheKey, { ts: Date.now(), flags });
  return flags;
}

/** Invalidate the cache for a single file (call after toggling assume-
 *  unchanged / skip-worktree so the next menu open reflects the new state). */
export function invalidateIndexFlagsCache(repoPath: string, path: string): void {
  indexFlagsCache.delete(`${repoPath}|${path}`);
}

/** Invalidate the entire cache (call after a commit / checkout / branch
 *  switch — any operation that could change index flags for many files). */
export function invalidateAllIndexFlagsCache(): void {
  indexFlagsCache.clear();
}

export function fullPathOf(repoPath: string, path: string): string {
  return `${repoPath}/${path}`.replace(/\/+/g, '/');
}

export function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.substring(i + 1);
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.substring(0, i);
}

/**
 * Target list for a menu action: the whole multi-selection when present,
 * otherwise just the clicked file. `path` is always included even if the
 * caller's selection somehow lost it.
 */
export function actionTargets(ctx: Pick<FileMenuCtx, 'path' | 'paths'>): string[] {
  const paths = (ctx.paths ?? []).filter((p) => !!p);
  const unique = Array.from(new Set(paths));
  if (unique.length === 0) return [ctx.path];
  return unique.includes(ctx.path) ? unique : [ctx.path, ...unique];
}

/** Human label suffix for bulk operations: " (3 files)". */
export function bulkSuffix(ctx: Pick<FileMenuCtx, 'path' | 'paths'>): string {
  const n = actionTargets(ctx).length;
  return n > 1 ? ` (${n} files)` : '';
}

/** Build the menu items for a file (pure — no side effects). */
export function buildFileMenu(ctx: FileMenuCtx): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  // In changes mode the working-tree state is authoritative: an untracked
  // file is never in the index, so 'Remove...' becomes 'Delete File...'.
  const tracked =
    ctx.mode === 'changes' ? !(ctx.isUntracked ?? false) && (ctx.indexFlags?.tracked ?? true) : true;
  const untracked = ctx.mode === 'changes' && !!ctx.isUntracked;
  // Multi-selection: bulk labels show how many files the action will hit.
  const bulk = bulkSuffix(ctx);

  // --- Open (opens EVERY selected file, like a file manager) ----------------
  items.push({ label: `Open${bulk}`, clickId: 'open' });
  items.push({ label: i18nT('vscode.openInVscode'), clickId: 'open-vscode' });
  items.push({ label: `Reveal in File Manager${bulk}`, clickId: 'reveal' });
  items.push({ type: 'separator' });

  // --- Inspect ------------------------------------------------------------
  if (ctx.mode === 'changes' && ctx.onShowChanges) {
    items.push({ label: 'Show Changes', clickId: 'show-changes' });
  }
  if ((ctx.mode === 'history' || ctx.mode === 'changes') && ctx.onOpenDiff) {
    items.push({ label: 'Open in Diff tool', clickId: 'open-diff' });
  }
  if (ctx.mode === 'changes') {
    items.push({ label: i18nT('vscode.openDiffInVscode'), clickId: 'open-vscode-diff' });
  }
  if (ctx.mode === 'history' && ctx.commitSha) {
    items.push({ label: i18nT('vscode.openCommitFileDiff'), clickId: 'open-vscode-commit-diff' });
    items.push({ label: i18nT('vscode.openFileVersion'), clickId: 'open-vscode-version' });
  }
  items.push({ label: 'File History (Log)', clickId: 'file-history' });
  items.push({ label: 'Blame this file', clickId: 'blame' });
  items.push({ type: 'separator' });

  // --- Working-tree operations (Changes mode only) -------------------------
  if (ctx.mode === 'changes') {
    if (ctx.isStaged) {
      items.push({ label: `Unstage${bulk}`, clickId: 'unstage' });
    } else {
      items.push({ label: `Stage${bulk}`, clickId: 'stage' });
    }
    items.push({ label: 'Commit...', clickId: 'commit' });
    if (!untracked) {
      items.push({ label: `Stash Selection...${bulk}`, clickId: 'stash-file' });
      items.push({ type: 'separator' });
      items.push({
        label: ctx.isStaged ? `Discard Staged Changes...${bulk}` : `Discard Changes...${bulk}`,
        clickId: 'discard',
      });
      items.push({ label: `Restore from Ref...${bulk}`, clickId: 'restore-from-ref' });
    } else {
      // Untracked files — "Discard" means deleting the file (git clean).
      // Show it as "Discard (Delete)" so the user understands what happens.
      items.push({ type: 'separator' });
      items.push({
        label: `Discard (Delete)...${bulk}`,
        clickId: 'discard-untracked',
      });
    }
    items.push({ type: 'separator' });

    // --- Index flags (tracked files only, live checkbox state) ------------
    if (ctx.indexFlags) {
      items.push({
        label: "Toggle 'Assume Unchanged'",
        type: 'checkbox',
        checked: ctx.indexFlags.assumeUnchanged,
        clickId: 'toggle-assume-unchanged',
      });
      items.push({
        label: "Toggle 'Skip Worktree'",
        type: 'checkbox',
        checked: ctx.indexFlags.skipWorktree,
        clickId: 'toggle-skip-worktree',
      });
      items.push({ type: 'separator' });
    }

    // --- File operations --------------------------------------------------
    if (untracked) {
      items.push({ label: `Add to .gitignore${bulk}`, clickId: 'ignore' });
      items.push({ label: 'Edit .gitignore', clickId: 'edit-ignore-local' });
      items.push({ label: 'Edit global ignore file', clickId: 'edit-ignore-global' });
    }
    items.push({ label: 'Move or Rename...', clickId: 'move-rename' });
    items.push({
      label: `${tracked ? 'Remove...' : 'Delete File...'}${bulk}`,
      clickId: 'delete-file',
    });
    if (ctx.isConflicted) {
      items.push({ type: 'separator' });
      items.push({ label: 'Resolve Conflict...', clickId: 'resolve-conflict' });
      // SmartGit-style "Resolve" submenu: Take Ours / Take Theirs
      items.push({
        label: 'Resolve',
        clickId: '_submenu_resolve',
        submenu: [
          { label: 'Take Ours', clickId: 'resolve-take-ours', title: 'git checkout --ours -- <file> + git add' },
          { label: 'Take Theirs', clickId: 'resolve-take-theirs', title: 'git checkout --theirs -- <file> + git add' },
          { type: 'separator' },
          { label: 'Use External Merge Tool', clickId: 'resolve-mergetool', title: 'git mergetool -- <file> (uses configured merge.tool)' },
        ],
      });
      items.push({ label: i18nT('vscode.resolveInVscode'), clickId: 'open-vscode-merge' });
    }
    items.push({ type: 'separator' });
  }

  // --- Clipboard ------------------------------------------------------------
  items.push({ label: 'Copy Name', clickId: 'copy-name' });
  items.push({ label: 'Copy Relative Path', clickId: 'copy-rel-path' });
  items.push({ label: 'Copy Full Path', clickId: 'copy-full-path' });

  // --- Directory scoping (Changes mode) --------------------------------------
  if (ctx.mode === 'changes' && ctx.onSelectDirectory) {
    items.push({ type: 'separator' });
    items.push({ label: 'Select Directory', clickId: 'select-directory' });
    items.push({ label: 'Select Repository Root', clickId: 'select-root' });
  }
  return items;
}

/**
 * Execute a clicked menu action. All destructive operations ask for
 * confirmation first; every mutation refreshes the repo status afterwards.
 * Returns true when the action id was recognized.
 */
export async function runFileAction(clickId: string, ctx: FileMenuCtx): Promise<boolean> {
  const t = toast();
  // Multi-selection: bulk operations hit every selected file; navigation
  // actions (history/blame/diff/move/conflict) stay on the clicked file.
  const targets = actionTargets(ctx);
  const refresh = () => ctx.refresh?.();
  const n = (verb: string) =>
    targets.length > 1 ? `${verb} ${targets.length} files` : `${verb} ${baseName(ctx.path)}`;
  const goTo = (hash: string, withPathFilter: boolean) => {
    const sel = useSelectionStore.getState();
    sel.selectFile(ctx.path);
    if (withPathFilter) sel.setPathFilter(ctx.path);
    window.location.hash = hash;
  };

  switch (clickId) {
    // --- Open ---------------------------------------------------------------
    case 'open': {
      try {
        const missing: string[] = [];
        for (const p of targets) {
          const ok = await api.git.openFile(fullPathOf(ctx.repoPath, p));
          if (!ok) missing.push(p);
        }
        if (missing.length > 0) {
          t.error(`File not found in working tree`, missing.length > 1 ? missing.join(', ') : missing[0]);
        }
      } catch (e) {
        t.error('Failed to open file', String(e));
      }
      return true;
    }
    case 'reveal': {
      try {
        const missing: string[] = [];
        for (const p of targets) {
          const ok = await api.git.revealInFileManager(fullPathOf(ctx.repoPath, p));
          if (!ok) missing.push(p);
        }
        if (missing.length > 0) {
          t.error(`File not found in working tree`, missing.length > 1 ? missing.join(', ') : missing[0]);
        }
      } catch (e) {
        t.error('Failed to reveal', String(e));
      }
      return true;
    }

    // --- VS Code integration ----------------------------------------------
    case 'open-vscode': {
      try {
        const res = await api.vscode.open(ctx.repoPath, { file: ctx.path });
        if (res.ok) t.success(i18nT('vscode.opened'));
        else t.error(i18nT('vscode.notFound'));
      } catch (e) {
        t.error(i18nT('vscode.openFailed'), String(e));
      }
      return true;
    }
    case 'open-vscode-diff': {
      try {
        const res = await api.vscode.openFileDiff(ctx.repoPath, ctx.path);
        if (res.ok) t.success(i18nT('vscode.opened'));
        else t.error(res.detail || i18nT('vscode.notFound'));
      } catch (e) {
        t.error(i18nT('vscode.openFailed'), String(e));
      }
      return true;
    }
    case 'open-vscode-commit-diff': {
      // parent↔commit diff of this file in VS Code (history mode only)
      if (!ctx.commitSha) return true;
      try {
        const res = await api.vscode.openCommitFileDiff(ctx.repoPath, ctx.commitSha, ctx.path);
        if (res.ok) t.success(i18nT('vscode.opened'));
        else t.error(res.detail || i18nT('vscode.notFound'));
      } catch (e) {
        t.error(i18nT('vscode.openFailed'), String(e));
      }
      return true;
    }
    case 'open-vscode-version': {
      // the file AS OF the selected commit, in VS Code (history mode only)
      if (!ctx.commitSha) return true;
      try {
        const res = await api.vscode.openFileVersion(ctx.repoPath, ctx.commitSha, ctx.path);
        if (res.ok) t.success(i18nT('vscode.opened'));
        else t.error(res.detail || i18nT('vscode.notFound'));
      } catch (e) {
        t.error(i18nT('vscode.openFailed'), String(e));
      }
      return true;
    }

    // --- Inspect --------------------------------------------------------------
    case 'show-changes':
      ctx.onShowChanges?.();
      return true;
    case 'open-diff':
      ctx.onOpenDiff?.();
      return true;
    case 'file-history':
      goTo('#/history', true);
      return true;
    case 'blame':
      // selectFile sets globalFilePath which BlamePage watches —
      // it auto-triggers the blame for this file.
      useSelectionStore.getState().selectFile(ctx.path);
      goTo('#/blame', false);
      return true;

    // --- Working-tree operations ------------------------------------------------
    case 'stage': {
      try {
        await api.git.add(ctx.repoPath, targets);
        t.success(n('Staged'));
        refresh();
      } catch (e) {
        t.error('Failed to stage', String(e));
      }
      return true;
    }
    case 'unstage': {
      try {
        for (const p of targets) await api.git.resetFile(ctx.repoPath, p);
        t.success(n('Unstaged'));
        refresh();
      } catch (e) {
        t.error('Failed to unstage', String(e));
      }
      return true;
    }
    case 'commit': {
      try {
        if (!ctx.isStaged) await api.git.add(ctx.repoPath, targets);
        refresh();
        ctx.onFocusCommit?.();
      } catch (e) {
        t.error('Failed to stage file', String(e));
      }
      return true;
    }
    case 'stash-file': {
      const msg = await promptDialog({
        title: 'Stash Selection',
        message:
          targets.length > 1
            ? `Stash ${targets.length} selected files?\nEnter an optional stash message.`
            : `Stash only '${ctx.path}'?\nEnter an optional stash message.`,
        confirmLabel: 'Stash',
        input: { placeholder: `WIP: ${baseName(ctx.path)}` },
      });
      if (msg === null) return true; // cancelled
      try {
        // Untracked files need --include-untracked, otherwise git refuses:
        // "No local changes to save" — the stash is silently NOT created.
        await api.git.stashPush(ctx.repoPath, msg.trim() || undefined, ctx.isUntracked ?? false, false, targets);
        t.success(n('Stashed'));
        refresh();
      } catch (e) {
        t.error('Stash failed', String(e));
      }
      return true;
    }
    case 'discard': {
      const what =
        targets.length > 1
          ? `${targets.length} selected files`
          : `'${ctx.path}'`;
      const ok = await confirmDialog({
        title: ctx.isStaged ? 'Discard staged changes' : 'Discard changes',
        message: ctx.isStaged
          ? `Discard staged changes for ${what}?\nThis will unstage AND restore the files to HEAD.`
          : `Discard local changes to ${what}?\nThis cannot be undone.`,
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) return true;
      try {
        if (ctx.isStaged) {
          for (const p of targets) await api.git.resetFile(ctx.repoPath, p);
          await api.git.restore(ctx.repoPath, targets);
        } else {
          await api.git.restore(ctx.repoPath, targets);
        }
        t.success(n('Discarded changes in'));
        refresh();
      } catch (e) {
        t.error('Discard failed', String(e));
      }
      return true;
    }
    case 'discard-untracked': {
      // Discard for untracked files = delete the file(s) from disk.
      // Uses git clean -f for tracked safety (won't touch .gitignored files).
      const what =
        targets.length > 1
          ? `${targets.length} selected files`
          : `'${ctx.path}'`;
      const ok = await confirmDialog({
        title: 'Discard untracked files',
        message: `Delete ${what}?\nThese files are NOT tracked by git — deleting them is permanent and cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return true;
      try {
        await api.git.clean(ctx.repoPath, targets, false, true, false);
        t.success(targets.length > 1 ? `Deleted ${targets.length} files` : `Deleted '${ctx.path}'`);
        refresh();
      } catch (e) {
        t.error('Delete failed', String(e));
      }
      return true;
    }
    case 'restore-from-ref': {
      const ref = await promptDialog({
        title: targets.length > 1 ? `Restore ${targets.length} files from a ref` : `Restore '${ctx.path}' from a ref`,
        message: 'Enter a ref (commit hash, branch, tag, HEAD~1, …). The working tree copies will be overwritten with that version.',
        confirmLabel: 'Restore',
        input: { placeholder: 'HEAD~1' },
      });
      if (!ref || !ref.trim()) return true;
      try {
        for (const p of targets) await api.git.checkoutFile(ctx.repoPath, p, ref.trim());
        t.success(targets.length > 1 ? `Restored ${targets.length} files from ${ref.trim()}` : `Restored '${ctx.path}' from ${ref.trim()}`);
        refresh();
      } catch (e) {
        t.error(`Restore from ${ref.trim()} failed`, String(e));
      }
      return true;
    }

    // --- Index flags ----------------------------------------------------------
    case 'toggle-assume-unchanged':
    case 'toggle-skip-worktree': {
      if (!ctx.indexFlags) return true;
      try {
        const flag = clickId === 'toggle-assume-unchanged' ? 'assume-unchanged' as const : 'skip-worktree' as const;
        const current = flag === 'assume-unchanged' ? ctx.indexFlags.assumeUnchanged : ctx.indexFlags.skipWorktree;
        for (const p of targets) await api.git.setIndexFlag(ctx.repoPath, p, flag, !current);
        t.success(`${!current ? 'Set' : 'Cleared'} ${flag} on ${targets.length > 1 ? `${targets.length} files` : baseName(ctx.path)}`);
        refresh();
      } catch (e) {
        t.error('Failed to update index flag', String(e));
      }
      return true;
    }

    // --- File operations -------------------------------------------------------
    case 'ignore': {
      try {
        await api.git.ignore(ctx.repoPath, targets);
        t.success('Added to .gitignore');
        refresh();
      } catch (e) {
        t.error('Failed to ignore', String(e));
      }
      return true;
    }
    case 'edit-ignore-local':
    case 'edit-ignore-global': {
      try {
        const scope = clickId === 'edit-ignore-local' ? 'local' as const : 'global' as const;
        const ignorePath = await api.git.editIgnoreFile(ctx.repoPath, scope);
        await api.git.openFile(ignorePath);
        t.success(`Opened ${scope} ignore file`);
      } catch (e) {
        t.error('Failed to open ignore file', String(e));
      }
      return true;
    }
    case 'move-rename': {
      const target = await promptDialog({
        title: 'Move or Rename',
        message: `Move or rename '${ctx.path}'\nEnter the new repository-relative path (existing directories are created automatically).`,
        confirmLabel: 'Move',
        input: { initialValue: ctx.path, placeholder: 'src/new-name.ts' },
      });
      if (!target || !target.trim() || target.trim() === ctx.path) return true;
      try {
        await api.git.moveFile(ctx.repoPath, ctx.path, target.trim());
        t.success(`Moved to ${target.trim()}`);
        refresh();
      } catch (e) {
        t.error('Move failed', String(e));
      }
      return true;
    }
    case 'delete-file': {
      const tracked =
        ctx.mode === 'changes' ? !(ctx.isUntracked ?? false) && (ctx.indexFlags?.tracked ?? true) : true;
      const what = targets.length > 1 ? `${targets.length} selected files` : `'${ctx.path}'`;
      const ok = await confirmDialog({
        title: tracked ? 'Remove file' : 'Delete file',
        message: tracked
          ? `Remove ${what} from the repository AND disk?\nThis cannot be undone.`
          : `Delete ${what} from disk?\nThis cannot be undone.`,
        confirmLabel: tracked ? 'Remove' : 'Delete',
        danger: true,
      });
      if (!ok) return true;
      try {
        for (const p of targets) await api.git.deleteFile(ctx.repoPath, p);
        t.success(n('Deleted'));
        refresh();
      } catch (e) {
        t.error('Delete failed', String(e));
      }
      return true;
    }
    case 'open-vscode-merge': {
      // VS Code three-way merge editor (stages :1/:2/:3 materialized by main).
      try {
        const res = await api.vscode.openMerge(ctx.repoPath, ctx.path);
        if (res.ok) t.success(i18nT('vscode.mergeOpened'));
        else t.error(res.detail || i18nT('vscode.notFound'));
      } catch (e) {
        t.error(i18nT('vscode.openFailed'), String(e));
      }
      return true;
    }
    case 'resolve-conflict':
      window.dispatchEvent(new CustomEvent('smartgit:resolve-conflict', { detail: { file: ctx.path } }));
      return true;

    // --- Resolve submenu (SmartGit-style) -----------------------------------------
    case 'resolve-take-ours':
      try {
        await api.git.raw(ctx.repoPath, ['checkout', '--ours', '--', ctx.path]);
        await api.git.add(ctx.repoPath, [ctx.path]);
        t.success(`Took ours: ${ctx.path}`);
        refresh();
      } catch (e) { t.error('Take ours failed', String(e)); }
      return true;
    case 'resolve-take-theirs':
      try {
        await api.git.raw(ctx.repoPath, ['checkout', '--theirs', '--', ctx.path]);
        await api.git.add(ctx.repoPath, [ctx.path]);
        t.success(`Took theirs: ${ctx.path}`);
        refresh();
      } catch (e) { t.error('Take theirs failed', String(e)); }
      return true;
    case 'resolve-mergetool':
      // Run `git mergetool -- <file>` — uses the user's configured merge.tool
      try {
        await api.git.raw(ctx.repoPath, ['mergetool', '--', ctx.path]);
        t.success('Merge tool completed');
        refresh();
      } catch (e) { t.error('Merge tool failed', String(e)); }
      return true;

    // --- Clipboard (multi-selection copies one path per line) ---------------------
    case 'copy-name':
      copyToClipboard(targets.map((p) => baseName(p)).join('\n'));
      t.success('Name copied');
      return true;
    case 'copy-rel-path':
      copyToClipboard(targets.join('\n'));
      t.success('Relative path copied');
      return true;
    case 'copy-full-path':
      copyToClipboard(targets.map((p) => fullPathOf(ctx.repoPath, p)).join('\n'));
      t.success('Full path copied');
      return true;

    // --- Directory scoping ----------------------------------------------------------
    case 'select-directory':
      ctx.onSelectDirectory?.(dirName(ctx.path) || null);
      return true;
    case 'select-root':
      ctx.onSelectDirectory?.(null);
      return true;
    default:
      return false;
  }
}
