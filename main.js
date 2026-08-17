    /* =========================================================
       PROJECT LIST — add / edit / remove entries here only.
       status: "live" | "soon"
       ========================================================= */
    const baseUrl = "https://saheerlab.vercel.app";

    const projects = [
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
        tags: ["Web OS", "Coding"],
        status: "live",
        color: "#A77CF2",
        icon: "phone"
      },
      {
        title: "Audio Visualizer",
        description: "A futuristic audio visualizer with neon effects, real-time spectrum bars, and immersive music controls.",
        url: "./audio-visualizer/",
        tags: ["Visualization", "Audio"],
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
      spark: '<path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"></path>',
      meter: '<polyline points="2 13 6 13 8 7 11 19 13 13 15 13 16 10 18 13 22 13"></polyline>',
      monitor: '<rect x="2" y="4" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>',
      phone: '<rect x="6" y="2" width="12" height="20" rx="2"></rect><line x1="10" y1="18" x2="14" y2="18"></line>',
      waveform: '<line x1="4" y1="10" x2="4" y2="14"></line><line x1="8" y1="6" x2="8" y2="18"></line><line x1="12" y1="3" x2="12" y2="21"></line><line x1="16" y1="6" x2="16" y2="18"></line><line x1="20" y1="10" x2="20" y2="14"></line>',
      gamepad: '<line x1="6" y1="12" x2="10" y2="12"></line><line x1="8" y1="10" x2="8" y2="14"></line><circle cx="15" cy="13" r="1"></circle><circle cx="18" cy="11" r="1"></circle><path d="M17 6H7a4 4 0 0 0-4 4v4a4 4 0 0 0 4 4l1.5-2h7L17 18a4 4 0 0 0 4-4v-4a4 4 0 0 0-4-4z"></path>'
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