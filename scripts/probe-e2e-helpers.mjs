import { launchApp } from '../tests/e2e/helpers.ts';

const ctx = await launchApp();
const page = ctx.page;
console.log('url after launchApp:', page.url());
const btn = page.locator('button:has-text("test-repo")');
console.log('matching buttons count:', await btn.count());
for (let i = 0; i < await btn.count(); i++) {
  const b = btn.nth(i);
  console.log(`btn[${i}] visible=${await b.isVisible().catch(() => false)} text=${JSON.stringify((await b.textContent().catch(() => '')).slice(0, 60))} tag=${await b.evaluate((el) => el.tagName).catch(() => '?')}`);
}
await page.screenshot({ path: '/tmp/probe3.png' });
await ctx.close();
