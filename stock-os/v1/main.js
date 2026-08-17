// core.js
const SystemOS = {
  registry: {},

  Storage: {
    save: function(appId, data) {
      localStorage.setItem('os_data_' + appId, JSON.stringify(data));
    },
    load: function(appId) {
      const data = localStorage.getItem('os_data_' + appId);
      return data ? JSON.parse(data) : null;
    }
  },

  // NEW: Boot up the OS and load installed apps from storage
  boot: function() {
    // 1. Check and apply saved theme first
    if (localStorage.getItem('os_theme') === 'dark') {
      document.body.classList.add('dark-mode');
    }

    // 2. Load apps from registry
    const savedRegistry = localStorage.getItem('os_system_registry');
    if (savedRegistry) {
      this.registry = JSON.parse(savedRegistry);
      
      for (let appId in this.registry) {
        this.renderIcon(this.registry[appId]);
      }
      console.log("[OS] System booted. Apps loaded from storage.");
    }
  },


  install: function(appConfig) {
    // 1. Save to system registry
    this.registry[appConfig.id] = appConfig;

    // 2. NEW: Save the entire registry to localStorage so it survives refresh
    localStorage.setItem('os_system_registry', JSON.stringify(this.registry));

    // 3. Add icon to home screen
    this.renderIcon(appConfig);
  },

  renderIcon: function(appConfig) {
    const iconElement = document.createElement('div');
    iconElement.className = 'app-icon';
    iconElement.onclick = () => this.runApp(appConfig.id);
    
    iconElement.innerHTML = `
      <div class="icon-box" style="background: ${appConfig.color};">${appConfig.icon}</div>
      <span style="font-size: 12px; margin-top: 5px;">${appConfig.name}</span>
    `;

    document.getElementById('homeScreen').appendChild(iconElement);
  },

  runApp: function(id) {
    const app = this.registry[id];
    if (!app) return;

    document.getElementById('activeAppTitle').innerText = app.name;
    document.getElementById('activeAppContent').innerHTML = app.template;
    document.getElementById('appContainer').classList.remove('hidden');

    // NEW: Convert the saved script string back into a real function and run it
    if (app.script) {
      try {
        const launchFunction = new Function(app.script);
        launchFunction();
      } catch (err) {
        console.error("Failed to run app script:", err);
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
