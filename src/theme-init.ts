// Theme initialization — loaded before React to prevent FOUC.
// This file is loaded as a regular module, not inline script.
//
// Two things applied early:
//   1. Theme class (.dark) on <html>
//   2. UI contrast (text/border color overrides) applied to <html> CSS vars.
//      The contrast is read from localStorage; settingsStore re-applies once
//      React mounts. We can't apply it here because the CSS variables aren't
//      defined yet (they're in globals.css which loads after this module).
//      The settingsStore.loadSettings() call will apply it.
try {
  var theme = localStorage.getItem('smartgit-theme') || 'light';
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {
  // Default to light
}

// Contrast is applied by settingsStore after the CSS is loaded — we just
// persist the value here so it's available before React mounts.
try {
  var contrastRaw = localStorage.getItem('smartgit-contrast');
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
