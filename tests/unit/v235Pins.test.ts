/**
 * v2.3.5 pins — the user's third UX batch:
 *   1) 3-way: conflict markers are no longer RED full-width bands (the
 *      «полоса по центру центральной панели») — neutral tertiary bg + dim
 *      text; ours/theirs content bands softened
 *   2) Back/Forward: project-scoped (switch resets), default cap 10,
 *      configurable via settings.navHistoryLimit
 *   3) History: author/date filters run SERVER-SIDE (git log --author/
 *      --since/--until) — refresh honors the filters without scrolling the
 *      whole history in; paging keeps the filters; options precede the
 *      pathspec separator
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

// ── 1. 3-way marker bands ───────────────────────────────────────────────────
describe('v2.3.5 — 3-way: markers neutral, content bands softer', () => {
  const src = read('src/components/merge/MergeResultEditor.tsx');

  it('marker lines (<<<<<<< ======= >>>>>>>) no longer carry the red band', () => {
    expect(src).not.toContain("rgba(220, 38, 38");
    expect(src).toContain("'marker-start': 'var(--bg-tertiary)'");
    expect(src).toContain("'marker-sep':   'var(--bg-tertiary)'");
    expect(src).toContain("'marker-end':   'var(--bg-tertiary)'");
  });

  it('marker rows render with dimmed text (structural noise, not content)', () => {
    expect(src).toContain("isMarker ? 'color:var(--text-tertiary);' : ''");
  });

  it('ours/theirs content bands softened to 0.20 (one quiet region, not stripes)', () => {
    expect(src).toContain("'ours':         'rgba(34, 197, 94, 0.20)'");
    expect(src).toContain("'theirs':       'rgba(59, 130, 246, 0.20)'");
  });
});

// ── 2. navHistoryStore — project scope + cap ───────────────────────────────
import { useNavHistoryStore, navHistoryLimit } from '../../src/stores/navHistoryStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

describe('v2.3.5 — Back/Forward: project-scoped + 10-step default', () => {
  beforeEach(() => {
    useNavHistoryStore.getState().reset();
    useNavHistoryStore.setState({ scope: null });
  });

  it('default limit is 10 (settings key unset)', () => {
    expect(navHistoryLimit()).toBe(10);
  });

  it('push() caps the stack at the limit (oldest entries drop out)', () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, navHistoryLimit: 10 } });
    const nav = useNavHistoryStore.getState();
    for (let i = 0; i < 25; i++) nav.push(`/page${i}`);
    const st = useNavHistoryStore.getState();
    expect(st.stack.length).toBe(10);
    expect(st.index).toBe(9);
    expect(st.stack[0].loc).toBe('/page15'); // the 10 NEWEST survive
    // Back can walk at most 9 steps from the tip
    let steps = 0;
    while (useNavHistoryStore.getState().back()) steps++;
    expect(steps).toBe(9);
  });

  it('the cap honors a custom settings value', () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, navHistoryLimit: 3 } });
    const nav = useNavHistoryStore.getState();
    for (let i = 0; i < 10; i++) nav.push(`/p${i}`);
    expect(useNavHistoryStore.getState().stack.length).toBe(3);
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, navHistoryLimit: 10 } });
  });

  it('ensureScope WIPES the history when the project changes (same path = no-op)', () => {
    const nav = useNavHistoryStore.getState();
    nav.ensureScope('/repo/a');
    nav.push('/changes');
    nav.push('/history');
    expect(useNavHistoryStore.getState().stack.length).toBe(2);
    // same repo — intact
    nav.ensureScope('/repo/a');
    expect(useNavHistoryStore.getState().stack.length).toBe(2);
    // different repo — wiped
    nav.ensureScope('/repo/b');
    const st = useNavHistoryStore.getState();
    expect(st.stack.length).toBe(0);
    expect(st.index).toBe(-1);
    expect(st.scope).toBe('/repo/b');
    // Back is dead after the wipe
    expect(useNavHistoryStore.getState().back()).toBeNull();
  });

  it('App wires ensureScope to the current repo path', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('ensureScope(repoPath)');
  });

  it('Settings exposes the limit select (default 10) in the «Сайдбар и навигация» panel', () => {
    const src = read('src/pages/SettingsPage.tsx');
    expect(src).toContain('nav-history-limit-select');
    expect(src).toContain("settings.navHistoryLimit ?? 10");
  });
});

// ── 3. History — server-side author/date filters ───────────────────────────
describe('v2.3.5 — History: filters go to git log (server-side)', () => {
  const page = read('src/pages/HistoryPage.tsx');

  it('loadHistory passes the (debounced) author + date range to api.git.log', () => {
    expect(page).toContain('logOpts.author = debouncedAuthorFilter.trim()');
    expect(page).toContain('logOpts.since = dateFrom');
    expect(page).toContain('logOpts.until =');
  });

  it('the author filter is DEBOUNCED for the server query (no spawn per keystroke)', () => {
    expect(page).toContain('debouncedAuthorFilter');
    expect(page).toContain('setTimeout(() => setDebouncedAuthorFilter(authorFilter), 300)');
  });

  it('loadMore (paging) keeps the same server-side filters', () => {
    // two occurrences: loadHistory + loadMore
    expect((page.match(/logOpts\.author = debouncedAuthorFilter\.trim\(\)/g) ?? []).length).toBe(2);
  });

  it('a filter change re-runs the load (deps include the debounced author + dates)', () => {
    expect(page).toContain('status?.behind, debouncedAuthorFilter, dateFrom, dateTo]');
  });
});

// ── 3b. git service — arg building order ────────────────────────────────────
describe('v2.3.5 — git log service: author/since/until BEFORE the pathspec', () => {
  const src = read('electron/services/git.ts');
  const optsBlock = src.slice(src.indexOf('if (author && author.trim())'), src.indexOf('let out: string;', src.indexOf('if (author && author.trim())')));

  it('author/since/until are pushed before the `--` file separator', () => {
    const authorIdx = optsBlock.indexOf('--author=');
    const fileIdx = optsBlock.indexOf("rawArgs.push('--', file)");
    expect(authorIdx).toBeGreaterThan(-1);
    expect(fileIdx).toBeGreaterThan(authorIdx);
  });

  it('author matching is case-insensitive (matches the UI promise)', () => {
    expect(src).toContain("rawArgs.push('--regexp-ignore-case')");
  });
});
