import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertAiProvider, getAiProviders, activateAiProvider } from '../../src/lib/aiProviders';
import type { AppSettings } from '../../electron/types/settings-api';

/**
 * v2.3.11 pins — «AI assistant в комитах и не только не работает».
 *
 * Root cause (proven live, scripts/diagnose-ai.mjs): the AI PIPELINE was
 * fully functional (a mock LLM answered every surface — commit messages,
 * assistant panel, chat page), but the OUT-OF-THE-BOX gating made every
 * AI control look dead:
 *   - aiCommitMessagesEnabled defaults to OFF → the Changes «AI» button and
 *     the Toolbar Sparkles (the ASSISTANT — which has nothing to do with
 *     commit messages!) were both disabled with no visible way in;
 *   - adding the first provider did NOT enable the flag → the buttons
 *     stayed dead even after setup;
 *   - the only no-provider signal was a transient toast AFTER typing.
 *
 * The fixes pinned here: controls always clickable, provider-first checks,
 * click = intent (auto-enable), first provider auto-enables, visible
 * no-provider banners with a Settings → AI deep link.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
// The ff9e761 refactor formats with double quotes + multi-line JSX — match
// intent, not formatting.
const flat = (s: string) => s.replace(/\s+/g, '').replace(/"/g, "'");

describe('v2.3.11 — AI controls are not gated by the commit-message flag', () => {
  const toolbar = flat(read('src/components/Toolbar.tsx'));

  it('the Toolbar Sparkles (assistant) has NO disabled= gate anymore', () => {
    const sparkles = toolbar.indexOf('icon={Sparkles}');
    expect(sparkles).toBeGreaterThan(-1);
    // The old gate sat between icon={Sparkles} and the closing of the props.
    const next200 = toolbar.slice(sparkles, sparkles + 400);
    expect(next200).not.toContain('disabled={!settings?.aiCommitMessagesEnabled}');
    expect(next200).toContain("title={t('aiAssistant.toggleTitle')}");
  });

  it('the Changes AI button is disabled only while generating', () => {
    const src = flat(read('src/pages/ChangesPage.tsx'));
    const btn = src.indexOf("title={t('changes.aiGenerateTitle')}");
    expect(btn).toBeGreaterThan(-1);
    const before = src.lastIndexOf('onClick={handleAIGenerate}', btn);
    const zone = src.slice(before, btn + 60);
    expect(zone).toContain('disabled={aiGenerating}');
    expect(zone).not.toContain('aiCommitMessagesEnabled');
  });

  it('handleAIGenerate: provider check FIRST, then auto-enable the flag', () => {
    const src = flat(read('src/pages/ChangesPage.tsx'));
    const fn = src.indexOf('consthandleAIGenerate=async');
    const body = src.slice(fn, fn + 900);
    const providerCheck = body.indexOf('constprovider=buildAIProvider(settings);');
    const noProviderToast = body.indexOf("toast.warning(t('changes.aiNoProvider')");
    const autoEnable = body.indexOf("setSetting('aiCommitMessagesEnabled',true)");
    expect(providerCheck).toBeGreaterThan(-1);
    expect(noProviderToast).toBeGreaterThan(providerCheck);
    expect(autoEnable).toBeGreaterThan(noProviderToast);
    // The old flag-first bounce is gone:
    expect(body).not.toContain("if(!settings?.aiCommitMessagesEnabled){toast.warning(t('changes.aiDisabled')");
  });

  it('MergePanel: same provider-first + auto-enable pattern', () => {
    const src = flat(read('src/components/MergePanel.tsx'));
    expect(src).toContain("setSetting('aiCommitMessagesEnabled',true)");
    expect(src.indexOf('constprovider=buildAIProvider(settings);')).toBeGreaterThan(-1);
  });
});

describe('v2.3.11 — first provider auto-enables the whole AI surface', () => {
  const setSettingCalls: Array<[string, unknown]> = [];
  const setSetting = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettingCalls.push([key, value]);
  };

  it('upsertAiProvider(fist entry) sets aiCommitMessagesEnabled = true', async () => {
    const entry = {
      id: 'p1', name: 'P1', kind: 'ollama', url: 'http://x:1', apiKey: '', model: 'm', enabled: true,
    };
    await upsertAiProvider(undefined, setSetting, entry);
    const keys = setSettingCalls.map(([k]) => k);
    expect(keys).toContain('aiProviders');
    expect(keys).toContain('aiActiveProviderId');
    expect(keys).toContain('aiCommitMessagesEnabled'); // ← the v2.3.11 fix
    const flagCall = setSettingCalls.find(([k]) => k === 'aiCommitMessagesEnabled');
    expect(flagCall?.[1]).toBe(true);
  });

  it('upsertAiProvider(second entry) does NOT touch the flag again', async () => {
    setSettingCalls.length = 0;
    const base: Partial<AppSettings> = {
      aiProviders: [{ id: 'p1', name: 'P1', kind: 'ollama', url: 'http://x:1', apiKey: '', model: 'm', enabled: true }],
      aiActiveProviderId: 'p1',
      aiUrl: 'http://x:1', aiModel: 'm', aiProvider: 'ollama', aiProviderConfigs: {},
    };
    await upsertAiProvider(base, setSetting, { id: 'p2', name: 'P2', kind: 'custom', url: 'http://x:2', apiKey: '', model: 'm2', enabled: true });
    expect(setSettingCalls.map(([k]) => k)).not.toContain('aiCommitMessagesEnabled');
    expect(getAiProviders({ aiProviders: [{ id: 'p2', name: 'P2', kind: 'custom', url: 'http://x:2', apiKey: '', model: 'm2', enabled: true }] })).toHaveLength(1);
  });

  it('activateAiProvider still mirrors the legacy flat fields', async () => {
    setSettingCalls.length = 0;
    const base: Partial<AppSettings> = {
      aiProviders: [{ id: 'p1', name: 'P1', kind: 'ollama', url: 'http://x:1', apiKey: 'k', model: 'm', enabled: true }],
    };
    await activateAiProvider(base, setSetting, 'p1');
    const keys = setSettingCalls.map(([k]) => k);
    for (const k of ['aiActiveProviderId', 'aiProvider', 'aiUrl', 'aiApiKey', 'aiModel', 'aiProviderConfigs']) {
      expect(keys).toContain(k);
    }
  });
});

describe('v2.3.11 — visible no-provider state + Settings deep link', () => {
  it('AiAssistant panel: banner + #/settings?tab=ai + closes the panel', () => {
    const src = flat(read('src/components/AiAssistant.tsx'));
    expect(src).toContain("t('aiAssistant.noProviderBanner')");
    expect(src).toContain("'#/settings?tab=ai'");
    // The banner button closes the panel after navigating:
    const banner = src.indexOf("t('aiAssistant.noProviderBanner')");
    const zone = src.slice(banner, banner + 900);
    expect(zone).toContain('onClose();');
  });

  it('AiChatPage: same banner + deep link', () => {
    const src = flat(read('src/pages/AiChatPage.tsx'));
    expect(src).toContain("t('aiAssistant.noProviderBanner')");
    expect(src).toContain("'#/settings?tab=ai'");
  });

  it('SettingsPage: ?tab=<id> deep link selects the tab', () => {
    const src = flat(read('src/pages/SettingsPage.tsx'));
    expect(src).toContain('tab=([a-z-]+)');
    expect(src).toContain("setActiveTab(tabastypeofactiveTab)");
  });

  it('i18n: the 3 banner keys exist in all four locales', () => {
    const i18n = read('src/i18n/locales/domains/aiassistant.ts');
    for (const key of ['aiAssistant.noProviderBanner', 'aiAssistant.noProviderBannerHint', 'aiAssistant.openSettings']) {
      expect((i18n.match(new RegExp(`['"]${key}['"]:`, 'g')) ?? []).length).toBe(4);
    }
  });
});
