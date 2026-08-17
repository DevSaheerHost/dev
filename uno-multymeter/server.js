/*
  UNO Q - Real-time Current/Voltage Monitor (Linux side)
  ---------------------------------------------------------
  Runs on the Qualcomm MPU (Debian) side with Node.js.

  1. Connects to the Arduino Router's Unix socket
     (/var/run/arduino-router.sock) using MessagePack-RPC
     to call the functions exposed by the MCU sketch.
  2. Polls current/voltage readings at a fixed interval.
  3. Broadcasts each reading to all connected browsers over
     WebSocket, for a live scrolling graph.

  Install deps first:
    npm install express ws @msgpack/msgpack
*/

const net = require('net');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Encoder, Decoder } = require('@msgpack/msgpack');

const SOCKET_PATH = '/var/run/arduino-router.sock';
const POLL_INTERVAL_MS = 30; // ~33 samples/sec to the browser

// ---------- Minimal MessagePack-RPC client over the router socket ----------
class RouterBridgeClient {
  constructor(socketPath) {
    this.socketPath = socketPath;
    this.msgId = 0;
    this.pending = new Map();
    this.encoder = new Encoder();
    this.decoder = new Decoder();
    this.socket = null;
    this.ready = this._connect();
  }

  _connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);
      this.socket.on('connect', () => resolve());
      this.socket.on('error', (err) => {
        console.error('[bridge] socket error:', err.message);
        reject(err);
      });
      this.socket.on('data', (chunk) => this._onData(chunk));
      this.socket.on('close', () => {
        console.error('[bridge] socket closed, retrying in 2s...');
        setTimeout(() => { this.ready = this._connect(); }, 2000);
      });
    });
  }

  _onData(chunk) {
    try {
      for (const msg of this.decoder.decodeMulti(chunk)) {
        // msgpack-rpc response frame: [type=1, msgid, error, result]
        const [type, id, error, result] = msg;
        if (type === 1 && this.pending.has(id)) {
          const { resolve, reject } = this.pending.get(id);
          this.pending.delete(id);
          if (error) reject(new Error(JSON.stringify(error)));
          else resolve(result);
        }
      }
    } catch (e) {
      // Partial frame, ignore - decoder buffers internally
    }
  }

  async call(method, params = []) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      const frame = this.encoder.encode([0, id, method, params]);
      this.socket.write(frame);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 1000);
    });
  }
}

// ---------- App setup ----------
const bridge = new RouterBridgeClient(SOCKET_PATH);
const app = express();
app.use(express.static(__dirname + '/public'));

const server = app.listen(3000, () => {
  console.log('Dashboard running at http://<board-ip>:3000');
});

const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const json = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(json);
  }
}

// ---------- Poll loop ----------
setInterval(async () => {
  try {
    const [current_mA, voltage_V] = await Promise.all([
      bridge.call('get_current_mA'),
      bridge.call('get_voltage_V'),
    ]);
    broadcast({ t: Date.now(), mA: current_mA, V: voltage_V });
  } catch (e) {
    // MCU not responding yet / still booting - skip this tick
  }
}, POLL_INTERVAL_MS);
