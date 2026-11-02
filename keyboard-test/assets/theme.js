/**
 * Applies the saved theme before the first paint, so the page never flashes
 * the wrong palette. A small classic script in <head>: the module that runs
 * the app loads after the document and would be too late.
 */
(function applyStoredTheme() {
  try {
    var stored = window.localStorage.getItem('keyscope.theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (error) {
    /* storage blocked — the OS preference still applies through CSS */
  }
})();
