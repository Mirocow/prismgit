/**
 * Task 26 — end-to-end verification of the History-tags / merge-commit /
 * Search / Pull fixes against a REAL git repository:
 *
 *   1. commitFiles(merge)   → files of the merge vs FIRST parent (was: [])
 *   2. commitFiles(normal)  → unchanged behavior for regular commits
 *   3. mergeNestedCommits   → nested commits of a merge (incl. octopus)
 *   4. tagsAt               → annotated tag metadata (name/tagger/message)
 *   5. trackedFiles         → git ls-files listing for the Search Files tab
 *   6. grep pathspec        → narrowed content search (src/*.ts)
 *   7. fetchAll             → brings tags from a bare remote (--tags)
 *   8. non-ASCII filenames  → readable (core.quotePath=false) in merge diffs
 *
 * Run: npx tsx scripts/verify-merge-tags-search.ts
 */
import { simpleGit } from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

async function main() {
  const svc = await import('../electron/services/git');
  const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'task26-'));

  // ── Setup: repo with feature branches, an octopus merge, tags ──────────
  const work = path.join(ROOT, 'work');
  fs.mkdirSync(work, { recursive: true });
  const git = simpleGit(work);
  await git.init();
  await git.addConfig('user.email', 't@t.local');
  await git.addConfig('user.name', 'T');

  const commitFile = async (name: string, content: string, msg: string) => {
    fs.writeFileSync(path.join(work, name), content);
    await git.add(name);
    await git.commit(msg);
  };

  await commitFile('base.txt', 'base\n', 'base: init');
  await git.raw(['tag', '-a', 'v1.0.0', '-m', 'release one — первый релиз']);

  // feature branches for the octopus merge
  await git.checkout(['-b', 'feat-x']);
  await commitFile('x.txt', 'x\n', 'feat: x work');
  await git.checkout(['main']);
  await git.checkout(['-b', 'feat-y']);
  await commitFile('y.txt', 'y\n', 'feat: y work');
  await git.checkout(['main']);
  // parallel main change so the merge is a TRUE merge (not fast-forward)
  await commitFile('main.txt', 'main\n', 'main: parallel');

  const headBeforeMerge = (await git.revparse(['HEAD'])).trim();
  await git.merge(['feat-x', 'feat-y', '--no-ff', '-m', 'Merge branches feat-x feat-y (octopus)']);
  const mergeHash = (await git.revparse(['HEAD'])).trim();
  const parentCount = ((await git.raw(['rev-list', '--parents', '-n', '1', mergeHash])).trim().split(/\s+/).length - 1);
  check('octopus merge created (3 parents)', parentCount === 3, `got ${parentCount}`);

  // ── 1. commitFiles on the MERGE: x.txt + y.txt + main.txt(?) vs first parent
  const mergeFiles = await svc.commitFiles(work, mergeHash);
  const mergePaths = mergeFiles.map((f) => f.path).sort();
  check('commitFiles(merge) shows x.txt', mergePaths.includes('x.txt'), JSON.stringify(mergePaths));
  check('commitFiles(merge) shows y.txt', mergePaths.includes('y.txt'));
  check('commitFiles(merge) is NOT empty', mergeFiles.length > 0);
  const xFile = mergeFiles.find((f) => f.path === 'x.txt');
  check('commitFiles(merge) has numstat for x.txt', !!xFile && xFile.additions === 1, JSON.stringify(xFile));

  // ── 2. commitFiles on a NORMAL commit still works
  const normalFiles = await svc.commitFiles(work, headBeforeMerge);
  check('commitFiles(normal) returns main.txt', normalFiles.some((f) => f.path === 'main.txt'));

  // ── 3. mergeNestedCommits: merge itself + x + y (relative to first parent)
  const nested = await svc.mergeNestedCommits(work, mergeHash);
  const nestedSubjects = nested.map((c) => c.subject);
  check('mergeNestedCommits includes the merge itself', nestedSubjects.includes('Merge branches feat-x feat-y (octopus)'));
  check('mergeNestedCommits includes feat: x work', nestedSubjects.includes('feat: x work'));
  check('mergeNestedCommits includes feat: y work', nestedSubjects.includes('feat: y work'));
  check('mergeNestedCommits EXCLUDES first-parent history', !nestedSubjects.includes('main: parallel'));

  // ── 4. tagsAt: annotated tag metadata with non-ASCII message intact
  // (the annotated tag was created on the BASE commit — query THAT hash;
  // --points-at only matches tags pointing exactly at the given commit)
  await commitFile('after.txt', 'after\n', 'after: tagged commit');
  const baseHash = (await git.revparse(['v1.0.0^{commit}'])).trim();
  const head = (await git.revparse(['HEAD'])).trim();
  await git.raw(['tag', 'light-none']); // lightweight on HEAD
  const baseTags = await svc.tagsAt(work, baseHash);
  const annotated = baseTags.find((t) => t.name === 'v1.0.0');
  check('tagsAt finds the annotated tag', !!annotated);
  check('tagsAt reports annotated=true', !!annotated && annotated.annotated === true);
  check('tagsAt keeps the non-ASCII message', !!annotated && annotated.message === 'release one — первый релиз', JSON.stringify(annotated));
  const headTags = await svc.tagsAt(work, head);
  check('tagsAt reports lightweight tag as not annotated', headTags.find((t) => t.name === 'light-none')?.annotated === false);

  // ── 5. trackedFiles
  const tracked = await svc.trackedFiles(work);
  check('trackedFiles lists all files', ['base.txt', 'x.txt', 'y.txt', 'main.txt', 'after.txt'].every((f) => tracked.includes(f)), JSON.stringify(tracked));

  // ── 6. grep with pathspec
  fs.mkdirSync(path.join(work, 'src'), { recursive: true });
  await commitFile('src/deep.txt', 'needle in src\n', 'src: content');
  await commitFile('docs.txt', 'no needle here\n', 'docs: content');
  const all = await svc.grep(work, 'needle', ['--line-number']);
  const narrowed = await svc.grep(work, 'needle', ['--line-number'], 'src/*');
  check('grep finds both needles', all.trim().split('\n').length === 2);
  check('grep pathspec narrows to src/*', narrowed.includes('src/deep.txt') && !narrowed.includes('docs.txt'), JSON.stringify(narrowed));
  const noMatch = await svc.grep(work, 'definitely-not-there-xyz');
  check('grep with no matches returns "" (not a throw)', noMatch === '');

  // ── 7. fetchAll --tags brings tags from a bare remote
  const bare = path.join(ROOT, 'remote.git');
  await git.raw(['clone', '--bare', work, bare]);
  const clone = path.join(ROOT, 'clone');
  await git.raw(['clone', '--single-branch', '--no-tags', bare, clone]); // clone WITHOUT tags
  const cloneGit = simpleGit(clone);
  await cloneGit.addConfig('user.email', 't@t.local');
  await cloneGit.addConfig('user.name', 'T');
  const tagsBefore = (await cloneGit.tag()).trim();
  check('clone starts without tags', tagsBefore === '', JSON.stringify(tagsBefore));
  await svc.fetchAll(clone);
  const tagsAfter = (await cloneGit.tag()).trim().split('\n').filter(Boolean);
  check('fetchAll(--tags) brings remote tags', tagsAfter.includes('v1.0.0'), JSON.stringify(tagsAfter));

  // ── 8. non-ASCII filename inside a merge is readable (quotePath decoding)
  await git.checkout(['-b', 'feat-uni']);
  const uniName = 'отчёт-данные.txt';
  fs.writeFileSync(path.join(work, uniName), 'uni\n');
  await git.add(uniName);
  await git.commit('feat: unicode file');
  const uniMain = (await git.revparse(['HEAD'])).trim();
  await git.checkout(['main']);
  const uniMergeOut = await git.raw(['merge', '--no-ff', '-m', 'Merge unicode branch', 'feat-uni']).catch(() => '');
  const uniMerge = (await git.revparse(['HEAD'])).trim();
  if (uniMerge !== uniMain) {
    const uniFiles = await svc.commitFiles(work, uniMerge);
    check('commitFiles(merge) shows non-ASCII name decoded', uniFiles.some((f) => f.path === uniName), JSON.stringify(uniFiles.map((f) => f.path)));
  } else {
    console.log('  SKIP  unicode merge (fast-forwarded) — covered by stash quotePath tests');
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
