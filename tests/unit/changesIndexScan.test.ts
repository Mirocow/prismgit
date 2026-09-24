/**
 * Unit tests — merged `git ls-files -v` index scan (lib/changesIndexScan).
 *
 * The Changes page used to run TWO full index walks on every repo open:
 * `git ls-files` (tracked count + unchanged list) and `git ls-files -v`
 * (assume-unchanged / skip-worktree). They are now one call parsed here —
 * these tests pin the parser, including the exact tag semantics the old
 * two loaders used (h/k/l/m/n = assume-unchanged, S = skip-worktree).
 */
import { describe, it, expect } from 'vitest';
import { LS_FILES_V_ARGS, parseLsFilesV } from '../../src/lib/changesIndexScan';

describe('LS_FILES_V_ARGS', () => {
  it('is the single argv the merged scan runs', () => {
    expect([...LS_FILES_V_ARGS]).toEqual(['ls-files', '-v']);
  });
});

describe('parseLsFilesV', () => {
  it('splits one -v listing into all four datasets', () => {
    const out = [
      'H a.txt',
      'H src/b.ts',
      'h c.lock',     // cached AND assume-unchanged
      'S d.conf',     // skip-worktree
      'R e-gone.txt', // removed from index — still a tracked entry line
    ].join('\n');
    const scan = parseLsFilesV(out);
    expect(scan.trackedTotal).toBe(5);
    expect(scan.trackedFiles).toEqual(['a.txt', 'src/b.ts', 'c.lock', 'd.conf', 'e-gone.txt']);
    expect(scan.assumeUnchanged).toEqual(['c.lock']);
    expect(scan.skipped).toEqual(['d.conf']);
  });

  it('handles all assume-unchanged tag variants the old loader accepted (h, k, l, m, n)', () => {
    const out = ['h a', 'k b', 'l c', 'm d', 'n e'].join('\n');
    const scan = parseLsFilesV(out);
    expect(scan.assumeUnchanged).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does NOT treat uppercase H/M/R or other letters as flags', () => {
    const out = ['H a', 'M b', 'R c', 'T d', '? e'].join('\n');
    const scan = parseLsFilesV(out);
    expect(scan.assumeUnchanged).toEqual([]);
    expect(scan.skipped).toEqual([]);
    expect(scan.trackedTotal).toBe(5);
  });

  it('strips git C-quoting around paths with special characters', () => {
    const out = 'H "src/uni\\303\\251.ts"'.split('\n').join('\n');
    const scan = parseLsFilesV(out);
    expect(scan.trackedFiles).toEqual(['src/uni\\303\\251.ts']);
  });

  it('empty / whitespace output → empty result, zero count', () => {
    for (const empty of ['', '\n', '\n\n']) {
      const scan = parseLsFilesV(empty);
      expect(scan.trackedTotal).toBe(0);
      expect(scan.trackedFiles).toEqual([]);
      expect(scan.assumeUnchanged).toEqual([]);
      expect(scan.skipped).toEqual([]);
    }
  });

  it('skips lines that are only a tag with no path', () => {
    const scan = parseLsFilesV('H\nH a.txt');
    expect(scan.trackedTotal).toBe(1);
    expect(scan.trackedFiles).toEqual(['a.txt']);
  });

  it('matches the OLD plain `ls-files` list when tags are stripped (merge correctness)', () => {
    // The old loadTrackedCount parsed plain `git ls-files` output; the
    // unchanged-files feature filters trackedFilesList by path. Stripping
    // the one-char tag from -v output must reproduce that list.
    const plain = ['a.txt', 'src/b.ts', 'c.lock'].join('\n');
    const verbose = ['H a.txt', 'H src/b.ts', 'h c.lock'].join('\n');
    expect(parseLsFilesV(verbose).trackedFiles).toEqual(plain.split('\n'));
  });
});
