/**
 * ThemeZoneEditor — per-zone color customization (v2.3).
 *
 * WHY THIS EXISTS: the theme palette used to be a flat elevation system
 * (--bg-primary/secondary/tertiary) shared by MANY unrelated regions —
 * the sidebar and page panels both painted with --bg-secondary, the
 * toolbar, panel headers and status bar all painted with --bg-tertiary.
 * Customizing "the sidebar" via a raw CSS variable recolored panels in
 * every other window at the same time — reported by the user as
 * «зоны не соответствуют, настраиваешь одно, а цвета меняются в других
 * окнах/областях».
 *
 * The fix is architectural: every zone now reads its own --zone-* token
 * (see globals.css). This editor is the UI over those tokens — pick a
 * zone, pick a color, and ONLY that zone changes. Values are stored in
 * settings.customThemeOverrides (same storage as the raw JSON editor in
 * Settings → Advanced — both views stay in sync), and applied live by
 * the injection effect in App.tsx.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Palette, RotateCcw } from './icons';
import { useSettingsStore } from '../stores/settingsStore';
import { useI18n } from '../lib/i18n';
import { cn } from '../lib/utils';

/** One customizable zone: a CSS token + the label + the preview part id. */
export interface ThemeZoneDef {
  /** CSS custom property written into customThemeOverrides. */
  varName: string;
  /** i18n key for the zone label. */
  labelKey: string;
  /** i18n key for the one-line description of what the zone covers. */
  hintKey: string;
  /** Matching part in the mini-layout preview diagram (null = shared token). */
  part?: 'titlebar' | 'gitbar' | 'sidebar' | 'main' | 'panel' | 'panelHeader' | 'popover' | 'statusbar';
}

/** The 8 zone tokens — one per UI region, per globals.css zone map. */
export const THEME_ZONES: ThemeZoneDef[] = [
  { varName: '--zone-titlebar-bg', labelKey: 'settings.zoneTitlebar', hintKey: 'settings.zoneTitlebarHint', part: 'titlebar' },
  { varName: '--zone-gitbar-bg', labelKey: 'settings.zoneGitbar', hintKey: 'settings.zoneGitbarHint', part: 'gitbar' },
  { varName: '--zone-sidebar-bg', labelKey: 'settings.zoneSidebar', hintKey: 'settings.zoneSidebarHint', part: 'sidebar' },
  { varName: '--zone-main-bg', labelKey: 'settings.zoneMain', hintKey: 'settings.zoneMainHint', part: 'main' },
  { varName: '--zone-panel-bg', labelKey: 'settings.zonePanel', hintKey: 'settings.zonePanelHint', part: 'panel' },
  { varName: '--zone-panel-header-bg', labelKey: 'settings.zonePanelHeader', hintKey: 'settings.zonePanelHeaderHint', part: 'panelHeader' },
  { varName: '--zone-popover-bg', labelKey: 'settings.zonePopover', hintKey: 'settings.zonePopoverHint', part: 'popover' },
  { varName: '--zone-statusbar-bg', labelKey: 'settings.zoneStatusbar', hintKey: 'settings.zoneStatusbarHint', part: 'statusbar' },
];

/** Shared (non-zonal) tokens users ask for most — grouped separately. */
export const THEME_COMMON_TOKENS: ThemeZoneDef[] = [
  {
    varName: '--accent',
    labelKey: 'settings.zoneCommonAccent',
    hintKey: 'settings.zoneCommonAccentHint',
  },
];

/** rgb(...)/rgba(...) → #rrggbb (alpha dropped — inputs are opaque). */
function cssColorToHex(raw: string): string | null {
  const v = raw.trim();
  const m = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const hex = (n: string) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  }
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  if (/^#[0-9a-f]{8}$/i.test(v)) return v.slice(0, 7).toLowerCase(); // #rrggbbaa → #rrggbb
  return null; // gradients / mixed values — leave the text field alone
}

/**
 * Read the LIVE resolved color of a CSS token — reflects the active theme
 * AND any injected overrides, so each row opens showing the color the zone
 * is RIGHT NOW. The sidebar token is read off the REAL sidebar element:
 * the dim-sidebar themes scope their dark palette to <aside>, which the
 * <html>-level read cannot see.
 */
function resolvedToken(varName: string): string | null {
  let el: Element | null = null;
  if (varName === '--zone-sidebar-bg') {
    el = document.querySelector('.sidebar-root');
  }
  const target = el ?? document.documentElement;
  const raw = getComputedStyle(target).getPropertyValue(varName);
  return cssColorToHex(raw);
}

export function ThemeZoneEditor() {
  const { t } = useI18n();
  const settings = useSettingsStore((s) => s.settings);
  const setSetting = useSettingsStore((s) => s.setSetting);
  const overrides = settings.customThemeOverrides ?? {};
  const [hoveredPart, setHoveredPart] = useState<NonNullable<ThemeZoneDef['part']> | null>(null);
  const [live, setLive] = useState<Record<string, string>>({});
  // Text the user is typing that isn't a valid color yet — kept locally so
  // the input doesn't fight them (only valid #rrggbb commits to the store).
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Re-resolve live values whenever overrides or the theme change — the
  // injected <style> is applied by an App effect, so tick past it.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const next: Record<string, string> = {};
      for (const z of [...THEME_ZONES, ...THEME_COMMON_TOKENS]) {
        const hex = resolvedToken(z.varName);
        if (hex) next[z.varName] = hex;
      }
      setLive(next);
    });
    return () => cancelAnimationFrame(raf);
  }, [overrides]);

  const writeToken = useCallback(
    (varName: string, value: string | null) => {
      const next = { ...overrides };
      if (value == null) {
        delete next[varName];
        setDrafts((d) => {
          const { [varName]: _drop, ...rest } = d;
          return rest;
        });
      } else {
        next[varName] = value;
      }
      void setSetting('customThemeOverrides', Object.keys(next).length ? next : undefined);
    },
    [overrides, setSetting],
  );

  const resetAll = useCallback(() => {
    // Wipe ONLY the zone/common tokens this editor owns — a power user's
    // raw JSON keys (diff colors, etc.) survive.
    const next: Record<string, string> = {};
    const managed = new Set([...THEME_ZONES, ...THEME_COMMON_TOKENS].map((z) => z.varName));
    for (const [k, v] of Object.entries(overrides)) {
      if (!managed.has(k)) next[k] = v;
    }
    setDrafts({});
    void setSetting('customThemeOverrides', Object.keys(next).length ? next : undefined);
  }, [overrides, setSetting]);

  const overriddenCount = useMemo(
    () => [...THEME_ZONES, ...THEME_COMMON_TOKENS].filter((z) => overrides[z.varName]).length,
    [overrides],
  );

  const renderRow = (z: ThemeZoneDef) => {
    const overridden = overrides[z.varName];
    const value = drafts[z.varName] ?? overridden ?? live[z.varName] ?? '';
    const diagram = z.part ? partStyle(z.part, hoveredPart === z.part, overridden != null) : null;
    return (
      <div
        key={z.varName}
        className={cn(
          'flex items-center gap-3 px-3 py-2 rounded-md border transition-colors',
          overridden
            ? 'border-accent/60 bg-accent-muted/30'
            : 'border-border-subtle hover:border-border-default',
        )}
        onMouseEnter={() => z.part && setHoveredPart(z.part)}
        onMouseLeave={() => setHoveredPart((cur) => (cur === z.part ? null : cur))}
        data-testid={`zone-row-${z.varName}`}
      >
        <input
          type="color"
          className="w-7 h-7 rounded border border-border-default cursor-pointer bg-transparent p-0 shrink-0"
          value={cssColorToHex(value) ?? '#000000'}
          onChange={(e) => writeToken(z.varName, e.target.value)}
          title={t(z.labelKey)}
          aria-label={t(z.labelKey)}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium flex items-center gap-2">
            {t(z.labelKey)}
            {overridden && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-accent/15 text-accent font-semibold">
                {t('settings.zoneCustomized')}
              </span>
            )}
          </div>
          <div className="text-xs text-text-tertiary truncate">{t(z.hintKey)}</div>
        </div>
        <input
          type="text"
          className={cn(
            'w-24 text-xs font-mono px-2 py-1 rounded border bg-zone-panel border-border-default focus:outline-none focus:border-accent shrink-0',
          )}
          placeholder={live[z.varName] ?? '#rrggbb'}
          value={value}
          onChange={(e) => {
            setDrafts((d) => ({ ...d, [z.varName]: e.target.value }));
            const hex = cssColorToHex(e.target.value);
            if (hex) writeToken(z.varName, hex);
          }}
          onBlur={() =>
            setDrafts((d) => {
              const { [z.varName]: _drop, ...rest } = d;
              return rest;
            })
          }
          spellCheck={false}
        />
        <button
          className="icon-btn !w-6 !h-6 shrink-0"
          title={t('settings.zoneResetOne')}
          disabled={!overridden}
          onClick={() => writeToken(z.varName, null)}
        >
          <RotateCcw size={11} />
        </button>
        {diagram}
      </div>
    );
  };

  return (
    <div className="mt-5 pt-4 border-t border-border-subtle" data-testid="theme-zone-editor">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Palette size={13} className="text-accent" />
          <span className="text-xs font-semibold uppercase tracking-wide">
            {t('settings.zoneColorsTitle')}
          </span>
        </div>
        {overriddenCount > 0 && (
          <button className="btn btn-secondary text-2xs px-2 py-1" onClick={resetAll}>
            <RotateCcw size={11} className="mr-1" />
            {t('settings.zoneResetAll', { count: overriddenCount })}
          </button>
        )}
      </div>
      <div className="text-xs text-text-tertiary mb-3">
        {t('settings.zoneColorsHint')}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Zone rows */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          {THEME_ZONES.map(renderRow)}
          <div className="mt-1 text-2xs font-semibold uppercase tracking-wider text-text-tertiary px-1">
            {t('settings.zoneCommonGroup')}
          </div>
          {THEME_COMMON_TOKENS.map(renderRow)}
        </div>

        {/* Live mini-layout — mirrors the real app zones. Hovering a row
            highlights the matching part; parts painted with a custom color
            get a small dot. Colors resolve LIVE from the CSS tokens, so
            the preview updates as the user picks. */}
        <div className="lg:w-64 shrink-0">
          <div className="text-2xs text-text-tertiary mb-1.5 px-1">
            {t('settings.zonePreviewHint')}
          </div>
          <div
            className="rounded-lg border border-border-default overflow-hidden shadow-sm"
            data-testid="zone-preview"
          >
            {/* titlebar */}
            <div
              className="h-5 flex items-center gap-1 px-2 border-b border-border-default"
              style={{ background: 'var(--zone-titlebar-bg)' }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--status-deleted)' }} />
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--status-modified)' }} />
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--status-added)' }} />
              <span className="text-3xs ml-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                PrismGit
              </span>
            </div>
            {/* gitbar */}
            <div
              className="h-4 flex items-center gap-1.5 px-2 border-b border-border-default"
              style={{ background: 'var(--zone-gitbar-bg)' }}
            >
              <span className="text-3xs rounded px-1" style={{ background: 'var(--accent)', color: 'var(--text-inverse)' }}>
                main
              </span>
              <span className="text-3xs rounded px-1" style={{ background: 'var(--accent-muted)', color: 'var(--accent)' }}>
                Pull
              </span>
            </div>
            <div className="flex" style={{ minHeight: 108 }}>
              {/* sidebar — background from the LIVE sidebar value (accurate
                  for dim-sidebar themes), falling back to the CSS token */}
              <div
                className="w-14 flex flex-col gap-1 p-1.5 border-r border-border-default"
                style={{ background: live['--zone-sidebar-bg'] ?? 'var(--zone-sidebar-bg)' }}
              >
                <span className="h-2 rounded-sm" style={{ background: 'var(--accent)', opacity: 0.55 }} />
                <span className="h-2 rounded-sm" style={{ background: 'var(--text-secondary)', opacity: 0.3 }} />
                <span className="h-2 rounded-sm" style={{ background: 'var(--text-secondary)', opacity: 0.3 }} />
                <span className="h-2 rounded-sm" style={{ background: 'var(--text-secondary)', opacity: 0.3 }} />
              </div>
              {/* main + panel + popover chip */}
              <div className="flex-1 p-2 flex flex-col gap-1.5" style={{ background: 'var(--zone-main-bg)' }}>
                <div className="rounded border border-border-default overflow-hidden">
                  <div
                    className="h-4 flex items-center px-1.5 text-3xs font-bold uppercase tracking-wider"
                    style={{ background: 'var(--zone-panel-header-bg)', color: 'var(--text-secondary)' }}
                  >
                    panel
                  </div>
                  <div className="h-8 p-1.5 flex flex-col gap-1" style={{ background: 'var(--zone-panel-bg)' }}>
                    <span className="h-1.5 w-3/4 rounded-sm" style={{ background: 'var(--text-secondary)', opacity: 0.45 }} />
                    <span className="h-1.5 w-1/2 rounded-sm" style={{ background: 'var(--text-secondary)', opacity: 0.3 }} />
                  </div>
                </div>
                <div
                  className="self-start px-1.5 py-0.5 rounded text-3xs border border-border-default shadow-md"
                  style={{ background: 'var(--zone-popover-bg)', color: 'var(--text-primary)' }}
                >
                  menu
                </div>
              </div>
            </div>
            {/* statusbar */}
            <div
              className="h-4 flex items-center justify-between px-2 border-t border-border-default text-3xs"
              style={{ background: 'var(--zone-statusbar-bg)', color: 'var(--text-tertiary)' }}
            >
              <span>ready</span>
              <span>main</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Hover-highlight ring for a diagram part — rendered INSIDE the hovered
 * row as a tiny inline chip showing where the zone lives. Returns null
 * for shared tokens (no diagram part of their own).
 */
function partStyle(part: NonNullable<ThemeZoneDef['part']>, isHovered: boolean, customized: boolean): React.ReactNode {
  return (
    <span
      className={cn(
        'text-2xs px-1.5 py-0.5 rounded border shrink-0 hidden sm:inline-block',
        isHovered ? 'border-accent text-accent bg-accent-muted/40' : 'border-border-subtle text-text-tertiary',
      )}
    >
      {partLabel(part)}
      {customized && ' •'}
    </span>
  );
}

function partLabel(part: NonNullable<ThemeZoneDef['part']>): string {
  // Intentionally short non-i18n tags (zone names are latin in the token itself)
  switch (part) {
    case 'titlebar': return 'toolbar';
    case 'gitbar': return 'git bar';
    case 'sidebar': return 'sidebar';
    case 'main': return 'main';
    case 'panel': return 'panel';
    case 'panelHeader': return 'panel head';
    case 'popover': return 'popover';
    case 'statusbar': return 'status bar';
    default: return part;
  }
}
