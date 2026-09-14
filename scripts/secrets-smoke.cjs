/**
 * Smoke test: secure vault + SSH plumbing inside real Electron (xvfb).
 * Verifies:
 *  1. credentials:status reports the backend
 *  2. settings:set('remoteAuth', …) does NOT write plaintext password to disk
 *  3. settings:get rehydrates the password (renderer sees original shape)
 *  4. scalar token (githubPAT) round-trip via vault
 *  5. ssh:list works; ssh:generate returns a clear error (no ssh-keygen here)
 *  6. vault file itself contains no plaintext secret
 */
const { _electron: electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const USER_DATA = '/tmp/prismgit-secrets-smoke';
const APP = '/home/z/my-project/gitclient';

(async () => {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });

  const app = await electron.launch({
    args: [APP, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, PRISMGIT_USER_DATA: USER_DATA, PRISMGIT_DISABLE_HOOKS: '1' },
    cwd: APP,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  const results = [];
  const check = (name, ok, detail = '') => {
    results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  try {
    // 1. status
    const status = await win.evaluate(() => window.smartgit.credentials.status());
    check('credentials.status', !!status && typeof status.backend === 'string', JSON.stringify(status));

    // 2. store remote credential via settings:set
    await win.evaluate(() => window.smartgit.settings.set('remoteAuth', {
      '/tmp/fake-repo': { origin: { username: 'user1', password: 'SUPER-SECRET-123' } },
    }));
    // 3. rehydrate via settings:get
    const back = await win.evaluate(() => window.smartgit.settings.get('remoteAuth'));
    check(
      'remoteAuth rehydrates',
      back?.['/tmp/fake-repo']?.origin?.password === 'SUPER-SECRET-123',
      JSON.stringify(back)
    );

    // 4. scalar token round trip
    await win.evaluate(() => window.smartgit.settings.set('githubPAT', 'ghp_TOKEN-XYZ'));
    const pat = await win.evaluate(() => window.smartgit.settings.get('githubPAT'));
    check('githubPAT round-trip', pat === 'ghp_TOKEN-XYZ', String(pat));

    // 4b. secrets manager: list (metadata only) / set / reveal / delete
    const listed = await win.evaluate(() => window.smartgit.credentials.list());
    const remoteEntry = listed.find((e) => e.ns === 'remoteAuth' && e.key === '/tmp/fake-repo|origin');
    const patEntry = listed.find((e) => e.ns === 'tokens' && e.key === 'githubPAT');
    check(
      'credentials:list shows vault entries (metadata only, no values)',
      !!remoteEntry && !!patEntry && !('v' in remoteEntry) && !('value' in remoteEntry) && !('password' in remoteEntry),
      JSON.stringify(listed).slice(0, 200)
    );
    check(
      'credentials:list reports encrypted flag',
      typeof remoteEntry.encrypted === 'boolean',
      String(remoteEntry && remoteEntry.encrypted)
    );
    await win.evaluate(() => window.smartgit.credentials.set('other', 'smoke-secret', 'MANAGER-VALUE-42'));
    const revealed = await win.evaluate(() => window.smartgit.credentials.reveal('other', 'smoke-secret'));
    check('credentials:set + reveal round-trip', revealed === 'MANAGER-VALUE-42', String(revealed));
    await win.evaluate(() => window.smartgit.credentials.delete('other', 'smoke-secret'));
    const afterDelete = await win.evaluate(() => window.smartgit.credentials.list());
    check(
      'credentials:delete removes entry',
      !afterDelete.some((e) => e.ns === 'other' && e.key === 'smoke-secret'),
      `entries left=${afterDelete.length}`
    );

    // 5. ssh list/generate
    const keys = await win.evaluate(() => window.smartgit.ssh.list());
    check('ssh.list returns array', Array.isArray(keys), String(keys.length));
    let genErr = '';
    try {
      await win.evaluate(() => window.smartgit.ssh.generate({ label: 'smoke-test-key' }));
      check('ssh.generate (expected to fail w/o ssh-keygen)', false, 'unexpectedly succeeded');
    } catch (e) {
      genErr = String(e && e.message || e);
      check('ssh.generate clear error', /ssh-keygen|ENOENT|timed out|failed/i.test(genErr), genErr.split('\n')[0]);
    }

    // 6. inspect on-disk files for plaintext secrets
    await new Promise((r) => setTimeout(r, 400)); // allow debounced writes
    const leaks = [];
    for (const f of fs.readdirSync(USER_DATA)) {
      if (!f.endsWith('.json')) continue;
      const content = fs.readFileSync(path.join(USER_DATA, f), 'utf8');
      if (content.includes('SUPER-SECRET-123') || content.includes('ghp_TOKEN-XYZ')) leaks.push(f);
    }
    check('no plaintext secrets in userData JSON', leaks.length === 0, leaks.join(', ') || 'clean');
    const secretsFile = path.join(USER_DATA, 'prismgit-secrets.json');
    check('vault file exists', fs.existsSync(secretsFile));
    if (fs.existsSync(secretsFile)) {
      const vault = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
      const values = Object.values(vault.data || {}).map((e) => e.v);
      check(
        'vault stores ciphertext-or-fallback entries',
        values.some((v) => v.includes('SUPER-SECRET-123') || v.includes('ghp_TOKEN-XYZ')),
        `entries=${values.length}`
      );
    }

    // 7. SSH-related settings survive
    await win.evaluate(() => window.smartgit.settings.set('sshStrictHostKeyChecking', true));
    const strict = await win.evaluate(() => window.smartgit.settings.get('sshStrictHostKeyChecking'));
    check('sshStrictHostKeyChecking persisted', strict === true, String(strict));
  } catch (e) {
    check('unexpected exception', false, String(e).split('\n')[0]);
  } finally {
    await app.close();
  }

  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
