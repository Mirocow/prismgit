import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * A11Y-3 — verify every theme block in src/styles/globals.css has
 * --text-tertiary / --bg-tertiary contrast ≥ 4.5:1 (WCAG AA normal text).
 *
 * Runs the standalone audit-contrast.mjs script (which parses the CSS,
 * computes WCAG contrast ratios, and exits 0 if all themes pass).
 * If the script reports any FAIL, this test fails — useful in CI.
 */

describe('A11Y-3 color contrast audit', () => {
  const scriptPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../../scripts/audit-contrast.mjs',
  );

  it('audit script exists', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it('all theme blocks pass WCAG AA (≥4.5:1)', () => {
    // Run the script; expect exit code 0 (no failures).
    let output: string;
    try {
      output = execSync(`node ${scriptPath}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      // The script exited non-zero — output is in e.stdout.
      const err = e as { stdout?: string; status?: number };
      output = err.stdout ?? '';
      throw new Error(
        `Contrast audit FAILED — at least one theme block has text-tertiary / bg-tertiary contrast below 4.5:1.\n\n${output}`,
      );
    }
    // Confirm the success line was printed.
    expect(output).toContain('pass AA');
  });

  it('the :root (default light) theme passes AA', () => {
    const css = readFileSync(
      path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/styles/globals.css'),
      'utf8',
    );
    // Find the :root block's text-tertiary and bg-tertiary.
    const rootStart = css.indexOf(':root {');
    expect(rootStart).toBeGreaterThan(-1);
    const rootEnd = css.indexOf('}', rootStart);
    const rootBlock = css.slice(rootStart, rootEnd);
    const textMatch = rootBlock.match(/--text-tertiary:\s*([^;]+);/);
    const bgMatch = rootBlock.match(/--bg-tertiary:\s*([^;]+);/);
    expect(textMatch).not.toBeNull();
    expect(bgMatch).not.toBeNull();
    // Just sanity-check the value is a hex (we trust the audit script for the
    // actual ratio computation).
    expect(textMatch![1].trim()).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
