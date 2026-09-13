/**
 * Unit tests for the About window data model + HTML renderer
 * (electron/aboutInfo.ts — pure module, no Electron imports).
 */
import { describe, it, expect } from 'vitest';
import {
  esc,
  formatBuildDate,
  buildSystemSummary,
  buildAboutHtml,
  ABOUT_REPOSITORY_URL,
  ABOUT_LICENSE,
  ABOUT_FEATURES,
  type AboutInfo,
} from '../../electron/aboutInfo';

const INFO: AboutInfo = {
  name: 'PrismGit',
  version: '2.0.0',
  buildDate: '2026-09-10T09:30:00.000Z',
  electron: '32.3.3',
  chrome: '128.0.6613.186',
  node: '20.18.1',
  v8: '12.4.254.20',
  osType: 'Darwin',
  osRelease: '23.6.0',
  platform: 'darwin',
  arch: 'arm64',
  locale: 'en-US',
  firstLaunch: '2026-08-01T12:00:00.000Z',
  repositoryUrl: ABOUT_REPOSITORY_URL,
  license: ABOUT_LICENSE,
};

describe('esc', () => {
  it('escapes HTML-special characters', () => {
    expect(esc(`<img src=x onerror="alert('1')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;'
    );
  });
});

describe('formatBuildDate', () => {
  it('formats a valid ISO date', () => {
    const out = formatBuildDate('2026-09-10T09:30:00.000Z');
    expect(out).toContain('2026');
    expect(out).toMatch(/\d{2}:\d{2}/);
  });

  it('returns the raw input for invalid dates', () => {
    expect(formatBuildDate('not-a-date')).toBe('not-a-date');
    expect(formatBuildDate('')).toBe('unknown');
  });
});

describe('buildSystemSummary', () => {
  it('includes app identity, versions, OS and links', () => {
    const s = buildSystemSummary(INFO);
    const lines = s.split('\n');
    expect(lines[0]).toBe('PrismGit 2.0.0');
    expect(s).toContain('Electron:     32.3.3 (Chromium 128.0.6613.186, Node.js 20.18.1, V8 12.4.254.20)');
    expect(s).toContain('OS:           Darwin 23.6.0 (darwin-arm64)');
    expect(s).toContain('Locale:       en-US');
    expect(s).toContain(`Repository:   ${ABOUT_REPOSITORY_URL}`);
    expect(s).toContain(`License:      ${ABOUT_LICENSE}`);
  });
});

describe('buildAboutHtml', () => {
  const html = buildAboutHtml(INFO, { logoSrc: 'data:image/png;base64,AAA' });

  it('renders the app name, version and logo', () => {
    expect(html).toContain('<title>About PrismGit</title>');
    expect(html).toContain('PrismGit');
    expect(html).toContain('v2.0.0');
    expect(html).toContain('src="data:image/png;base64,AAA"');
  });

  it('renders runtime versions and system rows', () => {
    // The About page intentionally shows a compact system table (Chromium,
    // Node.js, V8, OS and Platform rows were dropped from the layout).
    expect(html).toContain('<td class="k">Version</td><td class="v">2.0.0</td>');
    expect(html).toContain('32.3.3');
    expect(html).toContain('en-US');
    expect(html).toContain('First launch');
    expect(html).toContain(ABOUT_LICENSE);
  });

  it('renders all feature chips', () => {
    for (const f of ABOUT_FEATURES) {
      expect(html).toContain(`>${f}</span>`);
    }
  });

  it('closes via the Close button (window.close) — no copy/links UI anymore', () => {
    expect(html).toContain('id="close-btn"');
    expect(html).toContain("window.close()");
    expect(html).not.toContain('Copy System Info');
    expect(html).not.toContain('navigator.clipboard');
    expect(html).not.toContain('Project Repository');
  });

  it('escapes untrusted-looking values (no raw HTML injection)', () => {
    const hostile = buildAboutHtml(
      { ...INFO, version: '<script>alert(1)</script>', osType: '<img src=x>' },
      { logoSrc: '' }
    );
    expect(hostile).not.toContain('<script>alert(1)</script>');
    expect(hostile).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(hostile).not.toContain('<img src=x>');
  });

  it('falls back to a CSS logo when no logo source is provided', () => {
    const noLogo = buildAboutHtml(INFO, { logoSrc: '' });
    expect(noLogo).toContain('logo-fallback');
    expect(noLogo).not.toContain('<img class="logo"');
  });
});
