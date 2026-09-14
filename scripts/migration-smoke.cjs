/**
 * Migration smoke test: seed legacy plaintext stores, boot the app, verify
 * the migration moved secrets into the vault and stripped the JSON files.
 */
const { _electron: electron } = require('playwright');
const fs = require('fs');
const path = require('path');

const USER_DATA = '/tmp/prismgit-migrate-smoke';
const APP = '/home/z/my-project/gitclient';

(async () => {
  fs.rmSync(USER_DATA, { recursive: true, force: true });
  fs.mkdirSync(USER_DATA, { recursive: true });
  // Legacy plaintext stores (old PrismGit versions)
  fs.writeFileSync(path.join(USER_DATA, 'prismgit-settings.json'), JSON.stringify({
    settings: {
      theme: 'light',
      githubPAT: 'ghp_LEGACY-TOKEN',
      remoteAuth: {
        '/home/user/legacy-repo': { origin: { username: 'bob', password: 'LEGACY-PASS' } },
      },
      aiProviderConfigs: { openai: { apiKey: 'sk-LEGACY', model: 'gpt-4o-mini' } },
    },
  }, null, 2));
  fs.writeFileSync(path.join(USER_DATA, 'prismgit-github.json'), JSON.stringify({
    github: { token: 'ghp_LEGACY-GITHUB', user: { login: 'octocat' } },
  }, null, 2));

  const app = await electron.launch({
    args: [APP, '--no-sandbox', '--disable-gpu'],
    env: { ...process.env, PRISMGIT_USER_DATA: USER_DATA },
    cwd: APP,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  const results = [];
  const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);

  try {
    await new Promise((r) => setTimeout(r, 500));
    // Rehydrated values visible to the renderer
    const remoteAuth = await win.evaluate(() => window.smartgit.settings.get('remoteAuth'));
    check('remoteAuth rehydrated after migration',
      remoteAuth?.['/home/user/legacy-repo']?.origin?.password === 'LEGACY-PASS',
      JSON.stringify(remoteAuth));
    const pat = await win.evaluate(() => window.smartgit.settings.get('githubPAT'));
    check('githubPAT rehydrated', pat === 'ghp_LEGACY-TOKEN', String(pat));
    const aiCfg = await win.evaluate(() => window.smartgit.settings.get('aiProviderConfigs'));
    check('aiProviderConfigs rehydrated', aiCfg?.openai?.apiKey === 'sk-LEGACY', JSON.stringify(aiCfg));
    const status = await win.evaluate(() => window.smartgit.credentials.status());
    check('vault has secrets', status.secretCount >= 4, JSON.stringify(status));

    // On-disk: legacy JSONs must be stripped
    await new Promise((r) => setTimeout(r, 400));
    const settingsRaw = fs.readFileSync(path.join(USER_DATA, 'prismgit-settings.json'), 'utf8');
    check('settings.json stripped', !settingsRaw.includes('LEGACY-PASS') && !settingsRaw.includes('ghp_LEGACY-TOKEN') && !settingsRaw.includes('sk-LEGACY'));
    const githubRaw = fs.readFileSync(path.join(USER_DATA, 'prismgit-github.json'), 'utf8');
    check('github.json token stripped', !githubRaw.includes('ghp_LEGACY-GITHUB'), githubRaw.slice(0, 120));
    check('github.json user preserved', githubRaw.includes('octocat'));
    // Secrets stay functional in the vault file (fallback backend here)
    const vaultRaw = fs.readFileSync(path.join(USER_DATA, 'prismgit-secrets.json'), 'utf8');
    check('vault holds migrated secrets', vaultRaw.includes('LEGACY-PASS') && vaultRaw.includes('ghp_LEGACY-TOKEN') && vaultRaw.includes('sk-LEGACY'));

    // GitHub auth state uses the migrated token
    const authState = await win.evaluate(() => window.smartgit.github.getAuthState ? window.smartgit.github.getAuthState() : null).catch(() => null);
    check('github auth state readable', authState !== null, authState ? JSON.stringify(authState).slice(0, 80) : 'no method');
  } catch (e) {
    check('unexpected exception', false, String(e).split('\n')[0]);
  } finally {
    await app.close();
  }

  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})();
