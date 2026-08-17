// core.js
const SystemOS = {
  registry: {},
  editMode: false,
  recentApps: [], // most-recent-first list of app ids, for the App Switcher

  Storage: {
    save: function(appId, data) {
      localStorage.setItem('os_data_' + appId, JSON.stringify(data));
    },
    load: function(appId) {
      const data = localStorage.getItem('os_data_' + appId);
      return data ? JSON.parse(data) : null;
    }
  },

  // ---------- Boot ----------
  boot: function() {
    // 1. Theme
    if (localStorage.getItem('os_theme') === 'dark') {
      document.body.classList.add('dark-mode');
    }

    // 2. Wallpaper
    const savedWallpaper = localStorage.getItem('os_wallpaper');
    if (savedWallpaper) {
      document.getElementById('mobileOS').style.background = savedWallpaper;
    }

    // 3. Load apps from registry
    const savedRegistry = localStorage.getItem('os_system_registry');
    if (savedRegistry) {
      this.registry = JSON.parse(savedRegistry);
      console.log("[OS] System booted. Apps loaded from storage.");
    }
    this.renderHomeScreen();

    // 4. Status bar clock
    this.updateClock();
    setInterval(() => this.updateClock(), 30000);

    // 5. Wire chrome controls
    document.getElementById('closeAppBtn').onclick = () => this.closeApp();

    // Home indicator: single tap closes the current app (if one's open);
    // a second tap within 350ms is treated as a double-tap and opens the
    // App Switcher instead. Works from the home screen too, since the
    // indicator now lives outside #appContainer and is always visible.
    let indicatorTapTimer = null;
    let indicatorLastTap = 0;
    document.getElementById('homeIndicator').onclick = () => {
      const now = Date.now();
      const isDoubleTap = (now - indicatorLastTap) < 350;
      indicatorLastTap = now;
      if (isDoubleTap) {
        clearTimeout(indicatorTapTimer);
        this.openAppSwitcher();
        return;
      }
      indicatorTapTimer = setTimeout(() => {
        if (!document.getElementById('appContainer').classList.contains('hidden')) {
          this.closeApp();
        }
      }, 350);
    };

    // Tapping the switcher's background (not a card) dismisses it
    document.getElementById('appSwitcher').addEventListener('click', (e) => {
      if (e.target.id === 'appSwitcher') this.closeAppSwitcher();
    });
    document.getElementById('switcherClearBtn').onclick = () => this.clearAllRecents();
    document.getElementById('editModeDoneBtn').onclick = () => this.exitEditMode();

    // Install button: delegated on document (not attached to the specific
    // node) so it keeps working even if the button gets destroyed and
    // recreated by a home-screen rebuild — pagination means the button is
    // no longer a single node that's guaranteed to live forever.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('#installNewAppBtn');
      if (btn && !this.editMode) {
        const input = document.getElementById('appInstallerInput');
        if (input) input.click();
      }
    });

    // Tapping empty space on a home page (not an icon) exits edit mode
    document.getElementById('homeScreen').addEventListener('click', (e) => {
      const isBackground = e.target.id === 'homeScreen' || e.target.id === 'homePages' || e.target.classList.contains('home-page');
      if (this.editMode && isBackground) this.exitEditMode();
    });

    // Home page swipe: track which page is active and light up its dot
    const pagesEl = document.getElementById('homePages');
    let pageScrollDebounce;
    pagesEl.addEventListener('scroll', () => {
      clearTimeout(pageScrollDebounce);
      pageScrollDebounce = setTimeout(() => {
        const idx = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
        document.querySelectorAll('#pageDots .page-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
      }, 60);
    });
  },

  updateClock: function() {
    const el = document.getElementById('sbTime');
    if (!el) return;
    const now = new Date();
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    el.innerText = h + ':' + m + ' ' + ampm;
  },

  // ---------- Toast ----------
  toast: function(msg) {
    const el = document.getElementById('osToast');
    if (!el) { console.log('[OS toast]', msg); return; }
    el.innerText = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  },

  // ---------- Native confirm modal ----------
  confirm: function(title, message, onConfirm, confirmLabel) {
    const bg = document.getElementById('osModalBg');
    document.getElementById('osModalTitle').innerText = title;
    document.getElementById('osModalMsg').innerText = message;
    const confirmBtn = document.getElementById('osModalConfirm');
    confirmBtn.innerText = confirmLabel || 'Remove';
    bg.classList.add('open');

    const cancelBtn = document.getElementById('osModalCancel');
    const cleanup = () => {
      bg.classList.remove('open');
      confirmBtn.onclick = null;
      cancelBtn.onclick = null;
    };
    confirmBtn.onclick = () => { cleanup(); onConfirm(); };
    cancelBtn.onclick = () => cleanup();
  },

  // ---------- Backup & Restore ----------
  exportBackup: function() {
    const backup = {
      meta: {
        app: 'Web OS Backup',
        exportedAt: new Date().toISOString()
      },
      data: {}
    };
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('os_')) {
        backup.data[key] = localStorage.getItem(key);
      }
    }
    const dataStr = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = 'webos-backup-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this.toast('Backup exported');
  },

  // Restores a backup previously produced by exportBackup(). Wipes existing
  // os_* storage first so a smaller/older backup doesn't leave orphaned
  // app data or registry entries behind, then reloads to boot cleanly from
  // the restored state. onDone(success) is optional, fired before reload.
  importBackup: function(jsonString, onDone) {
    let parsed;
    try {
      parsed = JSON.parse(jsonString);
    } catch (e) {
      this.toast('Invalid backup file');
      if (onDone) onDone(false);
      return;
    }
    if (!parsed || typeof parsed.data !== 'object') {
      this.toast('This file is not a valid Web OS backup');
      if (onDone) onDone(false);
      return;
    }

    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('os_')) keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    for (let key in parsed.data) {
      if (key.startsWith('os_')) {
        localStorage.setItem(key, parsed.data[key]);
      }
    }

    if (onDone) onDone(true);
    this.toast('Backup restored — reloading…');
    setTimeout(() => location.reload(), 700);
  },

  // ---------- App install / icons ----------
  iconsPerPage: 24, // 4 columns x 6 rows fits the frame without scrolling

  install: function(appConfig) {
    this.registry[appConfig.id] = appConfig;
    localStorage.setItem('os_system_registry', JSON.stringify(this.registry));
    this.renderHomeScreen();
  },

  uninstall: function(appId) {
    const app = this.registry[appId];
    if (!app) return;
    delete this.registry[appId];
    localStorage.setItem('os_system_registry', JSON.stringify(this.registry));
    localStorage.removeItem('os_data_' + appId);
    this.recentApps = this.recentApps.filter(id => id !== appId);
    this.refreshHomeScreen();
    this.toast('Removed ' + app.name);
  },

  refreshHomeScreen: function() {
    this.renderHomeScreen();
  },

  // Legacy per-icon API. Several already-shipped apps (App Store, Studio
  // Pro, Settings) call SystemOS.renderIcon(app) directly, sometimes after
  // wiping #homeScreen themselves. Since pages have to be recomputed as a
  // whole rather than appended to one at a time, this now just triggers a
  // full (cheap) re-layout from the current registry — the passed
  // appConfig is only used as a fallback if the registry hasn't been
  // updated yet.
  renderIcon: function(appConfig) {
    if (appConfig && !this.registry[appConfig.id]) {
      this.registry[appConfig.id] = appConfig;
    }
    this.renderHomeScreen();
  },

  // Rebuilds the entire paginated home screen from this.registry. Safe to
  // call as often as needed — it's the single source of truth for what's
  // on the home screen, which is what makes pagination possible.
  renderHomeScreen: function() {
    const pagesContainer = document.getElementById('homePages');
    if (!pagesContainer) return;

    // The Install button is a real, listener-bearing DOM node (its click
    // handling is delegated on document, so it survives being moved or
    // even recreated). Reuse the existing one if it's still around;
    // recreate it if some other script's home.innerHTML='' destroyed it.
    let installBtn = document.getElementById('installNewAppBtn');
    if (installBtn && installBtn.parentNode) installBtn.parentNode.removeChild(installBtn);
    if (!installBtn) {
      installBtn = document.createElement('div');
      installBtn.className = 'app-icon no-uninstall';
      installBtn.id = 'installNewAppBtn';
      installBtn.innerHTML = '<div class="icon-box" style="background: #2ecc71;">➕</div><span>Install</span>';
    }

    pagesContainer.innerHTML = '';

    const items = Object.keys(this.registry).map(id => this.createIconElement(this.registry[id]));
    items.push(installBtn);

    for (let i = 0; i < items.length; i += this.iconsPerPage) {
      const pageEl = document.createElement('div');
      pageEl.className = 'home-page';
      items.slice(i, i + this.iconsPerPage).forEach(el => pageEl.appendChild(el));
      pagesContainer.appendChild(pageEl);
    }

    this.renderPageDots();
    if (this.editMode) this.applyEditModeVisuals();
  },

  renderPageDots: function() {
    const dotsContainer = document.getElementById('pageDots');
    if (!dotsContainer) return;
    const pages = document.querySelectorAll('#homePages .home-page');
    const pagesEl = document.getElementById('homePages');
    const currentIdx = pagesEl ? Math.round(pagesEl.scrollLeft / Math.max(pagesEl.clientWidth, 1)) : 0;

    dotsContainer.innerHTML = '';
    if (pages.length <= 1) { dotsContainer.style.display = 'none'; return; }
    dotsContainer.style.display = 'flex';

    pages.forEach((_, i) => {
      const dot = document.createElement('div');
      dot.className = 'page-dot' + (i === currentIdx ? ' active' : '');
      dot.onclick = () => {
        pagesEl.scrollTo({ left: i * pagesEl.clientWidth, behavior: 'smooth' });
      };
      dotsContainer.appendChild(dot);
    });
  },

  // Builds a single app icon element. Does not insert it anywhere —
  // renderHomeScreen() places it on the right page.
  createIconElement: function(appConfig) {
    const iconElement = document.createElement('div');
    iconElement.className = 'app-icon';
    iconElement.dataset.appId = appConfig.id;

    iconElement.innerHTML = `
      <div class="icon-box" style="background: ${appConfig.color};">${appConfig.icon}</div>
      <span>${appConfig.name}</span>
    `;

    let pressTimer = null;
    const startPress = () => {
      pressTimer = setTimeout(() => this.enterEditMode(), 500);
    };
    const cancelPress = () => { clearTimeout(pressTimer); };

    iconElement.addEventListener('pointerdown', startPress);
    iconElement.addEventListener('pointerup', cancelPress);
    iconElement.addEventListener('pointerleave', cancelPress);

    iconElement.onclick = () => {
      if (this.editMode) {
        this.confirm(
          'Remove "' + appConfig.name + '"?',
          'This will delete the app and its saved data from this Web OS.',
          () => this.uninstall(appConfig.id)
        );
      } else {
        this.runApp(appConfig.id);
      }
    };

    return iconElement;
  },

  enterEditMode: function() {
    if (this.editMode) return;
    this.editMode = true;
    document.getElementById('editModeBar').classList.add('show');
    this.applyEditModeVisuals();
  },

  applyEditModeVisuals: function() {
    document.getElementById('homeScreen').classList.add('edit-mode');
    document.querySelectorAll('.app-icon:not(.no-uninstall)').forEach(el => el.classList.add('jiggle'));
  },

  exitEditMode: function() {
    this.editMode = false;
    document.getElementById('editModeBar').classList.remove('show');
    document.getElementById('homeScreen').classList.remove('edit-mode');
    document.querySelectorAll('.app-icon').forEach(el => el.classList.remove('jiggle'));
  },

  // ---------- App Switcher ----------
  pushRecent: function(id) {
    this.recentApps = this.recentApps.filter(x => x !== id);
    this.recentApps.unshift(id);
    if (this.recentApps.length > 8) this.recentApps.length = 8;
  },

  openAppSwitcher: function() {
    this.renderSwitcherCards();
    document.getElementById('appSwitcher').classList.add('open');
  },

  closeAppSwitcher: function() {
    document.getElementById('appSwitcher').classList.remove('open');
  },

  clearAllRecents: function() {
    this.recentApps = [];
    this.renderSwitcherCards();
  },

  renderSwitcherCards: function() {
    const container = document.getElementById('switcherCards');
    const emptyEl = document.getElementById('switcherEmpty');
    const validIds = this.recentApps.filter(id => this.registry[id]);

    container.innerHTML = '';
    emptyEl.style.display = validIds.length === 0 ? 'flex' : 'none';

    validIds.forEach(id => {
      const app = this.registry[id];
      const card = document.createElement('div');
      card.className = 'switcher-card';
      card.style.background = 'linear-gradient(160deg, ' + app.color + ', rgba(10,10,14,0.55))';
      card.innerHTML =
        '<button class="switcher-remove" title="Remove from recents">✕</button>' +
        '<div class="switcher-card-icon">' + app.icon + '</div>' +
        '<div class="switcher-card-name">' + app.name + '</div>';

      card.onclick = (e) => {
        if (e.target.closest('.switcher-remove')) return;
        this.closeAppSwitcher();
        this.runApp(id);
      };
      card.querySelector('.switcher-remove').onclick = (e) => {
        e.stopPropagation();
        this.recentApps = this.recentApps.filter(x => x !== id);
        this.renderSwitcherCards();
      };

      container.appendChild(card);
    });
  },

  // ---------- Run / close apps ----------
  runApp: function(id) {
    const app = this.registry[id];
    if (!app) return;

    this.pushRecent(id);

    document.getElementById('activeAppTitle').innerText = app.name;
    document.getElementById('activeAppContent').innerHTML = app.template;
    document.getElementById('appContainer').classList.remove('hidden');

    if (app.script) {
      try {
        const launchFunction = new Function(app.script);
        launchFunction();
      } catch (err) {
        console.error("Failed to run app script:", err);
        this.toast('This app hit an error while loading');
      }
    }
  },

  closeApp: function() {
    if (window.currentCameraStream) {
      window.currentCameraStream.getTracks().forEach(track => track.stop());
      window.currentCameraStream = null;
    }

    document.getElementById('appContainer').classList.add('hidden');
    setTimeout(() => {
      document.getElementById('activeAppContent').innerHTML = '';
    }, 300);
  }
};

// Start the OS when the page loads!
SystemOS.boot();
