import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * The service worker caches the application shell so the app opens offline.
 * It is registered in production builds only — during development the module
 * graph changes constantly and a cached shell only gets in the way.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {
      // An unavailable service worker costs offline support, nothing else.
    });
  });
}
