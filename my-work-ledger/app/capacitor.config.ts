/**
 * Capacitor configuration — the Android wrapper around the same web app.
 *
 * The point of the Android build is not a different app. It is the one thing a
 * web page genuinely cannot do: fire a reminder when it is closed. Everything
 * else — the ledger, the figures, the PDFs, the offline cache — is the same
 * code running in a WebView, so there is no second implementation to keep in
 * step and no feature that exists on one platform only.
 *
 * `androidScheme: 'https'` serves the app from `https://localhost`, which is a
 * secure context. Firebase Auth and Firestore's persistent cache both require
 * one; on the older `http://localhost` scheme the cache silently falls back to
 * memory and a reinstall would lose offline data.
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.saheerlab.myworkledger',
  appName: 'My Work Ledger',
  // The Vite output. `npx cap sync android` copies it into the APK, so the app
  // ships with the web build rather than loading one over the network.
  webDir: 'dist',

  server: {
    androidScheme: 'https',
  },

  android: {
    // Nothing in this app loads an http:// resource; refusing mixed content
    // means a tampered network cannot inject one into the WebView.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },

  plugins: {
    LocalNotifications: {
      // A silhouette, as Android requires: a full-colour icon is drawn as a
      // white square in the status bar.
      smallIcon: 'ic_stat_notify',
      iconColor: '#4338CA',
    },
    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      backgroundColor: '#F4F5F8',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
};

export default config;
