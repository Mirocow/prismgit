import { _electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
// minimal seed: no repos
const app = await _electron.launch({
  args: ['--no-sandbox', path.join(process.cwd(), 'dist-electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production', DISPLAY: process.env.DISPLAY || ':99', PRISMGIT_USER_DATA: userDataDir, PRISMGIT_LOCALE: 'en' },
});
app.process().stdout?.on('data', (d) => console.log('[main.out]', String(d).trim()));
app.process().stderr?.on('data', (d) => console.log('[main.err]', String(d).trim()));
const page = await app.firstWindow();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[renderer]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));
await page.waitForTimeout(2500);
console.log('--- clicking welcome repo button (none seeded, expect absent) ---');
console.log('window url:', page.url());
await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });
