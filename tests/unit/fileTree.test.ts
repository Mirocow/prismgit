import { describe, it, expect } from 'vitest';
import { buildFileTree, filterFiles, type FileEntry } from '@/lib/fileTree';

const f = (path: string, status: FileEntry['status'] = 'M', staged = false): FileEntry => ({
  path,
  status,
  staged,
});

describe('buildFileTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it('flattens files into rows with correct depth', () => {
    const rows = buildFileTree([f('src/a.ts'), f('src/lib/b.ts'), f('README.md')]);
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('README.md');
    expect(labels).toContain('src'); // folder
    expect(rows.find((r) => r.label === 'src')!.depth).toBe(0);
    const b = rows.find((r) => r.isFile && r.path === 'src/lib/b.ts');
    expect(b!.depth).toBeGreaterThan(0);
  });

  it('compress=true collapses single-child folder chains into the file row', () => {
    const rows = buildFileTree([f('src/components/deep/file.ts')], true);
    // The whole chain collapses INTO the file row — a single row total
    expect(rows.length).toBe(1);
    expect(rows[0].isFile).toBe(true);
    expect(rows[0].label).toBe('src/components/deep/file.ts');
    expect(rows[0].path).toBe('src/components/deep/file.ts');
  });

  it('compress=false keeps every folder level', () => {
    const rows = buildFileTree([f('src/components/deep/file.ts')], false);
    const folders = rows.filter((r) => !r.isFile).map((r) => r.label);
    expect(folders).toEqual(['src', 'components', 'deep']);
  });

  it('branching folders are not compressed', () => {
    const rows = buildFileTree([f('src/a.ts'), f('src/b.ts')], true);
    const folders = rows.filter((r) => !r.isFile);
    expect(folders.length).toBe(1);
    expect(folders[0].label).toBe('src');
    expect(folders[0].childCount).toBe(2);
  });

  it('file rows carry their entry (path, status, staged)', () => {
    const entry = f('src/app.ts', 'A', true);
    const rows = buildFileTree([entry]);
    const fileRow = rows.find((r) => r.isFile)!;
    expect(fileRow.entry).toEqual(entry);
    expect(fileRow.path).toBe('src/app.ts');
  });

  it('aggregates staged/modified/added/deleted counts in subtrees', () => {
    const files = [
      f('src/a.ts', 'M', true),  // staged + modified
      f('src/b.ts', 'M', false), // modified
      f('src/lib/c.ts', 'A', false), // added (single-child chain → file row)
      f('docs/d.md', 'D', false),    // deleted (single-child chain → file row)
    ];
    const rows = buildFileTree(files);
    const src = rows.find((r) => !r.isFile && r.label === 'src')!;
    expect(src.stagedCount).toBe(1);
    expect(src.modifiedCount).toBe(2);
    expect(src.addedCount).toBe(1);
    // Compressed single-child chains become file rows carrying their own aggregates
    const c = rows.find((r) => r.isFile && r.path === 'src/lib/c.ts')!;
    expect(c.addedCount).toBe(1);
    const d = rows.find((r) => r.isFile && r.path === 'docs/d.md')!;
    expect(d.deletedCount).toBe(1);
    expect(d.modifiedCount).toBe(0);
  });

  it('counts renames and type-changes as modified', () => {
    const rows = buildFileTree([f('x/old.ts', 'R', false), f('y/t.ts', 'T', false)]);
    const oldF = rows.find((r) => r.isFile && r.path === 'x/old.ts')!;
    const t = rows.find((r) => r.isFile && r.path === 'y/t.ts')!;
    expect(oldF.modifiedCount).toBe(1);
    expect(t.modifiedCount).toBe(1);
  });
});

describe('filterFiles', () => {
  const files: FileEntry[] = [
    f('src/App.tsx', 'M', true),
    f('src/index.css', 'M', false),
    f('docs/readme.md', 'A', false),
    f('docs/old.md', 'D', false),
    f('temp.log', '?', false),
  ];

  it('filters by extension (case-insensitive)', () => {
    expect(filterFiles(files, { extension: '.md' }).map((x) => x.path)).toEqual([
      'docs/readme.md',
      'docs/old.md',
    ]);
    expect(filterFiles(files, { extension: '.TSX' }).map((x) => x.path)).toEqual(['src/App.tsx']);
  });

  it('filters by status groups', () => {
    expect(filterFiles(files, { status: 'added' }).map((x) => x.path)).toEqual(['docs/readme.md']);
    expect(filterFiles(files, { status: 'deleted' }).map((x) => x.path)).toEqual(['docs/old.md']);
    expect(filterFiles(files, { status: 'untracked' }).map((x) => x.path)).toEqual(['temp.log']);
    expect(filterFiles(files, { status: 'modified' }).map((x) => x.path)).toEqual([
      'src/App.tsx',
      'src/index.css',
    ]);
  });

  it('filters by staged/unstaged state', () => {
    expect(filterFiles(files, { status: 'staged' }).map((x) => x.path)).toEqual(['src/App.tsx']);
    expect(filterFiles(files, { status: 'unstaged' }).map((x) => x.path)).toEqual([
      'src/index.css',
      'docs/readme.md',
      'docs/old.md',
      'temp.log',
    ]);
  });

  it('status=all returns everything unchanged', () => {
    expect(filterFiles(files, { status: 'all' }).length).toBe(files.length);
  });

  it('search filters by substring (case-insensitive)', () => {
    expect(filterFiles(files, { search: 'DOC' }).map((x) => x.path)).toEqual([
      'docs/readme.md',
      'docs/old.md',
    ]);
  });

  it('combines extension + status + search (AND logic)', () => {
    const result = filterFiles(files, { extension: '.md', status: 'added', search: 'readme' });
    expect(result.map((x) => x.path)).toEqual(['docs/readme.md']);
  });

  it('no options returns the input as-is', () => {
    expect(filterFiles(files, {})).toEqual(files);
  });
});
