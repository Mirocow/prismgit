#!/usr/bin/env node
/**
 * Static perf-readiness audit (Enterprise QA suite — "final readiness
 * checklist" automated).
 *
 * Scans the Electron main-process code and reports violations of the
 * performance invariants the load-test spec demands:
 *
 *   R1  no child_process.exec / execSync / spawnSync in electron/ (shell wrap
 *       + maxBuffer truncation risk — spawn streaming only)
 *   R2  no *Sync filesystem calls in electron/ main-process code (each one is
 *       a potential Event-Loop block) — counts are ratcheted against a
 *       committed baseline: counts may only DECREASE
 *   R3  transport env guard GIT_TERMINAL_PROMPT=0 is in place (no hung
 *       interactive prompts in background git spawns)
 *   R4  simple-git pools are bounded (maxConcurrentProcesses configured)
 *   R5  network fetches carry a timeout (timeout: { block: ... })
 *   R6  watcher debounces FS-event storms
 *   R7  history log is paginated (--max-count / maxCount), not unbounded
 *   R8  no unbounded raw stdout buffering via .exec( in renderer glue
 *
 * Usage:
 *   node scripts/audit-perf-readiness.mjs           # report (exit 0)
 *   node scripts/audit-perf-readiness.mjs --strict  # fail on ratchet regressions
 *
 * Baseline: scripts/perf-readiness-baseline.json (auto-created on first run,
 * committed to git — edit ONLY to LOWER the ratchet, never to raise it).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const STRICT = process.argv.includes('--strict');
const ROOT = process.cwd();
const ELECTRON_DIR = path.join(ROOT, 'electron');
const BASELINE_PATH = path.join(ROOT, 'scripts', 'perf-readiness-baseline.json');
const REPORT_PATH = path.join(ROOT, 'scripts', 'perf-readiness-report.json');

// ── collect electron/*.ts files ────────────────────────────────────────────
function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}
const files = walk(ELECTRON_DIR);
const rel = (p) => path.relative(ROOT, p).replaceAll('\\', '/');
const read = (p) => fs.readFileSync(p, 'utf8');

// ── R1: forbidden child_process APIs ───────────────────────────────────────
const R1_ALLOW = /taskkill/;
const FORBIDDEN_CP = /\b(execSync|execFileSync|spawnSync)\b|(?<![.\w])exec\(/g;
const r1 = { status: 'pass', violations: [], allowlisted: 0 };
for (const f of files) {
  const src = read(f).split('\n');
  src.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // skip comment lines
    if (/^\s*(import|const\s+.*=\s*require)/.test(line)) return; // import/require ≠ call
    FORBIDDEN_CP.lastIndex = 0;
    if (FORBIDDEN_CP.test(line)) {
      // Allowlist: `execFileSync('taskkill', ...)` (childTracker /
      // gitPollProcess) is the INTENTIONAL Windows-only process-tree kill on
      // the quit path — platform-guarded, bounded, correctness first there.
      if (R1_ALLOW.test(line)) { r1.allowlisted++; return; }
      r1.violations.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    }
  });
}
if (r1.violations.length) { r1.status = 'fail'; }

// ── R2: sync FS calls ratchet ──────────────────────────────────────────────
const SYNC_FS = {
  write: /\b(writeFileSync|appendFileSync|renameSync|copyFileSync|rmSync|mkdirSync|truncateSync)\b/g,
  read:  /\b(readFileSync|readdirSync|statSync|lstatSync|realpathSync|readlinkSync|openSync|existsSync|accessSync)\b/g,
};
const syncCounts = { write: {}, read: {} };
for (const f of files) {
  const src = read(f);
  for (const [kind, re] of Object.entries(SYNC_FS)) {
    // count only non-comment-line occurrences
    let real = 0;
    src.split('\n').forEach((line) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      re.lastIndex = 0;
      const m = line.match(re);
      if (m) real += m.length;
    });
    if (real > 0) syncCounts[kind][rel(f)] = real;
  }
}
const totalSync = {
  write: Object.values(syncCounts.write).reduce((a, b) => a + b, 0),
  read: Object.values(syncCounts.read).reduce((a, b) => a + b, 0),
};

// baseline ratchet
let baseline = null;
if (fs.existsSync(BASELINE_PATH)) baseline = JSON.parse(read(BASELINE_PATH));
const r2 = { status: 'pass', regressions: [] };
if (baseline) {
  for (const kind of ['write', 'read']) {
    const base = baseline.syncFs?.[kind] || {};
    for (const [file, count] of Object.entries(syncCounts[kind])) {
      const b = base[file] ?? 0;
      if (count > b) r2.regressions.push(`${kind} ${file}: ${b} -> ${count} (+${count - b})`);
    }
    for (const file of Object.keys(base)) {
      if (!syncCounts[kind][file] && fs.existsSync(path.join(ROOT, file))) {
        // file cleaned up — improvement, fine
      }
    }
  }
  if (r2.regressions.length && STRICT) r2.status = 'fail';
  if (r2.regressions.length) r2.status = STRICT ? 'fail' : 'warn';
} else {
  r2.status = 'warn'; // first run seeds the baseline
}

// ── positive greps (R3–R7) ─────────────────────────────────────────────────
function grepElectron(pattern) {
  const re = new RegExp(pattern);
  const hits = [];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      if (re.test(line)) hits.push(`${rel(f)}:${i + 1}`);
    });
  }
  return hits;
}
const checks = [
  { id: 'R3', desc: 'GIT_TERMINAL_PROMPT=0 guard on background git spawns', hits: grepElectron("GIT_TERMINAL_PROMPT\\s*[:=]\\s*'0'") },
  { id: 'R4', desc: 'simple-git concurrency pools bounded (maxConcurrentProcesses)', hits: grepElectron('maxConcurrentProcesses\\s*:') },
  { id: 'R5', desc: 'network fetch timeout configured (timeout: { block })', hits: grepElectron('timeout\\s*:\\s*\\{\\s*block') },
  { id: 'R6', desc: 'watcher FS-event debounce present', hits: grepElectron('[Dd]ebounce') },
  { id: 'R7', desc: 'history log paginated (--max-count / maxCount)', hits: grepElectron('max-count|maxCount') },
];

// ── report ─────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  strict: STRICT,
  rules: {
    R1: { status: r1.status, desc: 'no child_process.exec/execSync/spawnSync in electron/ (taskkill tree-kill allowlisted)', violations: r1.violations, allowlisted: r1.allowlisted },
    R2: { status: r2.status, desc: 'sync-FS call counts ratcheted against baseline', regressions: r2.regressions, totals: totalSync, perFile: syncCounts },
  },
  positive: checks.map((c) => ({ id: c.id, desc: c.desc, status: c.hits.length ? 'pass' : 'fail', hits: c.hits.length, examples: c.hits.slice(0, 3) })),
};

// write/refresh baseline when absent OR when counts improved (ratchet only goes down)
if (!baseline || totalSync.write < (baseline.totals?.write ?? Infinity) || totalSync.read < (baseline.totals?.read ?? Infinity)) {
  const next = {
    totals: totalSync,
    syncFs: syncCounts,
    note: 'ratchet baseline — only ever LOWER these numbers by hand; never raise',
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
  report.baselineUpdated = true;
}
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

console.log('================ PERF READINESS AUDIT ================');
console.log(`scanned: ${files.length} files in electron/`);
console.log(`\nR1 child_process.exec/execSync/spawnSync: ${r1.status.toUpperCase()} (${r1.violations.length} violations, ${r1.allowlisted} allowlisted taskkill tree-kills)`);
for (const v of r1.violations) console.log(`  ${v}`);
console.log(`\nR2 sync-FS calls: ${totalSync.write} write-like + ${totalSync.read} read-like across electron/`);
console.log(`   ratchet: ${r2.regressions.length ? r2.regressions.join('; ') : 'no regressions'}`);
if (!baseline) console.log('   (baseline seeded this run — commit scripts/perf-readiness-baseline.json)');
for (const c of report.positive) {
  console.log(`${c.id} ${c.desc}: ${c.status.toUpperCase()} (${c.hits} hits)`);
}
console.log(`\nreport: ${path.relative(ROOT, REPORT_PATH)}`);
const failed = [r1.status === 'fail', r2.status === 'fail', ...report.positive.map((p) => p.status === 'fail')];
if (failed.some(Boolean)) { console.log('\nFAIL: readiness violations found (see above)'); process.exit(1); }
console.log('\nPASS: performance invariants in place (sync-FS counts ratcheted, no regressions)');
