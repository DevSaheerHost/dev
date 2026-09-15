/**
 * Applies the saved theme before first paint, so the page never flashes the
 * wrong palette. Deliberately a small classic script in <head> — the module
 * that runs the app loads after the document and would be too late.
 */
(function applyStoredTheme() {
  try {
    var stored = window.localStorage.getItem('quotient.v1.theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (error) {
    /* storage blocked — the OS preference still applies through CSS */
  }
})();
