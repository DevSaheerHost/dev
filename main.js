    /* =========================================================
       PROJECT LIST — add / edit / remove entries here only.
       status: "live" | "soon"
       ========================================================= */
    const baseUrl = "https://saheerlab.vercel.app";

    const projects = [
      {
        title: "Keyscope",
        description: "Keyboard test. Press any key and watch it light up, see exactly what the browser reports, and find the switch that stopped working.",
        url: "./keyboard-test/",
        tags: ["Utility", "Hardware", "Offline"],
        status: "live",
        color: "#6C4CF1",
        icon: "keyboard"
      },
      {
        title: "Explorer File Server",
        description: "Release hub for the Explorer file server. Browse versions, read release notes and download build assets.",
        url: "./explorer-file-server/",
        tags: ["Downloads", "Releases"],
        status: "live",
        color: "#9BA7B4",
        icon: "server"
      },
      {
        title: "Food Money",
        description: "Daily payment tracker with a monthly calendar. Mark what you paid, see what is still expected and keep the month balanced.",
        url: "./food-money/",
        tags: ["Tracker", "Offline"],
        status: "live",
        color: "#3FBF7F",
        icon: "wallet"
      },
      {
        title: "Nightfall",
        description: "A 3D open world you can walk through, with a home, streetlights and dogs that come out after dark. Built with Three.js.",
        url: "./open_world_game/",
        tags: ["3D", "Game", "Three.js"],
        status: "live",
        color: "#F2762E",
        icon: "world"
      },
      {
        title: "TransferBox",
        description: "Move large text, images, videos and files between any two browsers. No accounts, QR and direct browser-to-browser transfer, encrypted private workspaces.",
        url: "./transferbox/",
        tags: ["Transfer", "PWA", "QR"],
        status: "live",
        color: "#2456E6",
        icon: "transfer"
      },
      {
        title: "Quotient",
        description: "Freelance pricing studio. Describe a project and get a defensible price range, the reasoning behind it, an hourly equivalent and a quotation you can export.",
        url: "./freelance-rate-calculator/",
        tags: ["Freelance", "Pricing", "Export"],
        status: "live",
        color: "#0C6B66",
        icon: "tag"
      },
      {
        title: "Uno Meter",
        description: "Speed up your work with an Arduino multimeter. Voltage measurement, boot sequence and more.",
        url: `${baseUrl}/uno-multymeter/`,
        tags: ["Electronic", "Oscilloscope"],
        status: "live",
        color: "#7C97F2",
        icon: "meter"
      },
      {
        title: "Inverter Wiring",
        description: "Interactive 3D viewer for inverter wiring layout with AR support, exposure controls and a live wiring legend.",
        url: `${baseUrl}/inverter-wiring/`,
        tags: ["3D", "model-viewer", "AR"],
        status: "live",
        color: "#4da3ff",
        icon: "cube"
      },
      {
        title: "QR Studio",
        description: "Generate custom QR codes from any URL with logo overlay, design presets and PNG / SVG / JPG export.",
        url: "./qr-generator/",
        tags: ["Utility", "Export"],
        status: "live",
        color: "#7cf29c",
        icon: "qr"
      },
      {
        title: "Stock OS",
        description: "A sleek Web OS with essential apps, colorful icons, and a simple, modern interface.",
        url: "./stock-os/v2/",
        tags: ["Web OS", "Coding", "Offline"],
        status: "live",
        color: "#A77CF2",
        icon: "phone"
      },
      {
        title: "Audio Visualizer",
        description: "A futuristic audio visualizer with neon effects, real-time spectrum bars, and immersive music controls.",
        url: "./audio-visualizer/",
        tags: ["Visualization", "Audio", "Offline"],
        status: "live",
        color: "#ff1a4e",
        icon: "waveform"
      },
      
      
      {
        title: "Neon Drift Survival",
        description: "A fast-paced 3D multiplayer physics knockout arena for up to 30 players.Built with Three.js · Cannon-es · Node.js · Socket.io",
        url: "./nodejs-game/",
        tags: ["Nodejs", "Game"],
        status: "live",
        color: "#00ffff",
        icon: "gamepad"
      },
      {
        title: "QR File transfer",
        description: "An air-gapped file transfer app using QR codes, enabling secure offline file sharing without a network.",
        url: "./qr-file-transfer/",
        tags: ["Offline", "QR"],
        status: "live",
        color: "#ff6fb0",
        icon: "transfer"
      },
      {
        title: "CellZone Spare Management",
        description: "Spare parts inventory for a phone repair counter. Search stock by brand, model and part. Early build.",
        url: "./cellzone/spare-managment/",
        tags: ["Inventory", "Shop"],
        status: "soon",
        color: "#F2CB05",
        icon: "inventory"
      }
      // ---- add future projects below, same shape ----
      // {
      //   title: "New Project",
      //   description: "Short description of what it does.",
      //   url: "./new-project/index.html",
      //   tags: ["Tag1", "Tag2"],
      //   status: "soon",
      //   color: "#f5a623",
      //   icon: "spark"
      // },
    ];

    const icons = {
      cube: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
      qr: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><line x1="17" y1="17" x2="17" y2="17.01"></line><line x1="14" y1="14" x2="14" y2="14.01"></line><line x1="21" y1="14" x2="21" y2="14.01"></line><line x1="14" y1="21" x2="14" y2="21.01"></line><line x1="21" y1="21" x2="21" y2="21.01"></line>',
      tag: '<path d="M20.6 13.4 12 22l-9-9V4a1 1 0 0 1 1-1h8.99l8.61 8.6a2 2 0 0 1 0 2.8z"></path><circle cx="7.5" cy="7.5" r="1.2"></circle>',
      keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M9.5 13.5h.01M13 13.5h.01M16.5 13.5h.01M8.5 16.5h7"></path>',
      world: '<circle cx="12" cy="12" r="9"></circle><path d="M3.6 9h16.8M3.6 15h16.8"></path><path d="M12 3a14 14 0 0 0 0 18 14 14 0 0 0 0-18z"></path>',
      wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a1 1 0 0 1 1 1v2"></path><rect x="3" y="7.5" width="18" height="12" rx="2"></rect><circle cx="16.5" cy="13.5" r="1.2"></circle>',
      server: '<rect x="3" y="4" width="18" height="7" rx="2"></rect><rect x="3" y="13" width="18" height="7" rx="2"></rect><line x1="7" y1="7.5" x2="7.01" y2="7.5"></line><line x1="7" y1="16.5" x2="7.01" y2="16.5"></line>',
      inventory: '<path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5z"></path><path d="M3 12.5 12 17l9-4.5"></path><path d="M3 16.5 12 21l9-4.5"></path>',
      spark: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"></path>',
      meter: '<polyline points="2 13 6 13 8 7 11 19 13 13 15 13 16 10 18 13 22 13"></polyline>',
      monitor: '<rect x="2" y="4" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>',
      phone: '<rect x="6" y="2" width="12" height="20" rx="2"></rect><line x1="10" y1="18" x2="14" y2="18"></line>',
      waveform: '<line x1="4" y1="10" x2="4" y2="14"></line><line x1="8" y1="6" x2="8" y2="18"></line><line x1="12" y1="3" x2="12" y2="21"></line><line x1="16" y1="6" x2="16" y2="18"></line><line x1="20" y1="10" x2="20" y2="14"></line>',
      gamepad: '<line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><circle cx="15" cy="13" r="1"></circle><circle cx="18" cy="11" r="1"></circle><path d="M17 6H7a4 4 0 0 0-4 4v4a4 4 0 0 0 4 4l1.5-2h7L17 18a4 4 0 0 0 4-4v-4a4 4 0 0 0-4-4z"></path>',
      transfer: '<polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path>',
      qrTransfer: '<rect x="3" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><line x1="4.5" y1="4.5" x2="4.5" y2="4.5"></line><line x1="4.5" y1="15.5" x2="4.5" y2="15.5"></line><path d="M14 4h7v7h-7z" opacity="0"></path><line x1="14" y1="4" x2="14" y2="10"></line><line x1="18" y1="4" x2="18" y2="10"></line><path d="M14 16h4l3-3"></path><path d="M14 20h4l3-3"></path>'
    };

    const arrowIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>';

    const grid = document.getElementById('grid');
    const emptyState = document.getElementById('emptyState');
    const countPill = document.getElementById('countPill');
    const searchInput = document.getElementById('searchInput');
    const tagFiltersEl = document.getElementById('tagFilters');

    let activeTag = 'All';

    function allTags() {
      const set = new Set();
      projects.forEach(p => p.tags.forEach(t => set.add(t)));
      return ['All', ...Array.from(set)];
    }

    function renderTags() {
      tagFiltersEl.innerHTML = allTags().map(tag => `
        <div class="tag-chip ${tag === activeTag ? 'active' : ''}" data-tag="${tag}">${tag}</div>
      `).join('');

      tagFiltersEl.querySelectorAll('.tag-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          activeTag = chip.dataset.tag;
          renderTags();
          renderGrid();
        });
      });
    }

    function renderGrid() {
      const query = searchInput.value.trim().toLowerCase();

      const filtered = projects.filter(p => {
        const matchesTag = activeTag === 'All' || p.tags.includes(activeTag);
        const matchesQuery = !query ||
          p.title.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.tags.some(t => t.toLowerCase().includes(query));
        return matchesTag && matchesQuery;
      });

      countPill.textContent = `${projects.length} project${projects.length === 1 ? '' : 's'}`;

      if (filtered.length === 0) {
        grid.innerHTML = '';
        emptyState.classList.add('show');
        return;
      }
      emptyState.classList.remove('show');

      grid.innerHTML = filtered.map(p => {
        const isSoon = p.status === 'soon';
        const tag = isSoon ? 'div' : 'a';
        const hrefAttr = isSoon ? '' : `href="${p.url}"`;

        return `
          <${tag} class="card ${isSoon ? 'disabled' : ''}" ${hrefAttr}>
            <div class="card-top">
              <div class="card-icon" style="background:${p.color}">
                <svg viewBox="0 0 24 24" fill="none" stroke="#0a1120" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  ${icons[p.icon] || icons.spark}
                </svg>
              </div>
              <div class="status-dot ${isSoon ? 'soon' : ''}">
                <i></i> ${isSoon ? 'Coming soon' : 'Live'}
              </div>
            </div>
            <h3>${p.title}</h3>
            <p>${p.description}</p>
            <div class="card-tags">
              ${p.tags.map(t => `<span>${t}</span>`).join('')}
            </div>
            <div class="card-footer">
              <span>${isSoon ? 'In progress' : 'Open project'}</span>
              ${isSoon ? '' : arrowIcon}
            </div>
          </${tag}>
        `;
      }).join('');
    }

    searchInput.addEventListener('input', renderGrid);
    document.getElementById('year').textContent = new Date().getFullYear();

    renderTags();
    renderGrid();