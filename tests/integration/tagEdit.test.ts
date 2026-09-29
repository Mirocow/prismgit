/**
 * Integration test — tag editing on a commit (real git).
 *
 * User request: "теги на комите можно как создавать так и удалять и
 * редактировать" — tags on a commit must be creatable, deletable AND
 * editable. Editing has no native git command: the app re-creates the tag
 * (force) and/or renames (create + delete). These tests pin the backend
 * contracts that make the UI flows lossless:
 *
 *   1. tagShow returns the FULL multi-line message (cat-file), not just the
 *      subject — the edit dialog prefills from it. (tags()/tagsAt() only
 *      return the subject; prefilling from those truncated multi-line
 *      messages and saving destroyed the tail.)
 *   2. createTag(annotated=true, empty message) produces a REAL tag object
 *      (previously it silently fell through to a lightweight tag).
 *   3. createTag(annotated=false) produces a lightweight tag.
 *   4. Edit-in-place: force re-creation updates the message, keeps the
 *      annotation, keeps pointing at the SAME commit.
 *   5. Rename: create(new, message, hash) + delete(old) preserves the
 *      annotation + full message (the old TagsPage rename destroyed them).
 *   6. deleteTag removes the tag (create/delete loop on a commit).
 *   7. tagShow(nonexistent) → null (menu actions on a concurrently-deleted
 *      tag degrade to a toast, not an exception path).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { tagShow, createTag, deleteTag, tagsAt, tags } from '../../electron/services/git.js';

let repoDir: string;
let headHash: string;

function sh(cmd: string) {
  return execSync(cmd, { cwd: repoDir, encoding: 'utf-8' });
}

beforeAll(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prismgit-tag-edit-'));
  sh('git init -b main -q');
  sh('git config user.email t@t.t');
  sh('git config user.name T');
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'base\n');
  sh('git add . && git commit -m base -q');
  headHash = sh('git rev-parse HEAD').trim();
});

afterAll(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

describe('tagShow — full-fidelity tag read', () => {
  it('annotated tag: returns the FULL multi-line message byte-exact + tagger + target', async () => {
    const message = 'Release 1.0.0\n\n- feature one\n- feature two\n\nSigned-off-by: T <t@t.t>';
    await createTag(repoDir, 'v1.0.0', message, headHash, false, true);
    const shown = await tagShow(repoDir, 'v1.0.0');
    expect(shown).not.toBeNull();
    expect(shown!.annotated).toBe(true);
    expect(shown!.message).toBe(message);
    expect(shown!.tagger).toBe('T');
    expect(shown!.date).toBeTruthy();
    expect(shown!.targetHash).toBe(headHash);
  });

  it('lightweight tag: annotated=false, empty message, target = the commit', async () => {
    await createTag(repoDir, 'lw-1', undefined, headHash, false, false);
    const shown = await tagShow(repoDir, 'lw-1');
    expect(shown).not.toBeNull();
    expect(shown!.annotated).toBe(false);
    expect(shown!.message).toBe('');
    expect(shown!.targetHash).toBe(headHash);
  });

  it('nonexistent tag → null (no throw)', async () => {
    const shown = await tagShow(repoDir, 'no-such-tag');
    expect(shown).toBeNull();
  });
});

describe('createTag — annotated flag is honored', () => {
  it('annotated=true + EMPTY message still produces a real tag object (regression: was silently lightweight)', async () => {
    await createTag(repoDir, 'v-empty', undefined, headHash, false, true);
    const type = sh("git cat-file -t refs/tags/v-empty").trim();
    expect(type).toBe('tag');
    const shown = await tagShow(repoDir, 'v-empty');
    expect(shown!.annotated).toBe(true);
  });

  it('annotated=false produces a lightweight tag even with a message passed', async () => {
    await createTag(repoDir, 'lw-msg', 'ignored for lightweight', headHash, false, false);
    const type = sh('git cat-file -t refs/tags/lw-msg').trim();
    expect(type).toBe('commit');
  });
});

describe('tag edit flows (create / edit / rename / delete on a commit)', () => {
  it('EDIT in place: force re-creation swaps the message, stays annotated, same target commit', async () => {
    await createTag(repoDir, 'edit-me', 'original message', headHash, false, true);
    // The UI's edit-in-place path: same name, force=true, new message.
    await createTag(repoDir, 'edit-me', 'EDITED message\n\nwith body', headHash, true, true);
    const shown = await tagShow(repoDir, 'edit-me');
    expect(shown!.message).toBe('EDITED message\n\nwith body');
    expect(shown!.annotated).toBe(true);
    expect(shown!.targetHash).toBe(headHash);
  });

  it('RENAME: create(new name, preserved message, hash) + delete(old) keeps the full annotation', async () => {
    const message = 'multi-line annotation\nsecond line\nthird line';
    await createTag(repoDir, 'old-name', message, headHash, false, true);
    // The UI's rename path (HistoryPage handleSaveTag / TagsPage handleSaveEdit).
    await createTag(repoDir, 'new-name', message, headHash, false, true);
    await deleteTag(repoDir, 'old-name');
    // Old name gone…
    const oldShown = await tagShow(repoDir, 'old-name');
    expect(oldShown).toBeNull();
    // …new name identical in content and target.
    const newShown = await tagShow(repoDir, 'new-name');
    expect(newShown!.message).toBe(message);
    expect(newShown!.annotated).toBe(true);
    expect(newShown!.targetHash).toBe(headHash);
  });

  it('tagsAt still lists the tags pointing at the commit (annotated AND lightweight)', async () => {
    const list = await tagsAt(repoDir, headHash);
    const names = list.map((t) => t.name);
    expect(names).toContain('new-name');
    expect(names).toContain('lw-1');
    const annotated = list.find((t) => t.name === 'new-name')!;
    expect(annotated.annotated).toBe(true);
    const lightweight = list.find((t) => t.name === 'lw-1')!;
    expect(lightweight.annotated).toBe(false);
  });

  it('DELETE removes the tag from tags()/tagsAt() (create→delete loop)', async () => {
    await createTag(repoDir, 'to-delete', 'bye', headHash, false, true);
    expect((await tags(repoDir)).map((t) => t.name)).toContain('to-delete');
    await deleteTag(repoDir, 'to-delete');
    expect((await tags(repoDir)).map((t) => t.name)).not.toContain('to-delete');
    expect((await tagsAt(repoDir, headHash)).map((t) => t.name)).not.toContain('to-delete');
  });
});
