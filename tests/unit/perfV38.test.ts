/**
 * v3.8 perf + search-navigation pins.
 *
 *  1. gitRawCore.rawJobIsAllowed — the shared allow-list that decides which
 *     read commands the coalescedRaw router moves into the git worker:
 *     must cover the full read surface (log/for-each-ref/reflog/notes/-C
 *     forms) and keep rejecting injection vectors.
 *  2. commandLog.recordExternalSpawn — worker-origin entries land in the
 *     same ring buffer with origin='worker' (the Operations console shows
 *     BOTH realms — the "тупит" diagnosis depends on honest instrumentation).
 *  3. selectionStore.blameFocusLine — the one-shot Search → Blame focus.
 *  4. aiTools — search_code / blame_file are registered and answer with
 *     REAL data from the api layer (mocked), matching the Search/Blame
 *     tool engines.
 *  5. FilterInput — the clear (✕) affordance + Esc reset the filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 1. gitRawCore ────────────────────────────────────────────────────────
import { rawJobIsAllowed } from '../../electron/services/gitRawCore';

describe('rawJobIsAllowed (v3.8 read router gate)', () => {
  it('allows the core read commands', () => {
    for (const args of [
      ['log', '-50', '--pretty=format:%H'],
      ['for-each-ref', '--format=%(refname)'],
      ['stash', 'list'],
      ['reflog', '--all', '--format=%H'],
      ['rev-list', '--remotes', '--not', '--branches'],
      ['rev-parse', 'HEAD'],
      ['show', '--numstat', '--format=', 'abc123'],
      ['grep', '-n', 'pattern'],
    ]) {
      expect(rawJobIsAllowed(args as string[]), args.join(' ')).toBe(true);
    }
  });

  it('parses -C <path> forms to the real subcommand (notes helpers)', () => {
    expect(rawJobIsAllowed(['-C', '/repo', 'notes', 'show', 'abc'])).toBe(true);
    expect(rawJobIsAllowed(['-C', '/repo', 'log', '-1'])).toBe(true);
    // global -c options are skipped too
    expect(rawJobIsAllowed(['-c', 'core.quotePath=false', 'show', 'x'])).toBe(true);
  });

  it('rejects non-read commands and injection vectors', () => {
    expect(rawJobIsAllowed(['commit', '-m', 'x'])).toBe(false);
    expect(rawJobIsAllowed(['push', 'origin'])).toBe(false);
    expect(rawJobIsAllowed(['reset', '--hard'])).toBe(false);
    expect(rawJobIsAllowed(['log', '--exec=x'])).toBe(false);
    expect(rawJobIsAllowed(['for-each-ref', '!sh'])).toBe(false);
    expect(rawJobIsAllowed([])).toBe(false);
  });
});

// ── 2. commandLog.recordExternalSpawn ────────────────────────────────────
import { recordExternalSpawn, listEntries, resetForTests } from '../../electron/services/commandLog';

describe('recordExternalSpawn (worker-origin observability)', () => {
  beforeEach(() => resetForTests());

  it('records a worker entry with origin=worker and sanitized args', () => {
    const onEntry = vi.fn();
    // recordExternalSpawn fires the installed onEntry callback if present;
    // install one via installGitCommandLogger is heavier — assert the buffer.
    recordExternalSpawn({
      args: ['log', '-1', 'http://user:secret@host/repo.git'],
      cwd: '/repo',
      exitCode: 0,
      durationMs: 42,
    });
    const entries = listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].origin).toBe('worker');
    expect(entries[0].exitCode).toBe(0);
    expect(entries[0].durationMs).toBe(42);
    expect(entries[0].repo).toBe('/repo');
    // credentials in argv are redacted
    expect(entries[0].args.join(' ')).toContain('http://***@host/repo.git');
    expect(onEntry).not.toHaveBeenCalled();
  });

  it('caps at the ring buffer size like local entries', () => {
    for (let i = 0; i < 510; i++) {
      recordExternalSpawn({ args: ['status'], cwd: '/r', exitCode: 0, durationMs: 1 });
    }
    expect(listEntries().length).toBeLessThanOrEqual(500);
  });
});

// ── 3. selectionStore.blameFocusLine ─────────────────────────────────────
import { useSelectionStore } from '../../src/stores/selectionStore';

describe('selectionStore.blameFocusLine (Search → Blame focus)', () => {
  beforeEach(() => useSelectionStore.getState().clearAll());

  it('defaults to null, sets and clears', () => {
    expect(useSelectionStore.getState().blameFocusLine).toBeNull();
    useSelectionStore.getState().setBlameFocusLine(42);
    expect(useSelectionStore.getState().blameFocusLine).toBe(42);
    useSelectionStore.getState().setBlameFocusLine(null);
    expect(useSelectionStore.getState().blameFocusLine).toBeNull();
  });

  it('is wiped by clearAll (cross-repo reset)', () => {
    useSelectionStore.getState().setBlameFocusLine(7);
    useSelectionStore.getState().clearAll();
    expect(useSelectionStore.getState().blameFocusLine).toBeNull();
  });
});

// ── 4. aiTools: search_code / blame_file ─────────────────────────────────
// jsdom has no preload bridge — replace the api module surface the tools touch.
vi.mock('../../src/lib/api', () => ({
  api: {
    git: { grep: vi.fn(), blame: vi.fn(), status: vi.fn() },
    ai: {},
    repos: {},
  },
}));
import { AI_TOOLS, getTool } from '../../src/lib/aiTools';
import { api } from '../../src/lib/api';

describe('aiTools v3.8 — search_code / blame_file', () => {
  it('both tools are registered', () => {
    expect(AI_TOOLS.map(t => t.name)).toContain('search_code');
    expect(AI_TOOLS.map(t => t.name)).toContain('blame_file');
  });

  it('search_code returns file:line:text matches and handles exit-1 as no-matches', async () => {
    const grep = vi.spyOn(api.git, 'grep')
      .mockResolvedValueOnce('src/a.ts:12:hello()\nsrc/b.ts:30:hello()')
      .mockRejectedValueOnce(new Error('grep failed with exit code 1'));
    const tool = getTool('search_code')!;
    const out = await tool.execute({ pattern: 'hello()' }, '/repo');
    expect(out).toContain('src/a.ts:12:hello()');
    expect(out).toContain('2 match(es)');
    const none = await tool.execute({ pattern: 'zzz' }, '/repo');
    expect(none).toContain('No matches');
    expect(grep).toHaveBeenCalledWith('/repo', 'hello()', ['--line-number'], undefined);
    grep.mockRestore();
  });

  it('search_code passes pathspec and -i through', async () => {
    const grep = vi.spyOn(api.git, 'grep').mockResolvedValue('x:1:y');
    await getTool('search_code')!.execute({ pattern: 'x', ignore_case: true, pathspec: 'src/**' }, '/r');
    expect(grep).toHaveBeenCalledWith('/r', 'x', ['--line-number', '-i'], 'src/**');
    grep.mockRestore();
  });

  it('blame_file groups consecutive lines into commit blocks', async () => {
    const blame = vi.spyOn(api.git, 'blame').mockResolvedValue({
      file: 'f.ts', totalLines: 3,
      lines: [
        { hash: 'aaaa', hashAbbrev: 'aaaa', author: 'Ann', authorTime: '2024-01-01', summary: 'first', finalLineNumber: 1, content: 'a' },
        { hash: 'aaaa', hashAbbrev: 'aaaa', author: 'Ann', authorTime: '2024-01-01', summary: 'first', finalLineNumber: 2, content: 'b' },
        { hash: 'bbbb', hashAbbrev: 'bbbb', author: 'Bob', authorTime: '2024-02-01', summary: 'second', finalLineNumber: 3, content: 'c' },
      ],
    } as never);
    const out = await getTool('blame_file')!.execute({ file: 'f.ts' }, '/repo');
    expect(out).toContain('1-2  aaaa  Ann');
    expect(out).toContain('3  bbbb  Bob');
    expect(out).toContain('f.ts');
    blame.mockRestore();
  });
});

// ── 5. FilterInput clear affordance ──────────────────────────────────────
// (JSX — lives in tests/components/FilterInput.clear.test.tsx)

