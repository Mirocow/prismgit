/**
 * Folder repository flow (v2.3) — «репозитории из папок должны добавляться
 * рекурсивно — все, что есть в папке и подпапках, образуя группы по
 * названию папок».
 *
 * Shared by every entry point (Sidebar button + context menu + folder
 * drag&drop, WelcomeScreen, Command Palette): pick folder → dry-run scan →
 * confirm with a preview list → add with a group tree mirroring the folder
 * structure → toasts.
 */
import { api } from './api';
import { t } from './i18n';
import { confirmDialog } from '../components/ConfirmDialog';
import { useRepositoryStore } from '../stores/repositoryStore';
import { useToastStore } from '../stores/toastStore';

/** Longest preview list stuffed into the confirm dialog body. */
const PREVIEW_LIMIT = 30;

function basename(p: string): string {
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

/**
 * Full interactive flow for a CHOSEN folder path: scan → confirm → add.
 * Returns the add result, or null when nothing was added (cancelled /
 * empty / failed — the toast is already shown).
 */
export async function addFolderFlow(folder: string): Promise<{
  added: number;
  existing: number;
  groupsCreated: number;
  rootGroupName: string;
} | null> {
  const toast = useToastStore.getState();
  // 1. Dry-run scan — the list powers the confirm dialog so the user sees
  //    exactly what will land in the sidebar BEFORE anything is written.
  let scanned: Awaited<ReturnType<typeof api.settings.scanFolderRepos>>;
  try {
    scanned = await api.settings.scanFolderRepos(folder);
  } catch (e) {
    toast.error(t('shell.scanFolderFailed'), e instanceof Error ? e.message : String(e));
    return null;
  }
  if (scanned.length === 0) {
    toast.warning(
      t('shell.scanFolderNoneTitle'),
      t('shell.scanFolderNoneBody', { folder }),
    );
    return null;
  }

  // 2. Preview list — "group path / repo name", capped for readability.
  const lines = scanned
    .slice(0, PREVIEW_LIMIT)
    .map((r) => (r.groupPath.length ? `${r.groupPath.join(' / ')} / ${r.name}` : r.name));
  if (scanned.length > PREVIEW_LIMIT) {
    lines.push(`… +${scanned.length - PREVIEW_LIMIT}`);
  }
  const ok = await confirmDialog({
    title: t('shell.scanFolderConfirmTitle', { count: scanned.length }),
    message: t('shell.scanFolderConfirmBody', {
      folder: basename(folder),
      list: lines.join('\n'),
    }),
    confirmLabel: t('common.add'),
  });
  if (!ok) return null;

  // 3. Scan + groups + repos in one main-process transaction.
  try {
    const result = await api.settings.addFolderRepositories(folder);
    // Refresh the sidebar tree + metadata so the new groups/repos appear.
    await useRepositoryStore.getState().loadRepos();
    void useRepositoryStore.getState().loadMetadata();
    toast.success(
      t('shell.scanFolderAddedTitle'),
      t('shell.scanFolderAddedBody', {
        added: result.added,
        existing: result.existing,
        groups: result.groupsCreated,
      }),
    );
    return result;
  } catch (e) {
    toast.error(t('shell.scanFolderFailed'), e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Folder PICKER + flow — the entry point for buttons/menu items.
 * Returns silently when the user cancels the OS dialog.
 */
export async function addFolderFromPickerFlow(): Promise<void> {
  const folder = await api.fs.openDirectoryPicker();
  if (!folder) return;
  await addFolderFlow(folder);
}
