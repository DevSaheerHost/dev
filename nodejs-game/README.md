# 🔥 NEON DRIFT SURVIVAL

A fast-paced **3D multiplayer physics knockout arena** for up to 30 players.  
Built with Three.js · Cannon-es · Node.js · Socket.io

---

## 🎮 Game Concept

30 players spawn on a neon-lit arena suspended in space. Control glowing spheres and **bump opponents off the edge** while floor tiles randomly collapse beneath you.  
**Last player remaining wins.**

---

## 🚀 Quick Start (5 Steps)

### Prerequisites
- Node.js v18+ installed → https://nodejs.org

### 1. Install dependencies
```bash
cd neon-drift-survival
npm install
```

### 2. Start the server
```bash
npm start
```

### 3. Open the game
Navigate to: **http://localhost:3000**

### 4. Multiplayer (local network)
Other players on your network can connect via your local IP:
```bash
# Find your IP
ipconfig   # Windows
ifconfig   # Mac/Linux
```
Then share: `http://YOUR_LOCAL_IP:3000`

### 5. Production deploy
```bash
# On any server (Railway, Render, Heroku, DigitalOcean):
PORT=3000 npm start
```

---

## 🎯 Controls

### Desktop
| Key | Action |
|-----|--------|
| W / ↑ | Move Forward |
| S / ↓ | Move Backward |
| A / ← | Move Left |
| D / → | Move Right |
| SPACE | Jump |

### Mobile
- **Left joystick** — Move in any direction
- **JUMP button** — Jump

---

## 🏗 Architecture

```
neon-drift-survival/
├── server.js              # Authoritative game server
│   ├── Cannon-es physics  # Server-side physics simulation
│   ├── Game rooms         # Room management (default: arena-1)
│   ├── Tile collapse      # Scheduled random tile removal
│   └── Socket.io events   # Real-time player sync
│
└── public/
    ├── index.html         # Game UI + screen structure
    ├── style.css          # Glassmorphism + neon aesthetics
    └── client.js          # Modular client engine
        ├── Renderer       # Three.js scene, lighting, stars
        ├── TileManager    # Tile visuals + fall animations
        ├── PlayerManager  # Interpolation, trails, particles
        ├── CameraController # Follow cam + shake
        ├── Input          # Keyboard + mobile joystick
        ├── Minimap        # Canvas-based radar
        ├── HUD            # All UI overlays
        └── Network        # Socket.io events
```

---

## ⚙️ Networking Model

| Feature | Implementation |
|---------|---------------|
| Tick rate | 20 Hz server physics |
| Interpolation | 100ms buffer, lerp between snapshots |
| Prediction | Client-side position prediction for self |
| Reconciliation | Server correction blended at 30% per frame (>0.2m error) |
| Hard correction | Instant snap for errors >2m |
| Snapshot format | Compact arrays (not objects) to minimize bandwidth |

---

## 🎨 Tech Stack

- **Three.js r134** — 3D rendering, shadows, particles
- **Cannon-es 0.20** — Physics (server-side authoritative)
- **Socket.io 4.6** — WebSocket real-time sync
- **Express 4** — Static file serving
- **Orbitron + Rajdhani** — Display fonts

---

## 🛠 Configuration (server.js constants)

```js
const MAX_PLAYERS      = 30;    // Players per room
const TICK_RATE        = 20;    // Physics ticks/sec
const TILE_FALL_START  = 8000;  // ms before first tile falls
const MOVE_FORCE       = 280;   // Player movement force
const JUMP_IMPULSE     = 6;     // Jump strength
```

---

## 📦 Deployment Tips

- Use `cluster` module or PM2 for multi-core production:
  ```bash
  npm install -g pm2
  pm2 start server.js -i max
  ```
- For 30+ concurrent players, recommend 1GB RAM minimum
- WebSocket proxy (nginx): enable `proxy_read_timeout 3600`

---

*Built for maximum drift. Stay on the board.*
