import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * TEST-2 — axe-core accessibility audit.
 *
 * Runs axe-core against each major page of the app and asserts there
 * are ZERO WCAG violations (level AA). Run with:
 *
 *   npx playwright test tests/e2e/accessibility.test.ts
 *
 * The test starts the Vite dev server (configured in playwright.config.ts)
 * and navigates to each route via the HashRouter (so we don't need the
 * Electron main process to be running — the React app loads directly
 * from the Vite dev server).
 *
 * Each test reports its axe violations to stdout on failure, so the
 * developer can see exactly what to fix.
 *
 * NOTE: these tests SKIP rule 'color-contrast' because axe can't read
 * our CSS-variable-based theme colors at runtime. The contrast audit
 * is covered separately by scripts/audit-contrast.mjs (which runs at
 * build time, not at runtime).
 */

const PAGES = [
  { name: 'Changes',    hash: '#/changes' },
  { name: 'History',    hash: '#/history' },
  { name: 'Branches',   hash: '#/branches' },
  { name: 'Tags',       hash: '#/tags' },
  { name: 'Stashes',    hash: '#/stashes' },
  { name: 'Settings',   hash: '#/settings' },
];

for (const page of PAGES) {
  test(`${page.name} page has no accessibility violations`, async ({ page: pwPage }) => {
    await pwPage.goto(`http://localhost:5173/${page.hash}`);
    // Wait for the boot screen to disappear.
    await pwPage.waitForSelector('#boot-screen', { state: 'detached', timeout: 15000 }).catch(() => { /* may not be present */ });
    // Wait for the app to render.
    await pwPage.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page: pwPage })
      // Skip color-contrast — covered by scripts/audit-contrast.mjs at build time.
      .disableRules(['color-contrast'])
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    if (results.violations.length > 0) {
      console.log(`\n${page.name} page — ${results.violations.length} violations:`);
      for (const v of results.violations) {
        console.log(`  [${v.id}] ${v.description}`);
        console.log(`    Impact: ${v.impact}`);
        console.log(`    Help: ${v.helpUrl}`);
        for (const node of v.nodes) {
          console.log(`    Target: ${node.target}`);
          console.log(`    HTML:   ${node.html}`);
        }
      }
    }
    expect(results.violations).toEqual([]);
  });
}

test('WelcomeScreen has no accessibility violations (no repo open)', async ({ page: pwPage }) => {
  await pwPage.goto('http://localhost:5173/');
  await pwPage.waitForSelector('#boot-screen', { state: 'detached', timeout: 15000 }).catch(() => { /* */ });
  await pwPage.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page: pwPage })
    .disableRules(['color-contrast'])
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  if (results.violations.length > 0) {
    console.log(`\nWelcomeScreen — ${results.violations.length} violations:`);
    for (const v of results.violations) {
      console.log(`  [${v.id}] ${v.description}`);
      console.log(`    Help: ${v.helpUrl}`);
    }
  }
  expect(results.violations).toEqual([]);
});
