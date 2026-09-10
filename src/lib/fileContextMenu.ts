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
import { api } from './api';
import type { ContextMenuItem } from './useContextMenu';
import { confirmDialog, promptDialog } from '../components/ConfirmDialog';
import { copyToClipboard } from './utils';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';

export interface IndexFlags {
  assumeUnchanged: boolean;
  skipWorktree: boolean;
  tracked: boolean;
}

export interface FileMenuCtx {
  /** Absolute repository path. */
  repoPath: string;
  /** Repo-relative file path. */
  path: string;
  /** Which file list the menu is opened from. */
  mode: 'changes' | 'diff' | 'history';
  /** Changes-page working-tree state. */
  isStaged?: boolean;
  isUntracked?: boolean;
  isConflict?: boolean;
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
  /** Refresh repo status after a mutation. */
  refresh?: () => void;
}

const toast = () => useToastStore.getState();

/**
 * Fetch live index flags for a file before opening the changes-mode menu
 * (so the checkbox items reflect the real `git ls-files -v` state).
 * Never throws — falls back to { tracked: true, …false } on IPC errors.
 */
export async function getIndexFlagsAsync(repoPath: string, path: string): Promise<IndexFlags> {
  try {
    return await api.git.getIndexFlags(repoPath, path);
  } catch {
    return { assumeUnchanged: false, skipWorktree: false, tracked: true };
  }
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

/** Build the menu items for a file (pure — no side effects). */
export function buildFileMenu(ctx: FileMenuCtx): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  // In changes mode the working-tree state is authoritative: an untracked
  // file is never in the index, so 'Remove...' becomes 'Delete File...'.
  const tracked =
    ctx.mode === 'changes' ? !(ctx.isUntracked ?? false) && (ctx.indexFlags?.tracked ?? true) : true;
  const untracked = ctx.mode === 'changes' && !!ctx.isUntracked;

  // --- Open ---------------------------------------------------------------
  items.push({ label: 'Open', clickId: 'open' });
  items.push({ label: 'Reveal in File Manager', clickId: 'reveal' });
  items.push({ type: 'separator' });

  // --- Inspect ------------------------------------------------------------
  if (ctx.mode === 'changes' && ctx.onShowChanges) {
    items.push({ label: 'Show Changes', clickId: 'show-changes' });
  }
  if (ctx.mode === 'history' && ctx.onOpenDiff) {
    items.push({ label: 'Open in Diff tool', clickId: 'open-diff' });
  }
  items.push({ label: 'File History (Log)', clickId: 'file-history' });
  items.push({ label: 'Blame', clickId: 'blame' });
  items.push({ type: 'separator' });

  // --- Working-tree operations (Changes mode only) -------------------------
  if (ctx.mode === 'changes') {
    if (ctx.isStaged) {
      items.push({ label: 'Unstage', clickId: 'unstage' });
    } else {
      items.push({ label: 'Stage', clickId: 'stage' });
    }
    items.push({ label: 'Commit...', clickId: 'commit' });
    if (!untracked) {
      items.push({ label: 'Stash Selection...', clickId: 'stash-file' });
      items.push({ type: 'separator' });
      items.push({
        label: ctx.isStaged ? 'Discard Staged Changes...' : 'Discard Changes...',
        clickId: 'discard',
      });
      items.push({ label: 'Restore from Ref...', clickId: 'restore-from-ref' });
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
      items.push({ label: 'Add to .gitignore', clickId: 'ignore' });
      items.push({ label: 'Edit .gitignore', clickId: 'edit-ignore-local' });
      items.push({ label: 'Edit global ignore file', clickId: 'edit-ignore-global' });
    }
    items.push({ label: 'Move or Rename...', clickId: 'move-rename' });
    items.push({
      label: tracked ? 'Remove...' : 'Delete File...',
      clickId: 'delete-file',
    });
    if (ctx.isConflict) {
      items.push({ type: 'separator' });
      items.push({ label: 'Resolve Conflict...', clickId: 'resolve-conflict' });
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
  const full = fullPathOf(ctx.repoPath, ctx.path);
  const refresh = () => ctx.refresh?.();
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
        const ok = await api.git.openFile(full);
        if (!ok) t.error(`File not found in working tree`, ctx.path);
      } catch (e) {
        t.error('Failed to open file', String(e));
      }
      return true;
    }
    case 'reveal': {
      try {
        const ok = await api.git.revealInFileManager(full);
        if (!ok) t.error(`File not found in working tree`, ctx.path);
      } catch (e) {
        t.error('Failed to reveal', String(e));
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
      goTo('#/blame', false);
      return true;

    // --- Working-tree operations ------------------------------------------------
    case 'stage': {
      try {
        await api.git.add(ctx.repoPath, [ctx.path]);
        t.success(`Staged ${baseName(ctx.path)}`);
        refresh();
      } catch (e) {
        t.error('Failed to stage', String(e));
      }
      return true;
    }
    case 'unstage': {
      try {
        await api.git.resetFile(ctx.repoPath, ctx.path);
        t.success(`Unstaged ${baseName(ctx.path)}`);
        refresh();
      } catch (e) {
        t.error('Failed to unstage', String(e));
      }
      return true;
    }
    case 'commit': {
      try {
        if (!ctx.isStaged) await api.git.add(ctx.repoPath, [ctx.path]);
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
        message: `Stash only '${ctx.path}'?\nEnter an optional stash message.`,
        confirmLabel: 'Stash',
        input: { placeholder: `WIP: ${baseName(ctx.path)}` },
      });
      if (msg === null) return true; // cancelled
      try {
        await api.git.stashPush(ctx.repoPath, msg.trim() || undefined, false, false, [ctx.path]);
        t.success(`Stashed ${baseName(ctx.path)}`);
        refresh();
      } catch (e) {
        t.error('Stash failed', String(e));
      }
      return true;
    }
    case 'discard': {
      const ok = await confirmDialog({
        title: ctx.isStaged ? 'Discard staged changes' : 'Discard changes',
        message: ctx.isStaged
          ? `Discard staged changes for '${ctx.path}'?\nThis will unstage AND restore the file to HEAD.`
          : `Discard local changes to '${ctx.path}'?\nThis cannot be undone.`,
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) return true;
      try {
        if (ctx.isStaged) {
          await api.git.resetFile(ctx.repoPath, ctx.path);
          await api.git.restore(ctx.repoPath, [ctx.path]);
        } else {
          await api.git.restore(ctx.repoPath, [ctx.path]);
        }
        t.success(`Discarded changes in ${baseName(ctx.path)}`);
        refresh();
      } catch (e) {
        t.error('Discard failed', String(e));
      }
      return true;
    }
    case 'restore-from-ref': {
      const ref = await promptDialog({
        title: `Restore '${ctx.path}' from a ref`,
        message: 'Enter a ref (commit hash, branch, tag, HEAD~1, …). The working tree copy will be overwritten with that version.',
        confirmLabel: 'Restore',
        input: { placeholder: 'HEAD~1' },
      });
      if (!ref || !ref.trim()) return true;
      try {
        await api.git.checkoutFile(ctx.repoPath, ctx.path, ref.trim());
        t.success(`Restored '${ctx.path}' from ${ref.trim()}`);
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
        await api.git.setIndexFlag(ctx.repoPath, ctx.path, flag, !current);
        t.success(`${!current ? 'Set' : 'Cleared'} ${flag} on ${baseName(ctx.path)}`);
        refresh();
      } catch (e) {
        t.error('Failed to update index flag', String(e));
      }
      return true;
    }

    // --- File operations -------------------------------------------------------
    case 'ignore': {
      try {
        await api.git.ignore(ctx.repoPath, [ctx.path]);
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
      const ok = await confirmDialog({
        title: tracked ? 'Remove file' : 'Delete file',
        message: tracked
          ? `Remove '${ctx.path}' from the repository AND disk?\nThis cannot be undone.`
          : `Delete '${ctx.path}' from disk?\nThis cannot be undone.`,
        confirmLabel: tracked ? 'Remove' : 'Delete',
        danger: true,
      });
      if (!ok) return true;
      try {
        await api.git.deleteFile(ctx.repoPath, ctx.path);
        t.success(`Deleted ${baseName(ctx.path)}`);
        refresh();
      } catch (e) {
        t.error('Delete failed', String(e));
      }
      return true;
    }
    case 'resolve-conflict':
      window.dispatchEvent(new CustomEvent('smartgit:resolve-conflict', { detail: { file: ctx.path } }));
      return true;

    // --- Clipboard ---------------------------------------------------------------
    case 'copy-name':
      copyToClipboard(baseName(ctx.path));
      t.success('Name copied');
      return true;
    case 'copy-rel-path':
      copyToClipboard(ctx.path);
      t.success('Relative path copied');
      return true;
    case 'copy-full-path':
      copyToClipboard(full);
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
