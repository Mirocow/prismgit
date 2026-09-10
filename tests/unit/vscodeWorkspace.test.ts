/**
 * buildWorkspaceJson — the pure core of the VS Code multi-root workspace
 * integration ("Open group in VS Code"). The file content must stay a valid
 * .code-workspace document: folders in the given order, absolute paths.
 */
import { describe, it, expect } from 'vitest';
import { buildWorkspaceJson } from '../../electron/services/vscode';

describe('buildWorkspaceJson', () => {
  it('creates a valid multi-root workspace with folders in the given order', () => {
    const parsed = JSON.parse(buildWorkspaceJson(['/home/user/app', '/home/user/lib']));
    expect(parsed.folders).toEqual([{ path: '/home/user/app' }, { path: '/home/user/lib' }]);
    expect(parsed.settings).toEqual({});
  });

  it('supports a single folder (group with one repo)', () => {
    const parsed = JSON.parse(buildWorkspaceJson(['/repo/only']));
    expect(parsed.folders).toEqual([{ path: '/repo/only' }]);
  });

  it('preserves paths with spaces and OS separators verbatim', () => {
    const paths = ['C:\\Users\\me\\My Repo', '/home/user/my repo'];
    const parsed = JSON.parse(buildWorkspaceJson(paths));
    expect(parsed.folders.map((f: { path: string }) => f.path)).toEqual(paths);
  });

  it('returns stable JSON for identical input (idempotent generation)', () => {
    const a = buildWorkspaceJson(['/r1', '/r2']);
    const b = buildWorkspaceJson(['/r1', '/r2']);
    expect(a).toBe(b);
  });
});
