/**
 * PHONK AUDIO VISUALIZER — script.js
 * Web Audio API + HTML5 Canvas visualizer
 * Vanilla JS, no external dependencies
 */

'use strict';

/* ============================================================
   MODULE: State
   Central application state object
   ============================================================ */
const State = {
  audioCtx:       null,
  analyser:       null,
  source:         null,
  gainNode:       null,
  audioBuffer:    null,
  isPlaying:      false,
  isPaused:       false,
  startedAt:      0,        // AudioContext time when playback started
  pausedAt:       0,        // track offset when paused (seconds)
  duration:       0,
  volume:         1,
  isMuted:        false,
  volumeBeforeMute: 1,
  mode:           'bars',   // 'bars' | 'wave' | 'circle'
  fftSize:        2048,
  animFrameId:    null,

  // Bass reactivity metrics (updated each frame)
  bassLevel:      0,
  kickLevel:      0,
};

/* ============================================================
   MODULE: DOM References
   ============================================================ */
const DOM = {
  canvas:         document.getElementById('visualizerCanvas'),
  bassPulse:      document.getElementById('bassPulse'),
  statusDot:      document.getElementById('statusDot'),
  statusLabel:    document.getElementById('statusLabel'),
  trackName:      document.getElementById('trackName'),
  trackMeta:      document.getElementById('trackMeta'),
  btnPlayPause:   document.getElementById('btnPlayPause'),
  btnStop:        document.getElementById('btnStop'),
  btnRestart:     document.getElementById('btnRestart'),
  btnMute:        document.getElementById('btnMute'),
  iconPlay:       document.getElementById('iconPlay'),
  iconPause:      document.getElementById('iconPause'),
  audioFileInput: document.getElementById('audioFileInput'),
  seekRange:      document.getElementById('seekRange'),
  seekFill:       document.getElementById('seekFill'),
  seekHead:       document.getElementById('seekHead'),
  currentTime:    document.getElementById('currentTime'),
  totalTime:      document.getElementById('totalTime'),
  volumeSlider:   document.getElementById('volumeSlider'),
  modeBtns:       document.querySelectorAll('.mode-btn'),
};

const ctx = DOM.canvas.getContext('2d');

/* ============================================================
   MODULE: Audio Engine
   ============================================================ */
const AudioEngine = {

  /** Initialise (or reuse) the AudioContext */
  init() {
    if (State.audioCtx) return;
    State.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    State.analyser = State.audioCtx.createAnalyser();
    State.analyser.fftSize = State.fftSize;
    State.analyser.smoothingTimeConstant = 0.8;
    State.gainNode = State.audioCtx.createGain();

    State.analyser.connect(State.gainNode);
    State.gainNode.connect(State.audioCtx.destination);
  },

  /** Load an ArrayBuffer into an AudioBuffer */
  async decode(arrayBuffer) {
    this.init();
    return await State.audioCtx.decodeAudioData(arrayBuffer);
  },

  /** Create a new BufferSource and start playback */
  play(offset = 0) {
    if (!State.audioBuffer) return;
    this.init();

    // Tear down previous source if any
    if (State.source) {
      State.source.onended = null;
      try { State.source.stop(); } catch(_) {}
      State.source.disconnect();
    }

    State.source = State.audioCtx.createBufferSource();
    State.source.buffer = State.audioBuffer;
    State.source.connect(State.analyser);
    State.source.start(0, offset);
    State.source.onended = AudioEngine.onSourceEnded.bind(this);

    State.startedAt = State.audioCtx.currentTime - offset;
    State.pausedAt  = 0;
    State.isPlaying = true;
    State.isPaused  = false;
  },

  pause() {
    if (!State.isPlaying) return;
    State.pausedAt = State.audioCtx.currentTime - State.startedAt;
    if (State.source) {
      State.source.onended = null;
      try { State.source.stop(); } catch(_) {}
    }
    State.isPlaying = false;
    State.isPaused  = true;
  },

  resume() {
    if (!State.isPaused) return;
    this.play(State.pausedAt);
  },

  stop() {
    if (State.source) {
      State.source.onended = null;
      try { State.source.stop(); } catch(_) {}
    }
    State.isPlaying = false;
    State.isPaused  = false;
    State.pausedAt  = 0;
    State.startedAt = 0;
  },

  onSourceEnded() {
    if (State.isPlaying) {
      State.isPlaying = false;
      State.isPaused  = false;
      State.pausedAt  = 0;
      UI.syncPlayPauseBtn();
      UI.setStatus('STANDBY', '');
    }
  },

  /** Current playback position in seconds */
  currentPosition() {
    if (State.isPlaying)  return State.audioCtx.currentTime - State.startedAt;
    if (State.isPaused)   return State.pausedAt;
    return 0;
  },

  setVolume(val) {
    State.volume = val;
    if (State.gainNode) State.gainNode.gain.setTargetAtTime(val, State.audioCtx.currentTime, 0.01);
  },

  /** Get raw frequency data array */
  getFrequencyData() {
    const buf = new Uint8Array(State.analyser.frequencyBinCount);
    State.analyser.getByteFrequencyData(buf);
    return buf;
  },

  /** Get raw waveform / time-domain data */
  getTimeDomainData() {
    const buf = new Uint8Array(State.analyser.frequencyBinCount);
    State.analyser.getByteTimeDomainData(buf);
    return buf;
  },
};

/* ============================================================
   MODULE: Renderer
   All canvas drawing lives here
   ============================================================ */
const Renderer = {

  /** Colour palette tuned for phonk */
  palette: {
    barBase:    '#ff1a4e',
    barMid:     '#c340ff',
    barTop:     '#00f5ff',
    barGlow:    'rgba(255,26,78,0.35)',
    wave:       '#00f5ff',
    waveGlow:   'rgba(0,245,255,0.25)',
    radial:     '#ffe600',
    radialGlow: 'rgba(255,230,0,0.3)',
    bg:         '#04040a',
    kick:       'rgba(255,26,78,0.14)',
  },

  /** Resize canvas to device pixel ratio */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    DOM.canvas.width  = window.innerWidth  * dpr;
    DOM.canvas.height = window.innerHeight * dpr;
    DOM.canvas.style.width  = window.innerWidth  + 'px';
    DOM.canvas.style.height = window.innerHeight + 'px';
    ctx.scale(dpr, dpr);
  },

  /** Draw idle background (no audio) */
  drawIdle() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    ctx.clearRect(0, 0, W, H);
    // Subtle flat line
    ctx.strokeStyle = 'rgba(0,245,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
  },

  /** BAR MODE — frequency bars */
  drawBars(freqData) {
    const W  = window.innerWidth;
    const H  = window.innerHeight;
    const bottomPad = 148 + 16; // control panel height
    const topPad    = 130;
    const availH    = H - bottomPad - topPad;

    ctx.clearRect(0, 0, W, H);

    const total     = freqData.length;
    const usable    = Math.floor(total * 0.72); // ignore ultra-high freqs
    const barCount  = Math.min(usable, 160);
    const gap       = Math.max(1.5, W * 0.003);
    const barWidth  = (W - gap * (barCount + 1)) / barCount;

    // Bass kick flash
    if (State.kickLevel > 0.5) {
      ctx.fillStyle = this.palette.kick;
      ctx.fillRect(0, 0, W, H);
    }

    for (let i = 0; i < barCount; i++) {
      const dataIndex = Math.floor(i * usable / barCount);
      const raw       = freqData[dataIndex] / 255;
      const barH      = raw * availH;
      const x         = gap + i * (barWidth + gap);
      const y         = topPad + availH - barH;

      // Vertical gradient per bar
      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      grad.addColorStop(0,    this.palette.barTop);
      grad.addColorStop(0.45, this.palette.barMid);
      grad.addColorStop(1,    this.palette.barBase);

      // Glow pass (blurry backdrop)
      ctx.shadowColor = this.palette.barBase;
      ctx.shadowBlur  = 6 + raw * 18;

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(x, y, barWidth, barH, 2)
        : ctx.rect(x, y, barWidth, barH);
      ctx.fill();

      // Bright peak cap
      if (barH > 4) {
        ctx.shadowBlur  = 14;
        ctx.shadowColor = this.palette.barTop;
        ctx.fillStyle   = '#ffffff';
        ctx.fillRect(x, y, barWidth, 2);
      }
    }

    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
  },

  /** WAVE MODE — oscilloscope waveform */
  drawWave(timeData) {
    const W  = window.innerWidth;
    const H  = window.innerHeight;
    const midY = H / 2;

    ctx.clearRect(0, 0, W, H);

    const len    = timeData.length;
    const sliceW = W / len;
    const amp    = (H * 0.35) * (1 + State.bassLevel * 0.8);

    // Glow layer
    ctx.lineWidth   = 2.5 + State.bassLevel * 4;
    ctx.strokeStyle = this.palette.waveGlow;
    ctx.shadowColor = this.palette.wave;
    ctx.shadowBlur  = 18 + State.bassLevel * 20;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const v = (timeData[i] / 128.0) - 1.0;
      const x = i * sliceW;
      const y = midY + v * amp;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Sharp primary line
    ctx.lineWidth   = 1.5;
    ctx.strokeStyle = this.palette.wave;
    ctx.shadowBlur  = 8;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const v = (timeData[i] / 128.0) - 1.0;
      const x = i * sliceW;
      const y = midY + v * amp;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
  },

  /** RADIAL / CIRCLE MODE */
  drawCircle(freqData) {
    const W   = window.innerWidth;
    const H   = window.innerHeight;
    const cx  = W / 2;
    const cy  = H / 2 - 40;
    const baseR = Math.min(W, H) * 0.18;

    ctx.clearRect(0, 0, W, H);

    const total  = freqData.length;
    const count  = Math.min(Math.floor(total * 0.72), 180);
    const TAU    = Math.PI * 2;

    // Pulsing core circle
    ctx.beginPath();
    ctx.arc(cx, cy, baseR * (1 + State.bassLevel * 0.18), 0, TAU);
    ctx.strokeStyle = `rgba(195,64,255,${0.15 + State.bassLevel * 0.35})`;
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Frequency spikes around the circle
    for (let i = 0; i < count; i++) {
      const angle   = (i / count) * TAU - Math.PI / 2;
      const raw     = freqData[i] / 255;
      const spikeLen = raw * baseR * 2.2;
      const x1 = cx + Math.cos(angle) * (baseR + 2);
      const y1 = cy + Math.sin(angle) * (baseR + 2);
      const x2 = cx + Math.cos(angle) * (baseR + 2 + spikeLen);
      const y2 = cy + Math.sin(angle) * (baseR + 2 + spikeLen);

      // Hue shift across the circle
      const hue = (i / count) * 360;
      ctx.strokeStyle = `hsl(${hue}, 100%, ${50 + raw * 30}%)`;
      ctx.lineWidth   = 1.5 + raw * 2;
      ctx.shadowColor = `hsl(${hue}, 100%, 60%)`;
      ctx.shadowBlur  = 4 + raw * 12;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    // Centre dot
    ctx.shadowBlur  = 20;
    ctx.shadowColor = this.palette.radial;
    ctx.fillStyle   = this.palette.radial;
    ctx.beginPath();
    ctx.arc(cx, cy, 4 + State.bassLevel * 6, 0, TAU);
    ctx.fill();

    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
  },
};

/* ============================================================
   MODULE: Animation Loop
   ============================================================ */
const AnimLoop = {

  /** Exponential smoothing helper */
  smooth(current, target, factor) {
    return current + (target - current) * factor;
  },

  /** Compute bass + kick levels from frequency data */
  computeLevels(freqData) {
    // Bass: bins 0–8 (~0–350 Hz)
    let bassSum = 0;
    const bassEnd = 9;
    for (let i = 0; i < bassEnd; i++) bassSum += freqData[i];
    const bassAvg  = bassSum / (bassEnd * 255);
    State.bassLevel = this.smooth(State.bassLevel, bassAvg, 0.22);

    // Kick transient: single bin 1
    const kick = freqData[1] / 255;
    State.kickLevel = this.smooth(State.kickLevel, kick, 0.45);
  },

  /** Drive the bass-pulse overlay in the DOM */
  updateBassPulse() {
    const intensity = Math.max(0, State.bassLevel - 0.25) * 1.8;
    DOM.bassPulse.style.opacity = (intensity * 0.28).toFixed(3);
  },

  tick() {
    State.animFrameId = requestAnimationFrame(AnimLoop.tick.bind(AnimLoop));

    if (!State.analyser) {
      Renderer.drawIdle();
      return;
    }

    const freqData  = AudioEngine.getFrequencyData();
    const timeData  = AudioEngine.getTimeDomainData();

    this.computeLevels(freqData);
    this.updateBassPulse();

    switch (State.mode) {
      case 'wave':   Renderer.drawWave(timeData);  break;
      case 'circle': Renderer.drawCircle(freqData); break;
      default:       Renderer.drawBars(freqData);
    }

    // Sync seek bar
    if (State.isPlaying || State.isPaused) {
      UI.updateSeek();
    }
  },

  start() {
    if (!State.animFrameId) this.tick();
  },

  stop() {
    if (State.animFrameId) {
      cancelAnimationFrame(State.animFrameId);
      State.animFrameId = null;
    }
  },
};

/* ============================================================
   MODULE: UI
   All DOM interaction & updates
   ============================================================ */
const UI = {

  /** Status display */
  setStatus(label, dotClass) {
    DOM.statusLabel.textContent = label;
    DOM.statusDot.className     = 'status-dot ' + dotClass;
  },

  syncPlayPauseBtn() {
    if (State.isPlaying) {
      DOM.iconPlay.classList.add('hidden');
      DOM.iconPause.classList.remove('hidden');
    } else {
      DOM.iconPlay.classList.remove('hidden');
      DOM.iconPause.classList.add('hidden');
    }
  },

  updateSeek() {
    const pos      = AudioEngine.currentPosition();
    const dur      = State.duration;
    if (!dur) return;
    const pct      = Math.min(pos / dur, 1) * 100;
    DOM.seekFill.style.width    = pct + '%';
    DOM.seekHead.style.left     = pct + '%';
    DOM.seekRange.value         = pct;
    DOM.currentTime.textContent = formatTime(pos);
  },

  setTrackInfo(name, meta) {
    DOM.trackName.textContent = name.toUpperCase();
    DOM.trackMeta.textContent = meta;
  },
};

/* ============================================================
   MODULE: Event Handlers
   ============================================================ */

/** File Upload */
DOM.audioFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await loadAudioFile(file);
});

/** Play / Pause */
DOM.btnPlayPause.addEventListener('click', () => {
  if (!State.audioBuffer) return;

  // Resume suspended AudioContext (browser autoplay policy)
  if (State.audioCtx && State.audioCtx.state === 'suspended') {
    State.audioCtx.resume();
  }

  if (State.isPlaying) {
    AudioEngine.pause();
    UI.setStatus('PAUSED', 'paused');
  } else if (State.isPaused) {
    AudioEngine.resume();
    UI.setStatus('PLAYING', 'active');
  } else {
    AudioEngine.play(0);
    UI.setStatus('PLAYING', 'active');
  }

  UI.syncPlayPauseBtn();
});

/** Stop */
DOM.btnStop.addEventListener('click', () => {
  AudioEngine.stop();
  UI.syncPlayPauseBtn();
  UI.setStatus('STOPPED', '');
  DOM.seekFill.style.width = '0%';
  DOM.seekHead.style.left  = '0%';
  DOM.seekRange.value      = 0;
  DOM.currentTime.textContent = '0:00';
});

/** Restart */
DOM.btnRestart.addEventListener('click', () => {
  if (!State.audioBuffer) return;
  AudioEngine.play(0);
  UI.syncPlayPauseBtn();
  UI.setStatus('PLAYING', 'active');
});

/** Seek */
DOM.seekRange.addEventListener('input', (e) => {
  if (!State.audioBuffer) return;
  const pct    = parseFloat(e.target.value) / 100;
  const offset = pct * State.duration;
  const wasPlaying = State.isPlaying;
  AudioEngine.stop();
  if (wasPlaying || State.isPaused) {
    AudioEngine.play(offset);
    if (!wasPlaying) {
      // keep it paused at new position
      AudioEngine.pause();
    }
    UI.syncPlayPauseBtn();
  }
  DOM.seekFill.style.width = (pct * 100) + '%';
  DOM.seekHead.style.left  = (pct * 100) + '%';
});

/** Volume */
DOM.volumeSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  State.volume         = val;
  State.isMuted        = val === 0;
  State.volumeBeforeMute = val > 0 ? val : State.volumeBeforeMute;
  AudioEngine.setVolume(val);
});

/** Mute / Unmute */
DOM.btnMute.addEventListener('click', () => {
  if (State.isMuted) {
    const restored = State.volumeBeforeMute || 1;
    AudioEngine.setVolume(restored);
    DOM.volumeSlider.value = restored;
    State.isMuted = false;
  } else {
    State.volumeBeforeMute = State.volume;
    AudioEngine.setVolume(0);
    DOM.volumeSlider.value = 0;
    State.isMuted = true;
  }
});

/** Mode Buttons */
DOM.modeBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    State.mode = btn.dataset.mode;
    DOM.modeBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

/** Drag & Drop */
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  document.body.classList.add('drag-over');
});

document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) document.body.classList.remove('drag-over');
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  document.body.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('audio/')) {
    await loadAudioFile(file);
  }
});

/** Resize */
window.addEventListener('resize', Renderer.resize.bind(Renderer));

/* ============================================================
   UTILITY: Load & Decode Audio File
   ============================================================ */
async function loadAudioFile(file) {
  UI.setStatus('LOADING...', '');
  UI.setTrackInfo('Loading...', 'Decoding audio data...');
  DOM.btnPlayPause.disabled = true;

  try {
    const arrayBuffer = await file.arrayBuffer();
    AudioEngine.init();

    // Stop any current playback
    AudioEngine.stop();

    State.audioBuffer = await AudioEngine.decode(arrayBuffer);
    State.duration    = State.audioBuffer.duration;

    const name = file.name.replace(/\.[^.]+$/, ''); // strip extension
    const meta = `${formatTime(State.duration)}  ·  ${(file.size / 1_000_000).toFixed(1)} MB  ·  READY`;

    UI.setTrackInfo(name, meta);
    DOM.totalTime.textContent   = formatTime(State.duration);
    DOM.currentTime.textContent = '0:00';
    DOM.seekFill.style.width    = '0%';
    DOM.seekHead.style.left     = '0%';
    DOM.seekRange.value         = 0;
    DOM.btnPlayPause.disabled   = false;

    UI.setStatus('READY', 'paused');

    // Auto-play
    AudioEngine.play(0);
    UI.syncPlayPauseBtn();
    UI.setStatus('PLAYING', 'active');

  } catch (err) {
    console.error('[AudioEngine] Decode error:', err);
    UI.setTrackInfo('ERROR', 'Could not decode this audio file.');
    UI.setStatus('ERROR', '');
  }
}

/* ============================================================
   UTILITY: Time Formatter
   Converts seconds → "m:ss"
   ============================================================ */
function formatTime(sec) {
  if (!isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/* ============================================================
   BOOT
   ============================================================ */
(function boot() {
  Renderer.resize();
  AnimLoop.start();

  // Draw idle scene before any audio is loaded
  Renderer.drawIdle();
})();
