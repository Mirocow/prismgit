import { describe, it, expect } from 'vitest';
import {
  type AiFavoriteFolder,
  type AiFavoriteNote,
  favId,
  noteNameFromContent,
  findNode,
  insertIntoTree,
  removeNodeFromTree,
  renameNodeInTree,
  moveNodeInTree,
  toggleFolderInTree,
  collapseAllInTree,
  countNotesInTree,
  isValidFavoritesTree,
} from '../../src/lib/aiFavorites';

const note = (id: string, content = 'saved text'): AiFavoriteNote => ({
  id,
  type: 'note',
  name: content.slice(0, 20),
  content,
  role: 'user',
  createdAt: 1,
});

const folder = (id: string, children: AiFavoriteNote[] = [], expanded = true): AiFavoriteFolder => ({
  id,
  type: 'folder',
  name: id,
  children,
  expanded,
  createdAt: 1,
});

describe('noteNameFromContent', () => {
  it('takes the first non-empty line, trimmed to 60 chars', () => {
    expect(noteNameFromContent('\n\nhow do I rebase?\nsecond line')).toBe('how do I rebase?');
    const long = 'x'.repeat(100);
    expect(noteNameFromContent(long)).toHaveLength(60);
  });

  it('falls back to an em dash for blank content', () => {
    expect(noteNameFromContent('   \n  ')).toBe('—');
  });
});

describe('insertIntoTree', () => {
  it('appends to the root when parentId is null', () => {
    const tree = insertIntoTree([], null, note('a'));
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('a');
  });

  it('inserts into the named folder and expands it', () => {
    const tree = insertIntoTree([folder('f', [], false)], 'f', note('a'));
    const f = findNode(tree, 'f') as AiFavoriteFolder;
    expect(f.children.map((c) => c.id)).toEqual(['a']);
    expect(f.expanded).toBe(true);
  });

  it('falls back to the root when the parent no longer exists (never lose a note)', () => {
    const tree = insertIntoTree([folder('other')], 'ghost-folder', note('a'));
    expect(tree.some((n) => n.id === 'a')).toBe(true);
  });
});

describe('removeNodeFromTree', () => {
  it('removes a nested note and keeps other branches referentially intact', () => {
    const keep = note('keep');
    const tree = [folder('f', [note('drop'), keep]), note('root-note')];
    const next = removeNodeFromTree(tree, 'drop')!;
    expect(findNode(next, 'drop')).toBeUndefined();
    expect((findNode(next, 'f') as AiFavoriteFolder).children[0].id).toBe('keep');
    expect(next[1]).toBe(tree[1]); // untouched branch keeps identity
  });

  it('returns null when the id is absent', () => {
    expect(removeNodeFromTree([folder('f')], 'nope')).toBeNull();
  });
});

describe('moveNodeInTree', () => {
  it('moves a note from root into a folder', () => {
    const tree = moveNodeInTree([folder('f'), note('a')], 'a', 'f');
    expect((findNode(tree, 'f') as AiFavoriteFolder).children.map((c) => c.id)).toEqual(['a']);
    expect(tree).toHaveLength(1);
  });

  it('moves a folder into another folder', () => {
    const tree = moveNodeInTree([folder('src'), folder('dst')], 'src', 'dst');
    expect((findNode(tree, 'dst') as AiFavoriteFolder).children[0].id).toBe('src');
  });

  it('rejects moving a folder into its own descendant (cycle guard)', () => {
    const tree = [folder('outer', [folder('inner') as unknown as AiFavoriteNote])];
    const next = moveNodeInTree(tree, 'outer', 'inner');
    expect(next).toEqual(tree); // unchanged
  });

  it('rejects moving a node into itself', () => {
    const tree = [folder('f'), note('a')];
    expect(moveNodeInTree(tree, 'f', 'f')).toEqual(tree);
  });

  it('moves to root with newParentId=null', () => {
    const tree = moveNodeInTree([folder('f', [note('a')])], 'a', null);
    expect(tree.some((n) => n.id === 'a')).toBe(true);
  });

  it('is a no-op for unknown ids', () => {
    const tree = [note('a')];
    expect(moveNodeInTree(tree, 'ghost', null)).toEqual(tree);
  });
});

describe('rename / toggle / collapse / count', () => {
  it('renames and trims whitespace; empty name is a no-op', () => {
    let tree = renameNodeInTree([note('a')], 'a', '  new name  ');
    expect((tree[0] as AiFavoriteNote).name).toBe('new name');
    tree = renameNodeInTree(tree, 'a', '   ');
    expect((tree[0] as AiFavoriteNote).name).toBe('new name');
  });

  it('toggles folder expansion only', () => {
    let tree = toggleFolderInTree([folder('f', [], false)], 'f');
    expect((tree[0] as AiFavoriteFolder).expanded).toBe(true);
    tree = toggleFolderInTree(tree, 'f');
    expect((tree[0] as AiFavoriteFolder).expanded).toBe(false);
  });

  it('collapses every folder recursively', () => {
    const deep = folder('l2', [note('x')], true);
    const tree = collapseAllInTree([folder('l1', [deep as unknown as AiFavoriteNote], true)]);
    expect((tree[0] as AiFavoriteFolder).expanded).toBe(false);
    expect(((tree[0] as AiFavoriteFolder).children[0] as unknown as AiFavoriteFolder).expanded).toBe(false);
  });

  it('counts notes across nesting levels', () => {
    const tree = [note('a'), folder('f', [note('b')])];
    expect(countNotesInTree(tree)).toBe(2);
  });
});

describe('isValidFavoritesTree (localStorage guard)', () => {
  it('accepts a valid mixed tree', () => {
    expect(isValidFavoritesTree([note('a'), folder('f', [note('b')])])).toBe(true);
  });

  it('rejects junk shapes', () => {
    expect(isValidFavoritesTree(null)).toBe(false);
    expect(isValidFavoritesTree({})).toBe(false);
    expect(isValidFavoritesTree([{ type: 'note', id: 'x', name: 'n' }])).toBe(false); // no content
    expect(isValidFavoritesTree([{ type: 'folder', id: 'x', name: 'f', children: 'nope' }])).toBe(false);
  });
});

describe('favId', () => {
  it('produces unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => favId()));
    expect(ids.size).toBe(200);
  });
});
