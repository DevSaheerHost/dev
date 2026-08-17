/**
 * NEON DRIFT SURVIVAL — Client
 * Three.js rendering + Socket.io + Client-side interpolation/prediction
 * Modular, production-grade architecture
 */

/* ════════════════════════════════════════════════════════════
   MODULE: State
   ════════════════════════════════════════════════════════════ */
const State = {
  myId: null,
  myColor: 0x00ffff,
  myUsername: '',
  alive: true,
  spectating: false,
  gameActive: false,
  roundNumber: 1,
  aliveCount: 0,
};

/* ════════════════════════════════════════════════════════════
   MODULE: Renderer
   ════════════════════════════════════════════════════════════ */
const Renderer = (() => {
  let scene, camera, renderer, clock;
  let bloomTarget, composer;
  const TILE_SIZE = 4;
  const TILE_GAP = 0.2;
  const TILE_Y = 0;

  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);
    scene.fog = new THREE.FogExp2(0x050510, 0.018);

    camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 400);
    camera.position.set(0, 22, 28);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('gameCanvas'),
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    clock = new THREE.Clock();

    buildLighting();
    buildEnvironment();

    window.addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });
  }

  function buildLighting() {
    const ambient = new THREE.AmbientLight(0x111133, 0.8);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight(0x4488ff, 1.2);
    sun.position.set(20, 40, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -50;
    sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50;
    sun.shadow.camera.bottom = -50;
    sun.shadow.bias = -0.001;
    scene.add(sun);

    // Neon rim lights
    const rimCyan = new THREE.PointLight(0x00ffff, 2, 80);
    rimCyan.position.set(-30, 8, -30);
    scene.add(rimCyan);

    const rimMagenta = new THREE.PointLight(0xff00ff, 2, 80);
    rimMagenta.position.set(30, 8, 30);
    scene.add(rimMagenta);
  }

  function buildEnvironment() {
    // Stars
    const starsGeo = new THREE.BufferGeometry();
    const starCount = 2000;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * 500;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 300;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 500;
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starsMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, transparent: true, opacity: 0.6 });
    scene.add(new THREE.Points(starsGeo, starsMat));

    // Grid helper (decorative, below arena)
    const gridHelper = new THREE.GridHelper(100, 50, 0x001133, 0x001133);
    gridHelper.position.y = -12;
    scene.add(gridHelper);
  }

  function render(dt) {
    renderer.render(scene, camera);
  }

  return { init, scene, camera: () => camera, renderer: () => renderer, clock: () => clock, render };
})();

/* ════════════════════════════════════════════════════════════
   MODULE: TileManager
   ════════════════════════════════════════════════════════════ */
const TileManager = (() => {
  const tileObjects = new Map();
  const FALL_SPEED = 12;
  let shakeTiles = new Set();

  const TILE_COLORS = [0x003366, 0x002244, 0x001133];
  const EDGE_COLOR  = 0x00ffff;

  function buildTiles(tilesData) {
    // Clear existing
    for (const [id, obj] of tileObjects) {
      Renderer.scene.remove(obj.mesh);
      if (obj.edge) Renderer.scene.remove(obj.edge);
    }
    tileObjects.clear();
    shakeTiles.clear();

    for (const t of tilesData) {
      const geo = new THREE.BoxGeometry(3.8, 0.5, 3.8);
      const mat = new THREE.MeshStandardMaterial({
        color: TILE_COLORS[Math.floor(Math.random() * TILE_COLORS.length)],
        roughness: 0.3,
        metalness: 0.6,
        envMapIntensity: 1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(t.x, TILE_Y, t.z);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      Renderer.scene.add(mesh);

      // Edge glow
      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.4 });
      const edge = new THREE.LineSegments(edgeGeo, edgeMat);
      mesh.add(edge);

      tileObjects.set(t.id, {
        id: t.id,
        mesh,
        edge,
        state: 'solid',
        fallVelocity: 0,
        shakeTime: 0,
      });
    }
  }

  function shakeTile(id) {
    const obj = tileObjects.get(id);
    if (!obj) return;
    obj.state = 'shaking';
    obj.shakeTime = 0;
    obj.mesh.material.color.setHex(0xff4400);
    obj.edge.material.color.setHex(0xff6600);
    obj.edge.material.opacity = 0.8;
    shakeTiles.add(id);
  }

  function dropTile(id) {
    const obj = tileObjects.get(id);
    if (!obj) return;
    obj.state = 'falling';
    obj.fallVelocity = 0;
    shakeTiles.delete(id);
    obj.mesh.material.color.setHex(0x220000);
  }

  function update(dt) {
    for (const id of shakeTiles) {
      const obj = tileObjects.get(id);
      if (!obj) continue;
      obj.shakeTime += dt;
      const shakeAmt = Math.sin(obj.shakeTime * 40) * 0.06;
      obj.mesh.position.x += shakeAmt * 0.3;
      obj.mesh.position.z += shakeAmt * 0.3;
    }

    for (const [id, obj] of tileObjects) {
      if (obj.state === 'falling') {
        obj.fallVelocity += 18 * dt;
        obj.mesh.position.y -= obj.fallVelocity * dt;
        obj.mesh.rotation.x += dt * 0.5;
        obj.mesh.rotation.z += dt * 0.3;
        obj.mesh.material.opacity = Math.max(0, 1 - obj.mesh.position.y / -20);
        obj.mesh.material.transparent = true;

        if (obj.mesh.position.y < -25) {
          Renderer.scene.remove(obj.mesh);
          tileObjects.delete(id);
        }
      }
    }
  }

  function getTileCount() { return tileObjects.size; }

  return { buildTiles, shakeTile, dropTile, update, getTileCount };
})();

/* ════════════════════════════════════════════════════════════
   MODULE: PlayerManager
   ════════════════════════════════════════════════════════════ */
const PlayerManager = (() => {
  const players = new Map();  // id → { mesh, nameTag, trail, snapshots[], ... }
  const INTERP_DELAY = 100;   // ms interpolation buffer

  function hexToThree(hex) {
    return new THREE.Color(hex);
  }

  function createPlayerMesh(id, color, username) {
    const threeColor = new THREE.Color(color);

    const geo = new THREE.SphereGeometry(0.65, 16, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: threeColor,
      emissive: threeColor,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.8,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;

    // Inner glow ring
    const ringGeo = new THREE.TorusGeometry(0.85, 0.06, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: threeColor, transparent: true, opacity: 0.5 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    mesh.add(ring);

    // Point light attached to player
    const light = new THREE.PointLight(color, 1.5, 8);
    mesh.add(light);

    Renderer.scene.add(mesh);

    // Trail particles
    const trail = createTrail(color);

    const player = {
      id, username, color,
      mesh, ring, light, trail,
      snapshots: [],
      position: new THREE.Vector3(0, 3, 0),
      velocity: new THREE.Vector3(),
      isAlive: true,
      isSelf: id === State.myId,
    };

    if (id === State.myId) {
      // Brighter self glow
      mat.emissiveIntensity = 1.0;
      light.intensity = 3;
    }

    players.set(id, player);
    return player;
  }

  function createTrail(color) {
    const points = [];
    for (let i = 0; i < 20; i++) points.push(new THREE.Vector3());
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.3,
    });
    const line = new THREE.Line(geo, mat);
    Renderer.scene.add(line);
    return { line, points };
  }

  function addPlayer(data) {
    if (players.has(data.id)) return;
    const p = createPlayerMesh(data.id, data.color, data.username);
    p.position.set(data.x || 0, data.y || 3, data.z || 0);
    p.mesh.position.copy(p.position);
  }

  function removePlayer(id) {
    const p = players.get(id);
    if (!p) return;
    Renderer.scene.remove(p.mesh);
    if (p.trail) Renderer.scene.remove(p.trail.line);
    players.delete(id);
  }

  function eliminatePlayer(id) {
    const p = players.get(id);
    if (!p) return;
    p.isAlive = false;

    // Death explosion effect
    spawnDeathParticles(p.mesh.position, p.color);

    p.mesh.visible = false;
    if (p.trail) p.trail.line.visible = false;

    if (id === State.myId) {
      State.alive = false;
      State.spectating = true;
    }
  }

  function spawnDeathParticles(pos, color) {
    const count = 20;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 8,
        Math.random() * 6,
        (Math.random() - 0.5) * 8,
      ));
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.3, transparent: true });
    const particles = new THREE.Points(geo, mat);
    Renderer.scene.add(particles);

    let age = 0;
    const animate = () => {
      age += 0.016;
      const posArr = particles.geometry.attributes.position.array;
      for (let i = 0; i < count; i++) {
        velocities[i].y -= 9.8 * 0.016;
        posArr[i * 3]     += velocities[i].x * 0.016;
        posArr[i * 3 + 1] += velocities[i].y * 0.016;
        posArr[i * 3 + 2] += velocities[i].z * 0.016;
      }
      particles.geometry.attributes.position.needsUpdate = true;
      mat.opacity = Math.max(0, 1 - age / 1.5);
      if (age < 1.5) requestAnimationFrame(animate);
      else Renderer.scene.remove(particles);
    };
    animate();
  }

  function pushSnapshot(snapshot) {
    const now = Date.now();
    for (const entry of snapshot.p) {
      const [id, px, py, pz, vx, vy, vz, qx, qy, qz, qw] = entry;
      const player = players.get(id);
      if (!player) continue;

      player.snapshots.push({
        t: snapshot.t,
        pos: new THREE.Vector3(px, py, pz),
        vel: new THREE.Vector3(vx, vy, vz),
        quat: new THREE.Quaternion(qx, qy, qz, qw),
      });

      // Keep buffer trim
      while (player.snapshots.length > 20) player.snapshots.shift();
    }

    // Self: immediately apply (with prediction blending)
    const self = players.get(State.myId);
    if (self) {
      const entry = snapshot.p.find(e => e[0] === State.myId);
      if (entry) {
        // Blend server pos with predicted
        const serverPos = new THREE.Vector3(entry[1], entry[2], entry[3]);
        const err = serverPos.distanceTo(self.mesh.position);
        if (err > 2) {
          self.mesh.position.copy(serverPos);
        } else if (err > 0.2) {
          self.mesh.position.lerp(serverPos, 0.3);
        }
      }
    }
  }

  function update(dt) {
    const renderTime = Date.now() - INTERP_DELAY;

    for (const [id, player] of players) {
      if (!player.isAlive) continue;

      if (id === State.myId) {
        // Self: local prediction handled by Input module
        // Just animate ring
        player.ring.rotation.z += dt * 2;
        updateTrail(player);
        continue;
      }

      // Interpolate remote players
      const snaps = player.snapshots;
      if (snaps.length < 2) {
        if (snaps.length === 1) {
          player.mesh.position.lerp(snaps[0].pos, 0.15);
        }
        continue;
      }

      // Find the two surrounding snapshots
      let before = null, after = null;
      for (let i = 0; i < snaps.length - 1; i++) {
        if (snaps[i].t <= renderTime && snaps[i + 1].t >= renderTime) {
          before = snaps[i];
          after  = snaps[i + 1];
          break;
        }
      }

      if (before && after) {
        const t = (renderTime - before.t) / (after.t - before.t);
        player.mesh.position.lerpVectors(before.pos, after.pos, Math.max(0, Math.min(1, t)));
        player.mesh.quaternion.slerpQuaternions(before.quat, after.quat, t);
      } else {
        // Extrapolate from latest
        const latest = snaps[snaps.length - 1];
        const age = (Date.now() - latest.t) / 1000;
        const extrapolated = latest.pos.clone().addScaledVector(latest.vel, Math.min(age, 0.1));
        player.mesh.position.lerp(extrapolated, 0.25);
      }

      player.ring.rotation.z += dt * 2;
      updateTrail(player);
    }
  }

  function updateTrail(player) {
    const trail = player.trail;
    if (!trail) return;
    trail.points.push(player.mesh.position.clone());
    if (trail.points.length > 20) trail.points.shift();
    trail.line.geometry.setFromPoints(trail.points);
    trail.line.geometry.attributes.position.needsUpdate = true;
  }

  function getAliveCount() {
    return [...players.values()].filter(p => p.isAlive).length;
  }

  function getSelf() { return players.get(State.myId); }

  function getAll() { return players; }

  return { addPlayer, removePlayer, eliminatePlayer, pushSnapshot, update, getAliveCount, getSelf, getAll, createPlayerMesh };
})();

/* ════════════════════════════════════════════════════════════
   MODULE: Camera
   ════════════════════════════════════════════════════════════ */
const CameraController = (() => {
  let shakeIntensity = 0;
  let shakeDecay = 0.9;
  let targetPos = new THREE.Vector3(0, 22, 28);
  let followOffset = new THREE.Vector3(0, 14, 18);
  let specTarget = null;

  function shake(intensity = 0.5) {
    shakeIntensity = Math.min(shakeIntensity + intensity, 1.5);
  }

  function update(dt) {
    const cam = Renderer.camera();
    const self = PlayerManager.getSelf();

    if (self && self.isAlive) {
      // Follow camera
      const desiredPos = self.mesh.position.clone().add(followOffset);
      cam.position.lerp(desiredPos, 5 * dt);
      const lookAt = self.mesh.position.clone();
      lookAt.y += 1;
      cam.lookAt(lookAt);
    } else if (State.spectating) {
      // Orbit camera
      const t = Date.now() / 6000;
      cam.position.set(
        Math.sin(t) * 35,
        22,
        Math.cos(t) * 35,
      );
      cam.lookAt(0, 2, 0);
    }

    // Camera shake
    if (shakeIntensity > 0.01) {
      cam.position.x += (Math.random() - 0.5) * shakeIntensity * 0.4;
      cam.position.y += (Math.random() - 0.5) * shakeIntensity * 0.2;
      shakeIntensity *= shakeDecay;
    } else {
      shakeIntensity = 0;
    }
  }

  return { shake, update };
})();

/* ════════════════════════════════════════════════════════════
   MODULE: Input
   ════════════════════════════════════════════════════════════ */
const Input = (() => {
  const keys = {};
  let joystick = { x: 0, y: 0, active: false, touchId: null };
  let jumpQueued = false;
  let lastSend = 0;
  const SEND_RATE = 50; // ms (20Hz)

  // Self-prediction state
  let predPos = new THREE.Vector3();
  let predVel = new THREE.Vector3();

  function init() {
    window.addEventListener('keydown', e => {
      keys[e.code] = true;
      if (e.code === 'Space') { jumpQueued = true; e.preventDefault(); }
    });
    window.addEventListener('keyup',  e => { keys[e.code] = false; });

    setupJoystick();
    setupJumpBtn();
  }

  function setupJoystick() {
    const zone   = document.getElementById('joystickZone');
    const handle = document.getElementById('joystickHandle');
    const BASE_RADIUS = 55;

    const getCenter = () => {
      const r = zone.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };

    const setHandle = (dx, dy) => {
      const dist = Math.sqrt(dx*dx + dy*dy);
      const clamped = Math.min(dist, BASE_RADIUS);
      const angle = Math.atan2(dy, dx);
      const hx = Math.cos(angle) * clamped;
      const hy = Math.sin(angle) * clamped;
      handle.style.transform = `translate(calc(-50% + ${hx}px), calc(-50% + ${hy}px))`;
      joystick.x = hx / BASE_RADIUS;
      joystick.y = hy / BASE_RADIUS;
    };

    zone.addEventListener('touchstart', e => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      joystick.active = true;
      joystick.touchId = touch.identifier;
      const c = getCenter();
      setHandle(touch.clientX - c.x, touch.clientY - c.y);
    }, { passive: false });

    window.addEventListener('touchmove', e => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === joystick.touchId) {
          const c = getCenter();
          setHandle(touch.clientX - c.x, touch.clientY - c.y);
        }
      }
    }, { passive: false });

    window.addEventListener('touchend', e => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === joystick.touchId) {
          joystick = { x: 0, y: 0, active: false, touchId: null };
          handle.style.transform = 'translate(-50%, -50%)';
        }
      }
    });
  }

  function setupJumpBtn() {
    const btn = document.getElementById('jumpBtn');
    btn.addEventListener('touchstart', e => { e.preventDefault(); jumpQueued = true; }, { passive: false });
  }

  function sendInput(socket) {
    if (!State.alive || !State.gameActive) return;
    const now = Date.now();
    if (now - lastSend < SEND_RATE) return;
    lastSend = now;

    const forward = getForward();
    const right   = getRight();
    const jump    = jumpQueued;
    if (jump) jumpQueued = false;

    socket.emit('input', { f: forward, r: right, j: jump ? 1 : 0 });

    // Client-side prediction
    const self = PlayerManager.getSelf();
    if (self) {
      const MOVE_F = 0.12;
      self.mesh.position.x += right * MOVE_F;
      self.mesh.position.z -= forward * MOVE_F;
      if (jump && self.mesh.position.y < 2.5) {
        predVel.y = 6;
      }
    }
  }

  function getForward() {
    if (joystick.active) return -joystick.y;
    return (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
  }

  function getRight() {
    if (joystick.active) return joystick.x;
    return (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
  }

  return { init, sendInput };
})();

/* ════════════════════════════════════════════════════════════
   MODULE: Minimap
   ════════════════════════════════════════════════════════════ */
const Minimap = (() => {
  const canvas = document.getElementById('minimap');
  const ctx = canvas.getContext('2d');
  const SIZE = 120;
  const WORLD = 25;

  function update() {
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Tiles
    ctx.fillStyle = 'rgba(0, 80, 160, 0.5)';
    for (const [id, obj] of TileManager._tileObjects || new Map()) {
      // Fallback: draw grid
    }

    // Draw simple grid
    ctx.strokeStyle = 'rgba(0,100,200,0.3)';
    ctx.lineWidth = 0.5;
    const step = SIZE / 10;
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * step);
      ctx.lineTo(SIZE, i * step);
      ctx.stroke();
    }

    // Players
    for (const [id, player] of PlayerManager.getAll()) {
      if (!player.isAlive) continue;
      const mx = (player.mesh.position.x / WORLD + 0.5) * SIZE;
      const my = (player.mesh.position.z / WORLD + 0.5) * SIZE;

      const threeColor = new THREE.Color(player.color);
      const hex = '#' + threeColor.getHexString();

      ctx.beginPath();
      ctx.arc(mx, my, id === State.myId ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = hex;
      ctx.fill();

      if (id === State.myId) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  return { update };
})();

/* ════════════════════════════════════════════════════════════
   MODULE: HUD
   ════════════════════════════════════════════════════════════ */
const HUD = {
  show() {
    document.getElementById('gameHUD').classList.remove('hidden');
    document.getElementById('selfIndicator').classList.remove('hidden');
    document.getElementById('selfName').textContent = State.myUsername.toUpperCase();
    const mc = document.getElementById('mobileControls');
    if (isMobile()) {
      mc.classList.remove('hidden');
      mc.classList.add('active');
    }
  },

  hide() {
    document.getElementById('gameHUD').classList.add('hidden');
  },

  updateAlive(count) {
    document.getElementById('aliveNum').textContent = count;
    State.aliveCount = count;
  },

  updatePing(ms) {
    document.getElementById('pingNum').textContent = ms;
  },

  showStatus(text) {
    const banner = document.getElementById('statusBanner');
    const el = document.getElementById('statusText');
    el.textContent = text;
    banner.classList.remove('hidden');
  },

  hideStatus() {
    document.getElementById('statusBanner').classList.add('hidden');
  },

  addKillFeedEntry(username, rank) {
    const feed = document.getElementById('killFeed');
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerHTML = `<span class="kf-name">${escapeHtml(username)}</span> <span class="kf-action">fell off — </span><span class="kf-rank">#${rank}</span>`;
    feed.appendChild(entry);
    if (feed.children.length > 5) feed.removeChild(feed.firstChild);
    setTimeout(() => { if (entry.parentNode) feed.removeChild(entry); }, 3500);
  },

  showEliminated(rank) {
    const el = document.getElementById('eliminatedScreen');
    el.classList.remove('hidden');
    document.getElementById('elimRank').textContent = `#${rank}`;
  },

  hideEliminated() {
    document.getElementById('eliminatedScreen').classList.add('hidden');
  },

  showCountdown(num, label = 'GET READY') {
    const overlay = document.getElementById('countdownOverlay');
    const numEl = document.getElementById('countdownNum');
    const labelEl = document.getElementById('countdownLabel');

    numEl.textContent = num;
    labelEl.textContent = label;
    overlay.classList.remove('hidden');

    // Re-trigger animation
    numEl.style.animation = 'none';
    numEl.offsetHeight; // reflow
    numEl.style.animation = 'countPop 0.5s cubic-bezier(0.175,0.885,0.32,1.275) forwards';

    setTimeout(() => overlay.classList.add('hidden'), 900);
  },

  showRoundEnd(data) {
    document.getElementById('roundEndScreen').classList.remove('hidden');
    const winnerName = document.getElementById('winnerName');
    winnerName.textContent = data.winner ? data.winner.username.toUpperCase() : 'NO ONE';
    if (data.winner) {
      const c = new THREE.Color(data.winner.color);
      winnerName.style.color = `#${c.getHexString()}`;
      winnerName.style.textShadow = `0 0 30px #${c.getHexString()}`;
    }

    const list = document.getElementById('leaderboardList');
    list.innerHTML = '';
    for (const entry of data.leaderboard.slice(0, 10)) {
      const row = document.createElement('div');
      row.className = 'lb-row' + (entry.id === State.myId ? ' is-self' : '');
      const c = new THREE.Color(entry.color);
      const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : '';
      row.innerHTML = `
        <span class="lb-rank ${rankClass}">#${entry.rank}</span>
        <span class="lb-color-dot" style="background:#${c.getHexString()};color:#${c.getHexString()}"></span>
        <span class="lb-username">${escapeHtml(entry.username)}${entry.id === State.myId ? ' <span style="color:rgba(0,255,255,0.5);font-size:0.65rem">(YOU)</span>' : ''}</span>
        <span class="lb-kills">${entry.kills} KO</span>
      `;
      list.appendChild(row);
    }

    // Countdown timer
    let t = 8;
    const timerEl = document.getElementById('nextRoundTimer');
    timerEl.textContent = t;
    const interval = setInterval(() => {
      t--;
      timerEl.textContent = t;
      if (t <= 0) clearInterval(interval);
    }, 1000);
  },

  hideRoundEnd() {
    document.getElementById('roundEndScreen').classList.add('hidden');
  },
};

/* ════════════════════════════════════════════════════════════
   MODULE: Socket
   ════════════════════════════════════════════════════════════ */
const Network = (() => {
  let socket = null;

  function connect(username) {
    socket = io({ transports: ['websocket'] });

    socket.on('connect', () => {
      socket.emit('join', { username });
    });

    socket.on('ping', () => socket.emit('pong_client'));

    socket.on('joined', (data) => {
      State.myId = data.id;
      State.myColor = data.color;
      State.myUsername = data.username;
      State.roundNumber = data.round;

      HUD.show();
      HUD.showStatus(`ROUND ${data.round}`);

      TileManager.buildTiles(data.tiles);
      for (const p of data.players) {
        PlayerManager.addPlayer(p);
      }

      // Create self if not in list
      if (!PlayerManager.getSelf()) {
        PlayerManager.addPlayer({
          id: data.id,
          color: data.color,
          username: data.username,
          x: 0, y: 3, z: 0,
        });
      }

      State.gameActive = true;
      State.alive = true;

      if (data.state === 'playing') {
        HUD.showCountdown('GO!', 'ARENA ACTIVE');
      }
    });

    socket.on('playerJoined', (data) => {
      PlayerManager.addPlayer(data);
      HUD.updateAlive(PlayerManager.getAliveCount());
    });

    socket.on('playerLeft', ({ id }) => {
      PlayerManager.removePlayer(id);
      HUD.updateAlive(PlayerManager.getAliveCount());
    });

    socket.on('gameStart', (data) => {
      State.gameActive = true;
      State.alive = true;
      State.spectating = false;
      TileManager.buildTiles(data.tiles);
      HUD.hideEliminated();
      HUD.hideRoundEnd();

      let cd = 3;
      const countDown = () => {
        HUD.showCountdown(cd);
        if (cd > 1) { cd--; setTimeout(countDown, 1000); }
        else setTimeout(() => HUD.showCountdown('GO!', 'SURVIVE'), 1000);
      };
      countDown();
    });

    socket.on('snapshot', (snapshot) => {
      PlayerManager.pushSnapshot(snapshot);
      HUD.updateAlive(PlayerManager.getAliveCount());
    });

    socket.on('tileShake', ({ id }) => TileManager.shakeTile(id));
    socket.on('tileFall',  ({ id }) => {
      TileManager.dropTile(id);
      CameraController.shake(0.2);
    });

    socket.on('playerEliminated', (data) => {
      PlayerManager.eliminatePlayer(data.id);
      HUD.addKillFeedEntry(data.username, data.rank);
      CameraController.shake(0.4);

      if (data.id === State.myId) {
        HUD.showEliminated(data.rank);
      }
    });

    socket.on('roundEnd', (data) => {
      State.gameActive = false;
      HUD.showRoundEnd(data);
      setTimeout(() => HUD.hideEliminated(), 500);
    });

    socket.on('roundRestart', (data) => {
      State.roundNumber = data.round;
      State.alive = true;
      State.spectating = false;
      State.gameActive = false;

      // Rebuild
      TileManager.buildTiles(data.tiles);
      // Re-add players
      for (const id of PlayerManager.getAll().keys()) {
        PlayerManager.removePlayer(id);
      }
      for (const p of data.players) {
        PlayerManager.addPlayer(p);
      }

      HUD.hideRoundEnd();
      HUD.showStatus(`ROUND ${data.round}`);
    });

    socket.on('error', (data) => {
      console.error('Server error:', data.msg);
    });

    return socket;
  }

  function getSocket() { return socket; }

  return { connect, getSocket };
})();

/* ════════════════════════════════════════════════════════════
   MODULE: Loading
   ════════════════════════════════════════════════════════════ */
function runLoader(onComplete) {
  const bar = document.getElementById('loaderBar');
  const text = document.getElementById('loaderText');
  const steps = [
    [20, 'LOADING THREE.JS ENGINE...'],
    [45, 'BUILDING NEON ARENA...'],
    [65, 'CALIBRATING PHYSICS...'],
    [80, 'CONNECTING TO SERVER...'],
    [100, 'READY'],
  ];
  let i = 0;
  const run = () => {
    if (i >= steps.length) {
      setTimeout(onComplete, 400);
      return;
    }
    bar.style.width = steps[i][0] + '%';
    text.textContent = steps[i][1];
    i++;
    setTimeout(run, 350 + Math.random() * 200);
  };
  run();
}

/* ════════════════════════════════════════════════════════════
   MAIN GAME LOOP
   ════════════════════════════════════════════════════════════ */
function startGameLoop() {
  const clock = Renderer.clock();
  let lastPingCheck = 0;

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);

    TileManager.update(dt);
    PlayerManager.update(dt);
    CameraController.update(dt);
    Minimap.update();

    const socket = Network.getSocket();
    if (socket) {
      Input.sendInput(socket);

      // Update ping display
      if (Date.now() - lastPingCheck > 3000) {
        lastPingCheck = Date.now();
      }
    }

    Renderer.render(dt);
  }

  loop();
}

/* ════════════════════════════════════════════════════════════
   BOOTSTRAP
   ════════════════════════════════════════════════════════════ */
function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || window.innerWidth < 768;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function hideAllScreens() {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
}

document.addEventListener('DOMContentLoaded', () => {
  showScreen('loadingScreen');
  Renderer.init();
  Input.init();
  startGameLoop();

  runLoader(() => {
    showScreen('menuScreen');

    const playBtn = document.getElementById('playBtn');
    const usernameInput = document.getElementById('usernameInput');

    // Randomize placeholder names
    const names = ['PHONK_RIDER', 'NEON_GHOST', 'DRIFT_LORD', 'VOID_RACER', 'SYNTH_WOLF', 'CYBER_SHARK'];
    usernameInput.placeholder = names[Math.floor(Math.random() * names.length)];

    const enterGame = () => {
      const username = usernameInput.value.trim() || usernameInput.placeholder;
      State.myUsername = username;
      hideAllScreens();
      Network.connect(username);
    };

    playBtn.addEventListener('click', enterGame);
    usernameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') enterGame();
    });
  });
});
