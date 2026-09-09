// Theme initialization — loaded before React to prevent FOUC
// This file is loaded as a regular module, not inline script
try {
  var theme = localStorage.getItem('smartgit-theme') || 'light';
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  }
} catch (e) {
  // Default to light
}
