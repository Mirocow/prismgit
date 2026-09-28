// Theme initialization — loaded before React to prevent FOUC.
// This file is loaded as a regular module, not inline script.
//
// Three things applied early:
//   1. Theme class (.dark) + data-theme attribute on <html>
//   2. Custom-theme CSS variables (style tag) when the saved theme is a
//      user-created one — the entry is mirrored in localStorage
//      ('prismgit-custom-active') by settingsStore so this pre-React code
//      can rebuild the exact palette without waiting for the settings IPC.
//   3. UI contrast marker (data-contrast) for settingsStore to pick up.
//
// BUGFIX history: the dark-theme list here used to be a hard-coded subset
// that drifted from src/lib/themes.ts. It is derived from the registry now,
// and LEGACY ids (pre-curation picks like dracula) migrate to their curated
// replacement so an old localStorage value never boots a theme whose CSS
// block no longer exists.
import { THEMES, normalizeThemeId, isCustomThemeId } from './lib/themes';
import { applyCustomThemeStyleTag, loadActiveCustomTheme } from './lib/customThemeCss';

const registryDarkThemes: string[] = THEMES.filter((t) => t.isDark).map((t) => t.id);
const registryLightThemes: string[] = THEMES.filter((t) => !t.isDark).map((t) => t.id);
// Fallback if reading the registry ever throws (defensive — same content).
const fallbackDarkThemes = ['one-dark', 'discord'];

try {
  var themeRaw = localStorage.getItem('prismgit-theme') || 'light';
  var theme = normalizeThemeId(themeRaw);
  var knownDarkThemes = registryDarkThemes.length > 0 ? registryDarkThemes : fallbackDarkThemes;
  var knownLightThemes = registryLightThemes;
  // 4.2 — "Automatically select light/dark": before React mounts we can't
  // compute the exact theme pair, but we can avoid a light flash when the
  // OS is dark. If the saved theme is light and the system prefers dark,
  // fall back to the default dark pole; settingsStore resolves the proper
  // pair once it loads.
  try {
    if (
      localStorage.getItem('prismgit-theme-mode') === 'auto' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      var isKnownDark = knownDarkThemes.indexOf(theme) >= 0 || (isCustomThemeId(theme) && loadActiveCustomTheme()?.isDark);
      if (!isKnownDark && (knownLightThemes.indexOf(theme) >= 0 || isCustomThemeId(theme))) {
        theme = 'one-dark';
      }
    }
  } catch (e2) { /* ignore */
  }
  // Custom theme: rebuild its palette before anything paints.
  if (isCustomThemeId(theme)) {
    const entry = loadActiveCustomTheme();
    if (entry && entry.id === theme) {
      applyCustomThemeStyleTag(entry);
      if (entry.isDark) document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      // Custom id without a mirror (first boot on a new machine) — the
      // settingsStore load will resolve it; boot on the light default.
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } else {
    // Apply both the legacy .dark class (for backward compat with code that
    // checks classList.contains('dark')) AND the data-theme attribute (the
    // actual theme selector used by globals.css to override CSS variables).
    if (knownDarkThemes.indexOf(theme) >= 0) {
      document.documentElement.classList.add('dark');
    }
    document.documentElement.setAttribute('data-theme', theme);
  }
} catch (e) {
  // Default to light
}

// Contrast is applied by settingsStore after the CSS is loaded — we just
// persist the value here so it's available before React mounts.
try {
  var contrastRaw = localStorage.getItem('prismgit-contrast');
  if (contrastRaw) {
    var contrast = parseInt(contrastRaw, 10);
    if (!isNaN(contrast) && contrast !== 100) {
      // Store on a data attribute so settingsStore can pick it up
      document.documentElement.setAttribute('data-contrast', String(contrast));
    }
  }
} catch (e) {
  // Ignore
}
