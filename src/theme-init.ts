// Theme initialization — loaded before React to prevent FOUC.
// This file is loaded as a regular module, not inline script.
//
// Two things applied early:
//   1. Theme class (.dark) on <html>
//   2. Contrast filter on #root (read from localStorage; settingsStore will
//      re-apply once React mounts, but applying early prevents a flash)
try {
  var theme = localStorage.getItem('smartgit-theme') || 'light';
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {
  // Default to light
}

try {
  var contrastRaw = localStorage.getItem('smartgit-contrast');
  var contrast = contrastRaw ? parseInt(contrastRaw, 10) : 100;
  if (!isNaN(contrast) && contrast !== 100) {
    // Clamp to safe range — anything outside 50–150 makes text hard to read.
    var clamped = Math.max(50, Math.min(150, contrast));
    // We can't select #root yet (it doesn't exist when this module loads),
    // so we apply to <html> for the early flash, then settingsStore will
    // move it to #root once React mounts.
    document.documentElement.style.filter = 'contrast(' + clamped + '%)';
  }
} catch (e) {
  // Ignore — settings will be re-applied after React mounts
}
