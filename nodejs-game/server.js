/**
 * NEON DRIFT SURVIVAL — Server
 * Node.js + Socket.io + Cannon-es physics
 * Handles: game rooms, physics simulation, tile collapse, authoritative state
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const CANNON = require('cannon-es');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingInterval: 2000,
  pingTimeout: 5000,
  transports: ['websocket']
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Constants ────────────────────────────────────────────────────────────────
const TICK_RATE        = 20;           // physics ticks per second
const TICK_MS          = 1000 / TICK_RATE;
const MAX_PLAYERS      = 30;
const ARENA_GRID       = 10;           // 10x10 tile grid
const TILE_SIZE        = 4;
const TILE_GAP         = 0.2;
const TILE_Y           = 0;
const SPHERE_RADIUS    = 0.65;
const RESPAWN_HEIGHT   = 3;
const FALL_THRESHOLD   = -8;           // y below which player is eliminated
const TILE_FALL_START  = 8000;         // ms before first tile drops
const TILE_FALL_INTERVAL_START = 3500;
const TILE_FALL_INTERVAL_MIN   = 600;
const MOVE_FORCE       = 280;
const MAX_VELOCITY     = 14;
const JUMP_IMPULSE     = 6;
const PLAYER_MASS      = 2;

// ─── Color palette ────────────────────────────────────────────────────────────
const NEON_COLORS = [
  0x00ffff, 0xff00ff, 0x39ff14, 0xff6600,
  0xffff00, 0x0080ff, 0xff0040, 0x00ff80,
  0xff4080, 0x80ff00, 0x4000ff, 0xff8000,
];

// ─── Game Rooms ───────────────────────────────────────────────────────────────
const rooms = new Map();

function createRoom(roomId) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 6;

  const tiles = buildArena(world);

  return {
    id: roomId,
    world,
    tiles,
    players: new Map(),
    state: 'waiting',   // waiting | countdown | playing | ended
    countdown: 5,
    startTime: null,
    tileFallInterval: TILE_FALL_INTERVAL_START,
    tileFallTimer: null,
    tickTimer: null,
    lastTick: Date.now(),
    roundNumber: 1,
  };
}

function buildArena(world) {
  const tiles = [];
  const offset = ((ARENA_GRID - 1) * (TILE_SIZE + TILE_GAP)) / 2;

  // Ground material
  const groundMat = new CANNON.Material('ground');
  const sphereMat = new CANNON.Material('sphere');
  const contactMat = new CANNON.ContactMaterial(groundMat, sphereMat, {
    friction: 0.3,
    restitution: 0.25,
  });
  world.addContactMaterial(contactMat);
  world._groundMat = groundMat;
  world._sphereMat = sphereMat;

  for (let row = 0; row < ARENA_GRID; row++) {
    for (let col = 0; col < ARENA_GRID; col++) {
      const x = col * (TILE_SIZE + TILE_GAP) - offset;
      const z = row * (TILE_SIZE + TILE_GAP) - offset;

      const shape = new CANNON.Box(new CANNON.Vec3(TILE_SIZE / 2, 0.25, TILE_SIZE / 2));
      const body = new CANNON.Body({ mass: 0, material: groundMat });
      body.addShape(shape);
      body.position.set(x, TILE_Y, z);
      world.addBody(body);

      tiles.push({
        id: row * ARENA_GRID + col,
        row, col,
        body,
        state: 'solid',   // solid | shaking | falling | gone
        shakeStart: null,
      });
    }
  }
  return tiles;
}

function addPlayer(room, socketId, username) {
  const { world, players } = room;
  const colorIdx = players.size % NEON_COLORS.length;
  const color = NEON_COLORS[colorIdx];

  const shape = new CANNON.Sphere(SPHERE_RADIUS);
  const body = new CANNON.Body({ mass: PLAYER_MASS, material: world._sphereMat });
  body.addShape(shape);
  body.linearDamping = 0.35;
  body.angularDamping = 0.6;

  const spawnPos = getSpawnPosition(players.size);
  body.position.set(spawnPos.x, RESPAWN_HEIGHT, spawnPos.z);
  world.addBody(body);

  const player = {
    id: socketId,
    username: username || `Player${players.size + 1}`,
    color,
    body,
    alive: true,
    kills: 0,
    rank: null,
    input: { forward: 0, right: 0, jump: false },
    lastJump: 0,
    ping: 0,
  };

  players.set(socketId, player);
  return player;
}

function getSpawnPosition(index) {
  const offset = ((ARENA_GRID - 1) * (TILE_SIZE + TILE_GAP)) / 2;
  const positions = [];
  const step = Math.floor(ARENA_GRID / 5);
  for (let r = step; r < ARENA_GRID - step; r += 2) {
    for (let c = step; c < ARENA_GRID - step; c += 2) {
      positions.push({
        x: c * (TILE_SIZE + TILE_GAP) - offset,
        z: r * (TILE_SIZE + TILE_GAP) - offset,
      });
    }
  }
  const pos = positions[index % positions.length];
  // Add small random offset to avoid stacking
  return {
    x: pos.x + (Math.random() - 0.5) * 1.5,
    z: pos.z + (Math.random() - 0.5) * 1.5,
  };
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
function startRoom(room) {
  if (room.state === 'playing') return;
  room.state = 'playing';
  room.startTime = Date.now();

  io.to(room.id).emit('gameStart', { tiles: serializeTiles(room.tiles) });

  // Schedule tile falling
  room.tileFallTimer = setTimeout(() => scheduleTileFall(room), TILE_FALL_START);

  // Physics tick
  room.tickTimer = setInterval(() => gameTick(room), TICK_MS);
}

function gameTick(room) {
  const now = Date.now();
  const dt = Math.min((now - room.lastTick) / 1000, 0.05);
  room.lastTick = now;

  const { world, players, tiles } = room;

  // Apply player inputs
  let aliveCount = 0;
  let lastAlive = null;

  for (const [id, player] of players) {
    if (!player.alive) continue;
    aliveCount++;
    lastAlive = player;

    applyInput(player, dt);

    // Clamp velocity
    const vel = player.body.velocity;
    const hSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (hSpeed > MAX_VELOCITY) {
      const scale = MAX_VELOCITY / hSpeed;
      vel.x *= scale;
      vel.z *= scale;
    }

    // Check fall
    if (player.body.position.y < FALL_THRESHOLD) {
      eliminatePlayer(room, id);
    }
  }

  // Step physics
  world.step(TICK_MS / 1000, dt, 3);

  // Update falling tiles
  updateTiles(room, dt);

  // Build snapshot
  const snapshot = buildSnapshot(room, now);
  io.to(room.id).emit('snapshot', snapshot);

  // End condition
  if (room.state === 'playing') {
    const initial = [...players.values()].filter(p => p.alive || p.rank !== null);
    if (aliveCount <= 1 && players.size > 1) {
      if (lastAlive) lastAlive.kills += 1;
      endRound(room, lastAlive);
    }
  }
}

function applyInput(player, dt) {
  const { input, body } = player;
  const vel = body.velocity;

  const fwd = new CANNON.Vec3(0, 0, -input.forward * MOVE_FORCE * PLAYER_MASS);
  const right = new CANNON.Vec3(input.right * MOVE_FORCE * PLAYER_MASS, 0, 0);

  if (input.forward !== 0 || input.right !== 0) {
    body.applyForce(fwd.vadd(right), body.position);
    body.wakeUp();
  }

  // Jump
  if (input.jump && Date.now() - player.lastJump > 700) {
    const onGround = vel.y < 1.5 && vel.y > -5;
    if (onGround) {
      body.applyImpulse(new CANNON.Vec3(0, JUMP_IMPULSE * PLAYER_MASS, 0), body.position);
      player.lastJump = Date.now();
      input.jump = false;
    }
  }
}

function eliminatePlayer(room, socketId) {
  const player = room.players.get(socketId);
  if (!player || !player.alive) return;

  player.alive = false;
  const alivePlayers = [...room.players.values()].filter(p => p.alive);
  player.rank = alivePlayers.length + 1;

  // Remove physics body
  room.world.removeBody(player.body);

  io.to(room.id).emit('playerEliminated', {
    id: socketId,
    username: player.username,
    rank: player.rank,
  });
}

function endRound(room, winner) {
  room.state = 'ended';
  clearInterval(room.tickTimer);
  clearTimeout(room.tileFallTimer);

  if (winner) winner.rank = 1;

  const leaderboard = [...room.players.values()]
    .sort((a, b) => (a.rank || 999) - (b.rank || 999))
    .map((p, i) => ({
      id: p.id,
      username: p.username,
      color: p.color,
      rank: p.rank || i + 1,
      kills: p.kills,
    }));

  io.to(room.id).emit('roundEnd', {
    winner: winner ? { id: winner.id, username: winner.username, color: winner.color } : null,
    leaderboard,
  });

  // Auto-restart after 8 seconds
  setTimeout(() => restartRoom(room), 8000);
}

function restartRoom(room) {
  clearInterval(room.tickTimer);
  clearTimeout(room.tileFallTimer);

  // Rebuild physics world
  const newWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
  newWorld.broadphase = new CANNON.NaiveBroadphase();
  newWorld.solver.iterations = 6;

  room.world = newWorld;
  room.tiles = buildArena(newWorld);
  room.state = 'waiting';
  room.tileFallInterval = TILE_FALL_INTERVAL_START;
  room.roundNumber++;

  // Re-add players
  const oldPlayers = [...room.players.values()];
  room.players.clear();

  for (const old of oldPlayers) {
    const p = addPlayer(room, old.id, old.username);
    p.color = old.color;
  }

  io.to(room.id).emit('roundRestart', {
    round: room.roundNumber,
    tiles: serializeTiles(room.tiles),
    players: serializePlayers(room),
  });

  // Start new round
  setTimeout(() => startRoom(room), 4000);
}

// ─── Tile Collapse ─────────────────────────────────────────────────────────────
function scheduleTileFall(room) {
  if (room.state !== 'playing') return;

  const solidTiles = room.tiles.filter(t => t.state === 'solid');
  if (solidTiles.length === 0) return;

  // Pick 1–3 random tiles to shake
  const count = Math.min(solidTiles.length, Math.floor(Math.random() * 3) + 1);
  const shuffled = solidTiles.sort(() => Math.random() - 0.5).slice(0, count);

  for (const tile of shuffled) {
    tile.state = 'shaking';
    tile.shakeStart = Date.now();
    io.to(room.id).emit('tileShake', { id: tile.id });

    // Actually fall after 1.5s
    setTimeout(() => dropTile(room, tile), 1500);
  }

  // Schedule next
  room.tileFallInterval = Math.max(
    TILE_FALL_INTERVAL_MIN,
    room.tileFallInterval - 80
  );
  room.tileFallTimer = setTimeout(() => scheduleTileFall(room), room.tileFallInterval);
}

function dropTile(room, tile) {
  if (tile.state === 'gone') return;
  tile.state = 'falling';
  io.to(room.id).emit('tileFall', { id: tile.id });

  // Remove body from physics after a short delay
  setTimeout(() => {
    if (tile.body) {
      room.world.removeBody(tile.body);
    }
    tile.state = 'gone';
  }, 2000);
}

function updateTiles(room, dt) {
  // No server-side fall animation needed; client handles visuals
}

// ─── Snapshot Builder ─────────────────────────────────────────────────────────
function buildSnapshot(room, now) {
  const players = [];
  for (const [id, p] of room.players) {
    if (!p.alive) continue;
    const pos = p.body.position;
    const vel = p.body.velocity;
    const quat = p.body.quaternion;
    players.push([
      id,
      +pos.x.toFixed(3), +pos.y.toFixed(3), +pos.z.toFixed(3),
      +vel.x.toFixed(2), +vel.y.toFixed(2), +vel.z.toFixed(2),
      +quat.x.toFixed(3), +quat.y.toFixed(3), +quat.z.toFixed(3), +quat.w.toFixed(3),
    ]);
  }
  return { t: now, p: players };
}

function serializeTiles(tiles) {
  return tiles.map(t => ({
    id: t.id, row: t.row, col: t.col,
    x: +t.body.position.x.toFixed(3),
    z: +t.body.position.z.toFixed(3),
    state: t.state,
  }));
}

function serializePlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id,
    username: p.username,
    color: p.color,
    alive: p.alive,
    x: +p.body.position.x.toFixed(3),
    y: +p.body.position.y.toFixed(3),
    z: +p.body.position.z.toFixed(3),
  }));
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
const DEFAULT_ROOM = 'arena-1';
rooms.set(DEFAULT_ROOM, createRoom(DEFAULT_ROOM));

io.on('connection', (socket) => {
  let currentRoom = null;
  let pingStart = 0;

  // Ping measurement
  const pingInterval = setInterval(() => {
    pingStart = Date.now();
    socket.emit('ping');
  }, 3000);

  socket.on('pong_client', () => {
    const player = currentRoom?.players.get(socket.id);
    if (player) player.ping = Date.now() - pingStart;
  });

  socket.on('join', ({ username, roomId = DEFAULT_ROOM }) => {
    const room = rooms.get(roomId) || rooms.get(DEFAULT_ROOM);
    if (room.players.size >= MAX_PLAYERS) {
      socket.emit('error', { msg: 'Room is full' });
      return;
    }

    currentRoom = room;
    socket.join(roomId);

    const player = addPlayer(room, socket.id, username || 'Drifter');

    socket.emit('joined', {
      id: socket.id,
      color: player.color,
      username: player.username,
      tiles: serializeTiles(room.tiles),
      players: serializePlayers(room),
      state: room.state,
      round: room.roundNumber,
    });

    socket.to(roomId).emit('playerJoined', {
      id: socket.id,
      username: player.username,
      color: player.color,
      x: player.body.position.x,
      y: player.body.position.y,
      z: player.body.position.z,
    });

    // Start game if enough players
    if (room.state === 'waiting' && room.players.size >= 1) {
      if (room.state !== 'playing') {
        setTimeout(() => {
          if (room.state === 'waiting') startRoom(room);
        }, 3000);
      }
    }
  });

  socket.on('input', (input) => {
    const room = currentRoom;
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player || !player.alive) return;

    player.input.forward = Math.max(-1, Math.min(1, input.f || 0));
    player.input.right   = Math.max(-1, Math.min(1, input.r || 0));
    if (input.j) player.input.jump = true;
  });

  socket.on('disconnect', () => {
    clearInterval(pingInterval);
    if (!currentRoom) return;
    const room = currentRoom;
    const player = room.players.get(socket.id);
    if (player && player.body) {
      try { room.world.removeBody(player.body); } catch (_) {}
    }
    room.players.delete(socket.id);
    io.to(room.id).emit('playerLeft', { id: socket.id });

    if (room.players.size === 0 && room.state === 'playing') {
      endRound(room, null);
    }
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🔥 NEON DRIFT SURVIVAL — Server running on http://localhost:${PORT}\n`);
});
