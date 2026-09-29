#!/usr/bin/env node
/**
 * Synthetic stress-repo generator (Enterprise QA suite, "Block 16").
 *
 * Generates the four repo shapes that stress different PrismGit subsystems:
 *
 *   flat-wide-repo    — N files in ONE root directory (+ modified/untracked):
 *                       git status parse stress, sidebar/Changes fan-out.
 *   deep-tree-repo    — 60..150 nesting levels, long paths: recursive tree
 *                       walk, path handling, watcher scanning.
 *   high-commit-repo  — N commits via `git fast-import` (seconds instead of
 *                       hours for 5k..200k commits) + branches/tags:
 *                       History log rendering, virtual scroll, graph lanes.
 *   giant-diff-repo   — one huge file with a scattered ~40% diff + one commit
 *                       touching thousands of small files: DiffViewer caps,
 *                       tokenizer, hunk staging.
 *
 * Scales (overridable per-flag):
 *   ci      (default) flat 8k files / log 5k commits / deep 60 / diff 40k lines
 *   full    flat 50k / log 50k / deep 100 / diff 150k lines
 *   extreme flat 250k / log 200k / deep 150 / diff 400k lines
 *   (doc-level "monsters" 1M files / 500k commits: pass --files 1000000
 *    --commits 500000 — expect minutes of disk churn, NOT for CI)
 *
 * Usage:
 *   node scripts/gen-perf-repos.mjs                       # all four, ci scale
 *   node scripts/gen-perf-repos.mjs --type log            # one repo
 *   node scripts/gen-perf-repos.mjs --scale full
 *   node scripts/gen-perf-repos.mjs --commits 500000 --files 1000000
 *   node scripts/gen-perf-repos.mjs --root /tmp/my-repos
 *
 * Output manifest: scripts/perf-repos-manifest.json (paths + stats + timings)
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !/^--/.test(args[i + 1]) ? Number(args[i + 1]) : null;
};

const SCALES = {
  ci:      { files: 8000,   commits: 5000,   depth: 60,  lines: 40000 },
  full:    { files: 50000,  commits: 50000,  depth: 100, lines: 150000 },
  extreme: { files: 250000, commits: 200000, depth: 150, lines: 400000 },
};
const scaleName = opt('scale', 'ci');
const scale = SCALES[scaleName] || SCALES.ci;

const ROOT = opt('root', '/tmp/prismgit-perf-repos');
const TYPE = opt('type', 'all');
const FILES = flag('files') ?? scale.files;
const COMMITS = flag('commits') ?? scale.commits;
const DEPTH = flag('depth') ?? scale.depth;
const LINES = flag('lines') ?? scale.lines;
const FORCE = has('force');

const TYPES = ['flat', 'deep', 'log', 'diff'];
const wanted = TYPE === 'all' ? TYPES : (TYPES.includes(TYPE) ? [TYPE] : null);
if (!wanted) {
  console.error(`unknown --type "${TYPE}" (use flat|deep|log|diff|all)`);
  process.exit(1);
}

// ── helpers ────────────────────────────────────────────────────────────────
function sh(cmd, argsArr, opts = {}) {
  const r = spawnSync(cmd, argsArr, { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${argsArr.join(' ')} failed:\n${(r.stderr || r.stdout || '').slice(0, 500)}`);
  }
  return r.stdout ?? '';
}

function gitInit(repo) {
  fs.mkdirSync(repo, { recursive: true });
  sh('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  sh('git', ['config', 'user.email', 'perf@local'], { cwd: repo });
  sh('git', ['config', 'user.name', 'Perf Bot'], { cwd: repo });
  sh('git', ['config', 'core.filemode', 'false'], { cwd: repo });
  sh('git', ['config', 'gc.auto', '0'], { cwd: repo }); // no background gc during tests
}

function repoStats(repo) {
  const commits = sh('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).trim();
  const files = sh('git', ['ls-files'], { cwd: repo }).trim().split('\n').filter(Boolean).length;
  const status = sh('git', ['status', '--porcelain'], { cwd: repo }).trim().split('\n').filter(Boolean).length;
  return { commits: Number(commits), trackedFiles: files, dirtyEntries: status };
}

/** Write N files with bounded concurrency (sync writes get slow past ~20k). */
async function writeMany(dir, count, nameOf, contentOf) {
  const CONC = 128;
  let next = 0;
  const workers = Array.from({ length: Math.min(CONC, count) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= count) return;
      const p = path.join(dir, nameOf(i));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, contentOf(i));
    }
  });
  await Promise.all(workers);
}

const manifest = { root: ROOT, scale: scaleName, params: { files: FILES, commits: COMMITS, depth: DEPTH, lines: LINES }, repos: {}, generatedAt: new Date().toISOString() };
const timings = {};

// ── 1. flat-wide-repo ──────────────────────────────────────────────────────
// N tracked files in ONE flat directory + a slice modified + a slice untracked.
// Stresses: `status --porcelain` parse volume, Changes list rendering, EOL batch detect.
async function genFlat() {
  const repo = path.join(ROOT, 'flat-wide-repo');
  if (fs.existsSync(path.join(repo, '.git')) && !FORCE) { skip('flat'); return; }
  rmrf(repo);
  const t0 = Date.now();
  gitInit(repo);
  console.log(`[flat] writing ${FILES.toLocaleString()} files in one dir...`);
  await writeMany(repo, FILES, (i) => `file-${String(i).padStart(7, '0')}.ts`,
    (i) => `export const v${i} = ${i};\n// payload line 2 ${i}\n// payload line 3 ${i}\n`);
  sh('git', ['add', '-A'], { cwd: repo });
  sh('git', ['commit', '-qm', `flat: ${FILES} files`], { cwd: repo });
  // modified slice (10%) — tracked-file status churn
  const modN = Math.max(10, Math.floor(FILES * 0.1));
  console.log(`[flat] modifying ${modN.toLocaleString()} tracked files...`);
  for (let i = 0; i < modN; i++) {
    fs.appendFileSync(path.join(repo, `file-${String(i * 7 % FILES).padStart(7, '0')}.ts`), `// touched ${i}\n`);
  }
  // untracked slice (5%) — the expensive status entries
  const unN = Math.max(10, Math.floor(FILES * 0.05));
  await writeMany(repo, unN, (i) => `untracked-${String(i).padStart(7, '0')}.ts`,
    (i) => `untracked ${i}\n`);
  timings.flat = Date.now() - t0;
  manifest.repos.flat = { path: repo, type: 'flat-wide', ...repoStats(repo), ms: timings.flat };
}

// ── 2. deep-tree-repo ──────────────────────────────────────────────────────
// DEPTH nesting levels + long segments. Stresses: recursive dir walk,
// watcher scanning, path length handling, DirTreePanel.
async function genDeep() {
  const repo = path.join(ROOT, 'deep-tree-repo');
  if (fs.existsSync(path.join(repo, '.git')) && !FORCE) { skip('deep'); return; }
  rmrf(repo);
  const t0 = Date.now();
  gitInit(repo);
  console.log(`[deep] building ${DEPTH}-level nesting...`);
  const segs = Array.from({ length: DEPTH }, (_, i) => `level-${String(i).padStart(3, '0')}-segment`);
  const deepDir = path.join(repo, ...segs);
  fs.mkdirSync(deepDir, { recursive: true });
  // a file at the bottom + one file every 10 levels (tree walk must visit them all)
  fs.writeFileSync(path.join(deepDir, 'bottom.ts'), 'export const bottom = true;\n');
  for (let level = 10; level <= DEPTH; level += 10) {
    const p = path.join(repo, ...segs.slice(0, level), `marker-${level}.ts`);
    fs.writeFileSync(p, `export const level = ${level};\n`);
  }
  // sibling breadth so the walk has real fan-out too
  for (let b = 0; b < 200; b++) {
    fs.writeFileSync(path.join(repo, `breadth-${String(b).padStart(4, '0')}.ts`), `export const b = ${b};\n`);
  }
  sh('git', ['add', '-A'], { cwd: repo });
  sh('git', ['commit', '-qm', `deep: ${DEPTH} levels`], { cwd: repo });
  // dirt at the bottom (deep dirty path)
  fs.appendFileSync(path.join(deepDir, 'bottom.ts'), '// dirty bottom\n');
  timings.deep = Date.now() - t0;
  manifest.repos.deep = { path: repo, type: 'deep-tree', ...repoStats(repo), ms: timings.deep, depth: DEPTH };
}

// ── 3. high-commit-repo (git fast-import) ─────────────────────────────────
// COMMITS commits in seconds via fast-import + branch ref every 500 commits
// + tag every 1000. Stresses: log pagination, virtual scroll, graph lanes,
// commit-graph parsing, ref badges.
async function genLog() {
  const repo = path.join(ROOT, 'high-commit-repo');
  if (fs.existsSync(path.join(repo, '.git')) && !FORCE) { skip('log'); return; }
  rmrf(repo);
  const t0 = Date.now();
  gitInit(repo);
  console.log(`[log] streaming ${COMMITS.toLocaleString()} commits via fast-import...`);
  // Stream: blob+commit pairs on one line file, `reset` for branches.
  // Build the stream in memory in chunks and pipe to one fast-import process.
  const child = spawnSync('git', ['fast-import', '--quiet', '--done'], {
    cwd: repo, input: buildFastImportStream(COMMITS), encoding: 'utf8', maxBuffer: 1 << 28,
  });
  if (child.status !== 0) {
    throw new Error(`fast-import failed:\n${(child.stderr || '').slice(0, 800)}`);
  }
  // fast-import writes ONLY the object DB + refs — materialize the worktree.
  sh('git', ['reset', '--hard', 'main'], { cwd: repo });
  timings.log = Date.now() - t0;
  manifest.repos.log = { path: repo, type: 'high-commit-volume', ...repoStats(repo), ms: timings.log };
}

/** Build a complete fast-import stream for N sequential commits. */
function buildFastImportStream(n) {
  const chunks = [];
  const BASE_TS = 1_600_000_000; // fixed epoch -> deterministic, committer stable
  const push = (s) => chunks.push(Buffer.from(s, 'utf8'));
  const pushData = (str) => {
    const b = Buffer.from(str, 'utf8');
    push(`data ${b.length}\n`);
    chunks.push(b);
    push('\n');
  };
  push(`feature done\n`);
  for (let i = 1; i <= n; i++) {
    const ts = BASE_TS + i * 60;
    const mark = 1000 + i;
    push(`commit refs/heads/main\n`);
    push(`mark :${mark}\n`);
    push(`author Perf Bot <perf@local> ${ts} +0000\n`);
    push(`committer Perf Bot <perf@local> ${ts} +0000\n`);
    pushData(`commit ${i}\n\nstress history entry number ${i}`);
    if (i > 1) push(`from :${mark - 1}\n`);
    push(`M 100644 inline history.log\n`);
    pushData(`entry ${i}\n`);
    // branch ref every 500 commits (graph lanes + branch list volume)
    if (i % 500 === 0) {
      push(`reset refs/heads/topic/${Math.floor(i / 500)}\n`);
      push(`from :${mark}\n\n`);
    }
    // tag every 1000 commits (ref badge volume)
    if (i % 1000 === 0) {
      push(`tag v${Math.floor(i / 1000)}\n`);
      push(`from :${mark}\n`);
      push(`tagger Perf Bot <perf@local> ${ts} +0000\n`);
      pushData(`tag at commit ${i}`);
    }
  }
  push(`done\n`);
  return Buffer.concat(chunks);
}

// ── 4. giant-diff-repo ─────────────────────────────────────────────────────
// One L-line file committed, then a scattered ~40% modification; plus one
// commit touching thousands of small files. Stresses: DiffViewer size caps,
// tokenizer, hunk computation, bulk file-tree staging.
async function genDiff() {
  const repo = path.join(ROOT, 'giant-diff-repo');
  if (fs.existsSync(path.join(repo, '.git')) && !FORCE) { skip('diff'); return; }
  rmrf(repo);
  const t0 = Date.now();
  gitInit(repo);
  console.log(`[diff] writing ${LINES.toLocaleString()}-line giant file...`);
  const lines = Array.from({ length: LINES }, (_, i) =>
    `line ${i}: ${'x'.repeat(20)} function compute_${i}(a, b) { return a + b + ${i}; }`);
  const giant = path.join(repo, 'giant-bundle.gen.ts');
  fs.writeFileSync(giant, lines.join('\n') + '\n');
  sh('git', ['add', '-A'], { cwd: repo });
  sh('git', ['commit', '-qm', 'diff: giant file base'], { cwd: repo });
  // scattered ~40% modification: three bands of changes (top / middle / bottom)
  console.log('[diff] scattering modification bands...');
  for (const [from, to] of [[0.1, 0.25], [0.4, 0.6], [0.8, 0.95]]) {
    for (let i = Math.floor(LINES * from); i < Math.floor(LINES * to); i++) {
      lines[i] = `CHANGED line ${i}: ${'y'.repeat(24)} computed_${i}(a, b, c) { return a * b + c + ${i}; }`;
    }
  }
  fs.writeFileSync(giant, lines.join('\n') + '\n');
  // + one commit touching many small files simultaneously
  const manyN = Math.max(500, Math.floor(LINES / 40));
  console.log(`[diff] touching ${manyN.toLocaleString()} small files in one commit...`);
  await writeMany(repo, manyN, (i) => `small-${String(i).padStart(6, '0')}.ts`, (i) => `export const s${i} = ${i};\n`);
  sh('git', ['add', '-A'], { cwd: repo });
  sh('git', ['commit', '-qm', `diff: giant scattered change + ${manyN} files`], { cwd: repo });
  // leave the giant file dirty in the worktree (unstaged diff stress)
  for (let i = Math.floor(LINES * 0.3); i < Math.floor(LINES * 0.35); i++) {
    lines[i] = `WORKTREE line ${i}: locally edited, not staged`;
  }
  fs.writeFileSync(giant, lines.join('\n') + '\n');
  timings.diff = Date.now() - t0;
  manifest.repos.diff = { path: repo, type: 'giant-diff', ...repoStats(repo), ms: timings.diff, giantLines: LINES };
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function skip(name) { console.log(`[${name}] already exists — skipping (use --force to regenerate)`); manifest.repos[name] = { skipped: true }; }

// ── run ────────────────────────────────────────────────────────────────────
console.log(`perf repo generator: root=${ROOT} scale=${scaleName} type=${TYPE}`);
console.log(`params: files=${FILES.toLocaleString()} commits=${COMMITS.toLocaleString()} depth=${DEPTH} lines=${LINES.toLocaleString()}`);
fs.mkdirSync(ROOT, { recursive: true });
const tAll = Date.now();
try {
  if (wanted.includes('flat')) await genFlat();
  if (wanted.includes('deep')) await genDeep();
  if (wanted.includes('log')) await genLog();
  if (wanted.includes('diff')) await genDiff();
} catch (e) {
  console.error(`\nFAIL: ${e.message}`);
  process.exit(1);
}

const manifestPath = path.join(process.cwd(), 'scripts', 'perf-repos-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\n── generated (${((Date.now() - tAll) / 1000).toFixed(1)}s total) ──`);
for (const [k, r] of Object.entries(manifest.repos)) {
  if (r.skipped) { console.log(`  ${k.padEnd(6)} skipped`); continue; }
  console.log(`  ${k.padEnd(6)} ${r.path} — ${r.commits.toLocaleString()} commits, ${r.trackedFiles.toLocaleString()} files, ${r.dirtyEntries} dirty (${(r.ms / 1000).toFixed(1)}s)`);
}
console.log(`manifest: ${manifestPath}`);
console.log('\nnext: node scripts/perf-cdp-metrics.mjs   # memory/DOM/FPS + zombie audit on high-commit-repo');
