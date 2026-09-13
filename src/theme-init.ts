// Theme initialization — loaded before React to prevent FOUC.
// This file is loaded as a regular module, not inline script.
//
// Two things applied early:
//   1. Theme class (.dark) + data-theme attribute on <html>
//   2. UI contrast (text/border color overrides) applied to <html> CSS vars.
//      The contrast is read from localStorage; settingsStore re-applies once
//      React mounts. We can't apply it here because the CSS variables aren't
//      defined yet (they're in globals.css which loads after this module).
//      The settingsStore.loadSettings() call will apply it.
try {
  var theme = localStorage.getItem('prismgit-theme') || 'light';
  // Apply both the legacy .dark class (for backward compat with code that
  // checks classList.contains('dark')) AND the data-theme attribute (the
  // actual theme selector used by globals.css to override CSS variables).
  var knownDarkThemes = ['dark', 'github-dark', 'dracula', 'monokai', 'solarized-dark', 'nord', 'tokyo-night', 'catppuccin-mocha', 'one-dark', 'gruvbox-dark'];
  if (knownDarkThemes.indexOf(theme) >= 0) {
    document.documentElement.classList.add('dark');
  }
  document.documentElement.setAttribute('data-theme', theme);
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
