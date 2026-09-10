/**
 * commitMenu — context menus for commit hashes and ref badges.
 *
 * Covers: menu composition (hash menu items depend on subject/repoPath;
 * ref menu items depend on ref kind), and the REAL operations behind the
 * runners (clipboard, History navigation, browser, checkout, delete
 * tag/branch with confirm).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- api mock (vi.hoisted — factories run before module top-level code) -----
const apiGitMock = vi.hoisted(() => ({
  checkout: vi.fn().mockResolvedValue(undefined),
  deleteBranch: vi.fn().mockResolvedValue(undefined),
  deleteTag: vi.fn().mockResolvedValue(undefined),
  extractRepoInfo: vi.fn().mockResolvedValue({ webUrl: 'https://git.example.com/repo' }),
}));
const apiAppMock = vi.hoisted(() => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}));
const apiContextMenuMock = vi.hoisted(() => ({
  show: vi.fn().mockResolvedValue(undefined),
  onClick: vi.fn(() => () => {}),
}));

vi.mock('../../src/lib/api', () => ({
  api: { git: apiGitMock, app: apiAppMock, contextMenu: apiContextMenuMock },
}));

// --- dialogs mock (auto-confirm; configurable per test) ----------------------
let confirmAnswer = true;
vi.mock('../../src/components/ConfirmDialog', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(confirmAnswer)),
  promptDialog: vi.fn(() => Promise.resolve(null)),
}));

import {
  buildHashMenu,
  runHashMenuAction,
  buildRefMenu,
  runRefMenuAction,
  viewCommitInHistory,
  type HashMenuCtx,
  type RefMenuCtx,
} from '../../src/lib/commitMenu';
import { parseDecoratedRef } from '../../src/lib/refBadge';
import { useSelectionStore } from '../../src/stores/selectionStore';

const HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

const hashCtx = (over: Partial<HashMenuCtx> = {}): HashMenuCtx => ({
  hash: HASH,
  subject: 'feat: add tags',
  repoPath: '/repo',
  ...over,
});

const refCtx = (over: Partial<RefMenuCtx> = {}): RefMenuCtx => ({
  parsed: parseDecoratedRef('refs/tags/v1.0'),
  hash: HASH,
  repoPath: '/repo',
  onChanged: vi.fn(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  confirmAnswer = true;
  useSelectionStore.getState().selectCommit(null);
  window.location.hash = '';
});

describe('buildHashMenu — composition', () => {
  it('always offers hash copies + View in History', () => {
    const items = buildHashMenu({ hash: HASH });
    const ids = items.map((i) => i.clickId);
    expect(ids).toContain('copy-short');
    expect(ids).toContain('copy-full');
    expect(ids).toContain('view-history');
  });

  it('adds Copy Message only when a subject is given', () => {
    expect(buildHashMenu({ hash: HASH }).map((i) => i.clickId)).not.toContain('copy-msg');
    expect(buildHashMenu(hashCtx()).map((i) => i.clickId)).toContain('copy-msg');
  });

  it('adds Open in Browser only when a repoPath is given', () => {
    expect(buildHashMenu({ hash: HASH }).map((i) => i.clickId)).not.toContain('browser');
    expect(buildHashMenu(hashCtx()).map((i) => i.clickId)).toContain('browser');
  });
});

describe('runHashMenuAction — real operations', () => {
  it('copy-short puts the 7-char hash on the clipboard', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    (navigator as any).clipboard = { writeText: write };
    await runHashMenuAction('copy-short', hashCtx());
    expect(write).toHaveBeenCalledWith(HASH.slice(0, 7));
  });

  it('copy-full puts the full hash on the clipboard', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    (navigator as any).clipboard = { writeText: write };
    await runHashMenuAction('copy-full', hashCtx());
    expect(write).toHaveBeenCalledWith(HASH);
  });

  it('copy-msg copies the subject', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    (navigator as any).clipboard = { writeText: write };
    await runHashMenuAction('copy-msg', hashCtx());
    expect(write).toHaveBeenCalledWith('feat: add tags');
  });

  it('view-history selects the commit globally and routes to History', async () => {
    await runHashMenuAction('view-history', hashCtx());
    expect(useSelectionStore.getState().selectedCommitHash).toBe(HASH);
    expect(window.location.hash).toBe('#/history');
  });

  it('view-history keeps the hash when already on /history', async () => {
    window.location.hash = '#/history';
    await runHashMenuAction('view-history', hashCtx());
    expect(window.location.hash).toBe('#/history');
  });

  it('browser resolves the web URL and opens commit/<hash>', async () => {
    await runHashMenuAction('browser', hashCtx());
    expect(apiGitMock.extractRepoInfo).toHaveBeenCalledWith('/repo');
    expect(apiAppMock.openExternal).toHaveBeenCalledWith(`https://git.example.com/repo/commit/${HASH}`);
  });

  it('browser without a web URL does not open anything', async () => {
    apiGitMock.extractRepoInfo.mockResolvedValueOnce({ webUrl: null });
    await runHashMenuAction('browser', hashCtx());
    expect(apiAppMock.openExternal).not.toHaveBeenCalled();
  });

  it('returns false for unknown ids (not consumed)', async () => {
    expect(await runHashMenuAction('nonsense', hashCtx())).toBe(false);
  });
});

describe('buildRefMenu — composition by ref kind', () => {
  it('tag: Copy Name/Full Ref + Delete Tag + View Commit', () => {
    const ids = buildRefMenu(refCtx()).map((i) => i.clickId);
    expect(ids).toContain('copy-name');
    expect(ids).toContain('copy-full-ref');
    expect(ids).toContain('delete-tag');
    expect(ids).toContain('view-commit');
    expect(ids).not.toContain('checkout-branch');
  });

  it('branch: Checkout + Delete Branch (requires repoPath)', () => {
    const ids = buildRefMenu(refCtx({ parsed: parseDecoratedRef('refs/heads/feature') })).map((i) => i.clickId);
    expect(ids).toContain('checkout-branch');
    expect(ids).toContain('delete-branch');
  });

  it('branch without repoPath: no destructive items', () => {
    const ids = buildRefMenu(refCtx({ parsed: parseDecoratedRef('refs/heads/feature'), repoPath: undefined })).map((i) => i.clickId);
    expect(ids).not.toContain('checkout-branch');
    expect(ids).not.toContain('delete-branch');
  });

  it('remote: no checkout/delete — only copies + view', () => {
    const ids = buildRefMenu(refCtx({ parsed: parseDecoratedRef('refs/remotes/origin/dev') })).map((i) => i.clickId);
    expect(ids).not.toContain('checkout-branch');
    expect(ids).not.toContain('delete-branch');
    expect(ids).not.toContain('delete-tag');
  });

  it('without a hash: no View Commit item', () => {
    const ids = buildRefMenu(refCtx({ hash: undefined })).map((i) => i.clickId);
    expect(ids).not.toContain('view-commit');
  });
});

describe('runRefMenuAction — real operations', () => {
  it('copy-name copies the clean label', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    (navigator as any).clipboard = { writeText: write };
    await runRefMenuAction('copy-name', refCtx());
    expect(write).toHaveBeenCalledWith('v1.0');
  });

  it('copy-full-ref copies the raw decoration', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    (navigator as any).clipboard = { writeText: write };
    await runRefMenuAction('copy-full-ref', refCtx());
    expect(write).toHaveBeenCalledWith('refs/tags/v1.0');
  });

  it('delete-tag (confirmed) calls deleteTag and refreshes', async () => {
    const ctx = refCtx();
    await runRefMenuAction('delete-tag', ctx);
    expect(apiGitMock.deleteTag).toHaveBeenCalledWith('/repo', 'v1.0');
    expect(ctx.onChanged).toHaveBeenCalled();
  });

  it('delete-tag cancelled does nothing', async () => {
    confirmAnswer = false;
    const ctx = refCtx();
    await runRefMenuAction('delete-tag', ctx);
    expect(apiGitMock.deleteTag).not.toHaveBeenCalled();
    expect(ctx.onChanged).not.toHaveBeenCalled();
  });

  it('delete-tag on a non-tag ref is rejected', async () => {
    expect(await runRefMenuAction('delete-tag', refCtx({ parsed: parseDecoratedRef('refs/heads/main') }))).toBe(false);
    expect(apiGitMock.deleteTag).not.toHaveBeenCalled();
  });

  it('checkout-branch calls checkout with the clean branch name', async () => {
    const ctx = refCtx({ parsed: parseDecoratedRef('refs/heads/main') });
    await runRefMenuAction('checkout-branch', ctx);
    expect(apiGitMock.checkout).toHaveBeenCalledWith('/repo', 'main');
    expect(ctx.onChanged).toHaveBeenCalled();
  });

  it('checkout-branch on a HEAD badge is rejected (not a real branch ref)', async () => {
    expect(await runRefMenuAction('checkout-branch', refCtx({ parsed: parseDecoratedRef('HEAD -> refs/heads/main') }))).toBe(false);
    expect(apiGitMock.checkout).not.toHaveBeenCalled();
  });

  it('delete-branch calls deleteBranch', async () => {
    const ctx = refCtx({ parsed: parseDecoratedRef('refs/heads/feature') });
    await runRefMenuAction('delete-branch', ctx);
    expect(apiGitMock.deleteBranch).toHaveBeenCalledWith('/repo', 'feature');
    expect(ctx.onChanged).toHaveBeenCalled();
  });

  it('view-commit selects the commit in History', async () => {
    await runRefMenuAction('view-commit', refCtx());
    expect(useSelectionStore.getState().selectedCommitHash).toBe(HASH);
  });

  it('returns false for unknown ids', async () => {
    expect(await runRefMenuAction('nonsense', refCtx())).toBe(false);
  });
});

describe('viewCommitInHistory — navigation helper', () => {
  it('sets global selection and routes to History from another page', () => {
    window.location.hash = '#/changes';
    viewCommitInHistory(HASH);
    expect(useSelectionStore.getState().selectedCommitHash).toBe(HASH);
    expect(window.location.hash).toBe('#/history');
  });
});
