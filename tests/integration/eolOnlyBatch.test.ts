/**
 * Integration — BATCH EOL-only detection (filesWithRealChanges).
 *
 * PERF (v3.1) regression pin: the Changes page's EOL-detection effect used
 * to fire up to 100 PER-FILE `git diff --ignore-cr-at-eol -- <file>`
 * subprocesses per status refresh (every ~5s watcher tick). The batch API
 * replaces them with one chunked `--name-only -z` diff.
 *
 * Pinned here against a real git repo:
 *   1. SEMANTIC PARITY — for every file, the batch answer matches the old
 *      per-file isEolOnlyChange() answer (real change ↔ not EOL-only).
 *   2. EOL-ONLY files are NOT reported as real changes; content edits ARE.
 *   3. CHUNKING — more than 40 files (the per-chunk cap) still yields the
 *      exact correct subset (multiple chunks join correctly).
 *   4. Empty input → empty output (no spawns).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import * as gitService from '../../electron/services/git';

const ROOT = path.join(os.tmpdir(), 'prismgit-repos', 'eol-batch');

function shell(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

describe('filesWithRealChanges (batch EOL detection)', () => {
  let work: string;

  beforeAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.mkdirSync(ROOT, { recursive: true });
    process.env.GIT_CONFIG_GLOBAL = path.join(ROOT, 'empty-gitconfig');
    fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '');

    shell('git init -q -b main work', ROOT);
    work = path.join(ROOT, 'work');
    shell('git config user.name "Ivan Testov"', work);
    shell('git config user.email "ivan@test.dev"', work);
    shell('git config core.autocrlf false', work);

    // 45 files (> chunk cap 40) so the multi-chunk path is exercised.
    for (let i = 0; i < 45; i++) {
      fs.writeFileSync(path.join(work, `f${String(i).padStart(2, '0')}.txt`), `line1\nline2\n`);
    }
    // Baseline committed with LF endings.
    shell('git add -A', work);
    shell('git commit -q -m base', work);

    // EOL-ONLY edits: same bytes, CRLF endings (files 0-19).
    for (let i = 0; i < 20; i++) {
      fs.writeFileSync(path.join(work, `f${String(i).padStart(2, '0')}.txt`), 'line1\r\nline2\r\n');
    }
    // REAL edits: content actually changed (files 20-29).
    for (let i = 20; i < 30; i++) {
      fs.writeFileSync(path.join(work, `f${String(i).padStart(2, '0')}.txt`), 'line1\nline2 CHANGED\n');
    }
    // Files 30-44 untouched.
  });

  afterAll(() => {
    delete process.env.GIT_CONFIG_GLOBAL;
    fs.rmSync(ROOT, { recursive: true, force: true });
  });

  it('empty input → empty output', async () => {
    expect(await gitService.filesWithRealChanges(work, [])).toEqual([]);
  });

  it('reports content edits, not EOL-only edits — with 45 files (multi-chunk)', async () => {
    const all = fs.readdirSync(work).filter((f) => f.endsWith('.txt')).sort();
    expect(all.length).toBe(45); // fixture sanity: > 40 chunk cap
    const real = new Set(await gitService.filesWithRealChanges(work, all));
    // Exactly the 10 content-edited files.
    const expectedReal = new Set(
      Array.from({ length: 10 }, (_, k) => `f${String(20 + k).padStart(2, '0')}.txt`)
    );
    expect(real).toEqual(expectedReal);
  });

  it('SEMANTIC PARITY with the old per-file isEolOnlyChange() for every file', async () => {
    const all = fs.readdirSync(work).filter((f) => f.endsWith('.txt')).sort();
    const real = new Set(await gitService.filesWithRealChanges(work, all));
    for (const f of all) {
      const eolOnly = await gitService.isEolOnlyChange(work, f);
      // eolOnly === true ⟺ NOT in the real-changes set.
      expect(eolOnly).toBe(!real.has(f));
    }
  });

  it('wall-clock: batch (2 chunks) beats 45 per-file spawns by a wide margin', async () => {
    const all = fs.readdirSync(work).filter((f) => f.endsWith('.txt')).sort();
    // Batch: 45 files → 2 chunks → 2 subprocesses.
    const t0 = Date.now();
    await gitService.filesWithRealChanges(work, all);
    const batchMs = Date.now() - t0;
    // Old path: 45 sequential-ish per-file spawns (concurrency 4 in the
    // renderer; here sequential — same order of magnitude).
    const t1 = Date.now();
    for (const f of all) await gitService.isEolOnlyChange(work, f);
    const perFileMs = Date.now() - t1;
    // Generous threshold (CI jitter): per-file must be at least 2x slower.
    expect(perFileMs).toBeGreaterThan(batchMs * 2);
  });

  it('a vanished pathspec degrades exactly like the old per-file call (empty diff = EOL-only)', async () => {
    // `git diff -- <unknown-pathspec>` does NOT fail — it prints nothing
    // (exit 0). The old per-file isEolOnlyChange() therefore reported a
    // vanished file as EOL-only; the batch must agree (parity, no
    // exception path).
    const gone = 'deleted-between-status-and-diff.txt';
    const oldAnswer = await gitService.isEolOnlyChange(work, gone);
    expect(oldAnswer).toBe(true); // empty diff → "EOL-only" — the old quirk
    const res = await gitService.filesWithRealChanges(work, [gone, 'f20.txt']);
    expect(res).toEqual(['f20.txt']); // gone NOT reported as a real change
  });
});
