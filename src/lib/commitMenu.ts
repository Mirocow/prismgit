/**
 * Unified context menus for commit hashes and git ref badges (tags/branches).
 *
 * User rule: "right-click must work on every UI element" + "clicking ANY
 * commit hash opens History with that commit selected". This module backs
 * both behaviors with REAL operations — no stubs:
 *
 *   Hash menu (on every CommitHashLink):  Copy Short/Full Hash, Copy Message,
 *     View Commit in History, Open in Browser.
 *   Ref badge menu (on every RefBadge):   Copy Name / Full Ref, Checkout
 *     (local branch), Delete Tag / Delete Branch (confirmed), View Commit.
 *
 * Builders are pure → unit-testable; runners perform the actual api.git calls
 * and always refresh via ctx.onChanged after a mutation.
 */
import { api } from './api';
import type { ContextMenuItem } from './useContextMenu';
import { confirmDialog } from '../components/ConfirmDialog';
import { copyToClipboard, shortHash } from './utils';
import { useToastStore } from '../stores/toastStore';
import { useSelectionStore } from '../stores/selectionStore';
import type { ParsedRef } from './refBadge';

const toast = () => useToastStore.getState();

/** Navigate to History focused on a commit (global selection + hash routing). */
export function viewCommitInHistory(hash: string): void {
  useSelectionStore.getState().selectCommit(hash);
  if (!window.location.hash.startsWith('#/history')) {
    window.location.hash = '#/history';
  }
}

/* ------------------------------------------------------------------ */
/* Commit hash menu                                                    */
/* ------------------------------------------------------------------ */

export interface HashMenuCtx {
  /** Full commit hash (40 hex). */
  hash: string;
  /** Commit subject — enables "Copy Commit Message". */
  subject?: string;
  /** Repo path — enables "Open in Browser" (resolves the web URL at click). */
  repoPath?: string;
}

export function buildHashMenu(ctx: HashMenuCtx): ContextMenuItem[] {
  const items: ContextMenuItem[] = [
    { label: 'Copy Short Hash', clickId: 'copy-short' },
    { label: 'Copy Full Hash', clickId: 'copy-full' },
  ];
  if (ctx.subject) items.push({ label: 'Copy Commit Message', clickId: 'copy-msg' });
  items.push({ type: 'separator' });
  items.push({ label: 'View Commit in History', clickId: 'view-history' });
  if (ctx.repoPath) items.push({ label: 'Open in Browser', clickId: 'browser' });
  return items;
}

export async function runHashMenuAction(clickId: string, ctx: HashMenuCtx): Promise<boolean> {
  switch (clickId) {
    case 'copy-short':
      copyToClipboard(shortHash(ctx.hash));
      toast().success('Copied');
      return true;
    case 'copy-full':
      copyToClipboard(ctx.hash);
      toast().success('Copied');
      return true;
    case 'copy-msg':
      if (ctx.subject) {
        copyToClipboard(ctx.subject);
        toast().success('Copied');
      }
      return true;
    case 'view-history':
      viewCommitInHistory(ctx.hash);
      return true;
    case 'browser': {
      if (!ctx.repoPath) return false;
      try {
        const info = await api.git.extractRepoInfo(ctx.repoPath);
        if (info.webUrl) {
          await api.app.openExternal(`${info.webUrl}/commit/${ctx.hash}`);
        } else {
          toast().info('No remote web URL configured for this repository');
        }
      } catch (e) {
        toast().error('Failed to open in browser', String(e));
      }
      return true;
    }
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/* Ref badge menu (tags / branches / remotes / HEAD)                   */
/* ------------------------------------------------------------------ */

export interface RefMenuCtx {
  /** Parsed decoration this badge renders. */
  parsed: ParsedRef;
  /** Commit the badge points at — enables "View Commit in History". */
  hash?: string;
  /** Repo path — enables Checkout / Delete Tag / Delete Branch. */
  repoPath?: string;
  /** Refresh after a mutation (tag/branch deleted, checkout…). */
  onChanged?: () => void;
}

export function buildRefMenu(ctx: RefMenuCtx): ContextMenuItem[] {
  const { parsed } = ctx;
  const items: ContextMenuItem[] = [
    { label: 'Copy Name', clickId: 'copy-name' },
    { label: 'Copy Full Ref', clickId: 'copy-full-ref' },
  ];
  items.push({ type: 'separator' });
  if (parsed.kind === 'branch' && ctx.repoPath) {
    items.push({ label: `Checkout '${parsed.label}'...`, clickId: 'checkout-branch' });
    items.push({ label: `Delete Branch '${parsed.label}'...`, clickId: 'delete-branch' });
    items.push({ type: 'separator' });
  }
  if (parsed.kind === 'tag' && ctx.repoPath) {
    items.push({ label: `Delete Tag '${parsed.label}'...`, clickId: 'delete-tag' });
    items.push({ type: 'separator' });
  }
  if (ctx.hash) items.push({ label: 'View Commit in History', clickId: 'view-commit' });
  return items;
}

export async function runRefMenuAction(clickId: string, ctx: RefMenuCtx): Promise<boolean> {
  const { parsed } = ctx;
  switch (clickId) {
    case 'copy-name':
      copyToClipboard(parsed.label);
      toast().success('Copied');
      return true;
    case 'copy-full-ref':
      copyToClipboard(parsed.raw);
      toast().success('Copied');
      return true;
    case 'checkout-branch': {
      if (!ctx.repoPath || parsed.kind !== 'branch') return false;
      if (!(await confirmDialog({
        title: `Checkout '${parsed.label}'`,
        message: 'Switch the working tree to this branch?\nUncommitted changes are kept if they do not conflict.',
        confirmLabel: 'Checkout',
      }))) return true;
      try {
        await api.git.checkout(ctx.repoPath, parsed.label);
        toast().success(`Checked out '${parsed.label}'`);
        ctx.onChanged?.();
      } catch (e) {
        toast().error(`Failed to checkout '${parsed.label}'`, String(e));
      }
      return true;
    }
    case 'delete-branch': {
      if (!ctx.repoPath || parsed.kind !== 'branch') return false;
      if (!(await confirmDialog({
        title: `Delete branch '${parsed.label}'`,
        message: 'This removes the branch pointer. Commits reachable from other branches or HEAD are not affected.',
        confirmLabel: 'Delete',
        danger: true,
      }))) return true;
      try {
        await api.git.deleteBranch(ctx.repoPath, parsed.label);
        toast().success(`Branch '${parsed.label}' deleted`);
        ctx.onChanged?.();
      } catch (e) {
        toast().error(`Failed to delete branch '${parsed.label}'`, String(e));
      }
      return true;
    }
    case 'delete-tag': {
      if (!ctx.repoPath || parsed.kind !== 'tag') return false;
      if (!(await confirmDialog({
        title: `Delete tag '${parsed.label}'`,
        message: 'This permanently removes the tag reference. The tagged commit is not affected.',
        confirmLabel: 'Delete',
        danger: true,
      }))) return true;
      try {
        await api.git.deleteTag(ctx.repoPath, parsed.label);
        toast().success(`Tag '${parsed.label}' deleted`);
        ctx.onChanged?.();
      } catch (e) {
        toast().error(`Failed to delete tag '${parsed.label}'`, String(e));
      }
      return true;
    }
    case 'view-commit':
      if (ctx.hash) viewCommitInHistory(ctx.hash);
      return true;
    default:
      return false;
  }
}
