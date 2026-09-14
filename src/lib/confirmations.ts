/**
 * confirmations.ts — SmartGit-style confirmation registry (phase 4.5).
 *
 * Every destructive action that supports "Don't ask again" goes through
 * confirmWithRemember() instead of calling confirmDialog() directly. The
 * user's choice persists in settings.confirmations:
 *
 *   { [id]: 'ask' | 'always' | 'never' }
 *
 *   Confirm + checked → 'always' — the dialog auto-confirms from now on.
 *   Cancel  + checked → 'never'  — the action is silently skipped.
 *
 * Settings → Appearance → "Restore all confirmation dialogs" calls
 * restoreAllConfirmations() to clear the map so every dialog asks again.
 *
 * Ids are string constants (not a union type) so new dialogs can be added
 * without touching this module's public surface — but keep them grouped
 * here for discoverability. Unknown ids behave as 'ask'.
 */
import { confirmDialogEx, type ConfirmDialogOptions } from '../components/ConfirmDialog';
import { useSettingsStore } from '../stores/settingsStore';
import { t } from './i18n';

/** Known confirmation ids — keep in sync with new confirmWithRemember callers. */
export const CONFIRMATION_IDS = {
  /** Stash drop (StashesPage / BranchesPage stash section). */
  stashDrop: 'stash.drop',
  /** Discard working-tree changes of a file. */
  discardChanges: 'changes.discard',
  /** Delete a (local) branch. */
  branchDelete: 'branch.delete',
  /** Force-delete a not-fully-merged branch (unmerged commits → Recyclable). */
  branchForceDelete: 'branch.forceDelete',
  /** Checkout that would change .gitmodules (phase 2.1). */
  checkoutSubmoduleChange: 'checkout.submoduleChange',
  /** Amend / otherwise modify a commit that was already pushed (phase 0.1). */
  commitPushedModify: 'commit.pushedModify',
} as const;

export type ConfirmationId = (typeof CONFIRMATION_IDS)[keyof typeof CONFIRMATION_IDS];

type ConfirmationChoice = 'ask' | 'always' | 'never';

/** Extra options accepted by confirmWithRemember on top of ConfirmDialogOptions. */
export interface ConfirmRememberOptions extends Omit<ConfirmDialogOptions, 'checkbox'> {
  /** Checkbox label override. Default: t('confirmations.dontAskAgain'). */
  dontAskAgainLabel?: string;
}

/**
 * Ask for confirmation with a persistent "Don't ask again" checkbox.
 *
 * Resolution order:
 *   1. settings.confirmations[id] === 'always' → resolve true (no dialog)
 *   2. settings.confirmations[id] === 'never'  → resolve false (no dialog)
 *   3. otherwise → confirmDialogEx with the checkbox; a checked answer
 *      persists the choice ('always' on confirm, 'never' on cancel).
 *
 * Persisting failures are swallowed — a broken settings write must not
 * block the user's actual action.
 */
export async function confirmWithRemember(
  id: ConfirmationId | string,
  opts: ConfirmRememberOptions
): Promise<boolean> {
  const store = useSettingsStore.getState();
  const saved = (store.settings.confirmations?.[id] ?? 'ask') as ConfirmationChoice;
  if (saved === 'always') return true;
  if (saved === 'never') return false;

  const { dontAskAgainLabel, ...dialogOpts } = opts;
  const { ok, checked } = await confirmDialogEx({
    ...dialogOpts,
    checkbox: { label: dontAskAgainLabel ?? t('confirmations.dontAskAgain') },
  });
  if (checked) {
    const next = {
      ...(useSettingsStore.getState().settings.confirmations ?? {}),
      [id]: ok ? 'always' : 'never',
    } as Record<string, 'ask' | 'always' | 'never'>;
    try {
      await useSettingsStore.getState().setSetting('confirmations', next);
    } catch {
      // Non-fatal: the current action still honors the user's answer.
    }
  }
  return ok;
}

/**
 * Settings → Appearance → "Restore all confirmation dialogs".
 * Clears the persisted registry so every confirmation asks again.
 */
export async function restoreAllConfirmations(): Promise<void> {
  await useSettingsStore.getState().setSetting('confirmations', {});
}
