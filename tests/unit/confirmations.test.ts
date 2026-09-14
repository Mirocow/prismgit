import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the dialog layer — confirmations.ts is a thin policy wrapper, the
// dialog rendering itself is covered by component/e2e layers.
vi.mock('../../src/components/ConfirmDialog', () => ({
  confirmDialogEx: vi.fn(),
  confirmDialog: vi.fn(),
  promptDialog: vi.fn(),
}));

import { confirmDialogEx } from '../../src/components/ConfirmDialog';
import { confirmWithRemember, restoreAllConfirmations, CONFIRMATION_IDS } from '../../src/lib/confirmations';
import { useSettingsStore } from '../../src/stores/settingsStore';

const dialogMock = vi.mocked(confirmDialogEx);

function setConfirmations(map: Record<string, 'ask' | 'always' | 'never'> | undefined) {
  useSettingsStore.setState({ settings: map ? { confirmations: map } : {} });
}

beforeEach(() => {
  dialogMock.mockReset();
  setConfirmations(undefined);
});

describe('confirmWithRemember (4.5 — confirmation registry)', () => {
  it("saved 'always' auto-confirms without opening the dialog", async () => {
    setConfirmations({ [CONFIRMATION_IDS.stashDrop]: 'always' });
    const ok = await confirmWithRemember(CONFIRMATION_IDS.stashDrop, { title: 'Drop?' });
    expect(ok).toBe(true);
    expect(dialogMock).not.toHaveBeenCalled();
  });

  it("saved 'never' auto-cancels without opening the dialog", async () => {
    setConfirmations({ [CONFIRMATION_IDS.stashDrop]: 'never' });
    const ok = await confirmWithRemember(CONFIRMATION_IDS.stashDrop, { title: 'Drop?' });
    expect(ok).toBe(false);
    expect(dialogMock).not.toHaveBeenCalled();
  });

  it("default 'ask' opens the dialog and returns its answer", async () => {
    dialogMock.mockResolvedValueOnce({ ok: true, checked: false });
    const ok = await confirmWithRemember(CONFIRMATION_IDS.stashDrop, { title: 'Drop?' });
    expect(ok).toBe(true);
    expect(dialogMock).toHaveBeenCalledTimes(1);
    // The dialog receives a checkbox option ("Don't ask again")
    expect(dialogMock.mock.calls[0][0].checkbox).toBeDefined();
    // Nothing persisted when the checkbox was NOT checked
    expect(useSettingsStore.getState().settings.confirmations).toBeUndefined();
  });

  it("confirm + checked persists 'always'", async () => {
    dialogMock.mockResolvedValueOnce({ ok: true, checked: true });
    await confirmWithRemember(CONFIRMATION_IDS.discardChanges, { title: 'Discard?' });
    const saved = useSettingsStore.getState().settings.confirmations;
    expect(saved?.[CONFIRMATION_IDS.discardChanges]).toBe('always');
  });

  it("cancel + checked persists 'never'", async () => {
    dialogMock.mockResolvedValueOnce({ ok: false, checked: true });
    await confirmWithRemember(CONFIRMATION_IDS.discardChanges, { title: 'Discard?' });
    const saved = useSettingsStore.getState().settings.confirmations;
    expect(saved?.[CONFIRMATION_IDS.discardChanges]).toBe('never');
  });

  it('a failed settings write does not break the answer', async () => {
    dialogMock.mockResolvedValueOnce({ ok: true, checked: true });
    vi.spyOn(useSettingsStore.getState(), 'setSetting').mockRejectedValueOnce(new Error('disk full'));
    const ok = await confirmWithRemember(CONFIRMATION_IDS.branchDelete, { title: 'Delete?' });
    expect(ok).toBe(true);
  });
});

describe('restoreAllConfirmations (4.5 — Restore all button)', () => {
  it('clears the registry so dialogs ask again', async () => {
    setConfirmations({ [CONFIRMATION_IDS.stashDrop]: 'never' });
    await restoreAllConfirmations();
    const saved = useSettingsStore.getState().settings.confirmations;
    expect(saved).toEqual({});
    // after restore, the dialog is used again
    dialogMock.mockResolvedValueOnce({ ok: true, checked: false });
    const ok = await confirmWithRemember(CONFIRMATION_IDS.stashDrop, { title: 'Drop?' });
    expect(ok).toBe(true);
  });
});

describe('CONFIRMATION_IDS registry', () => {
  it('exposes the phase-2/4.5 dialog ids', () => {
    expect(CONFIRMATION_IDS.stashDrop).toBe('stash.drop');
    expect(CONFIRMATION_IDS.discardChanges).toBe('changes.discard');
    expect(CONFIRMATION_IDS.branchDelete).toBe('branch.delete');
    expect(CONFIRMATION_IDS.branchForceDelete).toBe('branch.forceDelete');
    expect(CONFIRMATION_IDS.checkoutSubmoduleChange).toBe('checkout.submoduleChange');
    expect(CONFIRMATION_IDS.commitPushedModify).toBe('commit.pushedModify');
  });
});
