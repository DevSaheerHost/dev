/**
 * Keyscope — keyboard tester.
 *
 * The whole app is one loop: a key event arrives, the matching cap is found by
 * its `code`, and three things update — the cap, the readout, the counters.
 *
 * Two details are worth stating, because they decide how the rest is written:
 *
 * 1. `event.code` identifies the physical key and never changes with the
 *    user's language or layout, so it is what the board is keyed on. `key` is
 *    only ever displayed.
 * 2. Some keys never arrive at all (Fn, media keys handled in firmware) and a
 *    few belong to the browser (F5, F12, Ctrl+W). The page says so rather than
 *    letting someone conclude their keyboard is broken.
 */

import { BLOCKS, LAYOUTS, codesFor } from './layout.js';

const $ = (id) => document.getElementById(id);

/* Shortcuts the browser keeps, so a tester can never trap someone on the page. */
const NEVER_BLOCK = new Set(['F5', 'F11', 'F12']);
const NEVER_BLOCK_WITH_MODIFIER = new Set(['KeyW', 'KeyT', 'KeyN', 'KeyR', 'KeyQ']);

const LOCATION_NAMES = ['standard', 'left', 'right', 'numpad'];
const MAX_HISTORY = 40;

/* ------------------------------------------------------------------ state */

const state = {
  layout: 'full',
  legend: 'win',
  capture: true,
  /** Codes proven at least once, this session. */
  tested: new Set(),
  /** Codes held down right now. */
  down: new Map(),
  presses: 0,
  rollover: 0,
  codes: codesFor('full'),
};

/** code -> cap element, rebuilt whenever the layout changes. */
let caps = new Map();

/* ------------------------------------------------------------- the board */

function buildKey(key) {
  const cap = document.createElement('div');
  cap.className = 'key';
  if (key.wide) cap.classList.add('wide');
  cap.dataset.code = key.code;
  cap.style.setProperty('--kw', String(key.w ?? 1));
  if (key.h) cap.style.setProperty('--kh', String(key.h));

  const legend = document.createElement('span');
  legend.className = 'legend';

  if (key.top) {
    const top = document.createElement('span');
    top.className = 'top';
    top.textContent = key.top;
    legend.appendChild(top);
  }

  const main = document.createElement('span');
  main.textContent = state.legend === 'mac' && key.mac ? key.mac : key.label;
  legend.appendChild(main);

  cap.appendChild(legend);
  return cap;
}

function buildBlock(name, className) {
  const block = document.createElement('div');
  block.className = `block ${className}`;

  for (const row of BLOCKS[name]) {
    const line = document.createElement('div');
    line.className = 'block-row';

    for (const key of row) {
      if (key.spacer) {
        const gap = document.createElement('span');
        gap.className = 'spacer';
        gap.style.width = `calc(var(--u) * ${key.spacer})`;
        line.appendChild(gap);
        continue;
      }
      const cap = buildKey(key);
      line.appendChild(cap);
      caps.set(key.code, cap);
    }
    block.appendChild(line);
  }
  return block;
}

/**
 * The numpad is laid out on a grid, because `+` and `enter` are two rows tall.
 * Each key is placed into the first free cell of its row, so the keys that a
 * tall neighbour covers are skipped rather than pushed sideways.
 */
function buildGridBlock(name, className) {
  const block = document.createElement('div');
  block.className = `block ${className}`;

  const occupied = new Set();
  const cell = (row, column) => `${row}:${column}`;

  BLOCKS[name].forEach((row, rowIndex) => {
    let column = 1;
    for (const key of row) {
      while (occupied.has(cell(rowIndex + 1, column))) column += 1;

      const width = key.w ?? 1;
      const height = key.h ?? 1;
      const cap = buildKey(key);
      cap.style.gridColumn = `${column} / span ${width}`;
      cap.style.gridRow = `${rowIndex + 1} / span ${height}`;

      for (let r = 0; r < height; r += 1) {
        for (let c = 0; c < width; c += 1) {
          occupied.add(cell(rowIndex + 1 + r, column + c));
        }
      }

      block.appendChild(cap);
      caps.set(key.code, cap);
      column += width;
    }
  });

  return block;
}

/**
 * Assemble the board from physical blocks. A tenkeyless board is the full one
 * without the numpad, and a 60% is the main block alone — which is exactly how
 * the preset is expressed.
 */
function renderBoard() {
  const board = $('board');
  board.textContent = '';
  caps = new Map();

  const blocks = new Set(LAYOUTS[state.layout].blocks);

  if (blocks.has('functionRow')) {
    const deck = document.createElement('div');
    deck.className = 'deck';
    deck.appendChild(buildBlock('functionRow', 'block-function'));
    if (blocks.has('navTop')) deck.appendChild(buildBlock('navTop', 'block-navtop'));
    board.appendChild(deck);
  }

  const deck = document.createElement('div');
  deck.className = 'deck';
  deck.appendChild(buildBlock('main', 'block-main'));

  if (blocks.has('nav')) {
    const stack = document.createElement('div');
    stack.className = 'nav-stack';
    stack.appendChild(buildBlock('nav', 'block-nav'));
    if (blocks.has('arrows')) stack.appendChild(buildBlock('arrows', 'block-arrows'));
    deck.appendChild(stack);
  }

  if (blocks.has('numpad')) deck.appendChild(buildGridBlock('numpad', 'block-numpad'));
  board.appendChild(deck);

  state.codes = codesFor(state.layout);
  fitBoard();
  repaintTested();
  updateProgress();
  $('layoutName').textContent = LAYOUTS[state.layout].label.split(' · ')[0];
}

const UNIT_BASE = 50;
const UNIT_MIN = 26;

/**
 * Scale the board to the width it actually has.
 *
 * The key unit is measured rather than guessed: render at a known size, see
 * how wide the board came out, then scale the unit by the ratio that makes it
 * fit. Below the minimum unit the board stays readable and scrolls instead.
 */
function fitBoard() {
  const shell = $('boardShell');
  const board = $('board');
  const style = getComputedStyle(shell);
  const available =
    shell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 2;
  if (available <= 0) return;

  const setUnit = (value) => {
    const clamped = Math.max(UNIT_MIN, Math.min(UNIT_BASE, value));
    board.style.setProperty('--u', `${Math.floor(clamped * 100) / 100}px`);
    return clamped;
  };

  let unit = setUnit(UNIT_BASE);
  /*
   * Key widths are rounded to device pixels, so a row of twenty keys drifts a
   * few pixels from the arithmetic. Scale, measure what actually rendered,
   * and correct — twice is always enough, and it stops early once it fits.
   */
  for (let pass = 0; pass < 3; pass += 1) {
    const rendered = board.scrollWidth;
    if (rendered <= 0) return;
    if (rendered <= available && pass > 0) break;
    unit = setUnit((available / rendered) * unit);
    if (unit <= UNIT_MIN) break;
  }

  shell.scrollLeft = 0;
}

/** Re-apply the tested marks after a rebuild, so progress survives a switch. */
function repaintTested() {
  for (const [code, cap] of caps) {
    cap.classList.toggle('is-done', state.tested.has(code));
    cap.classList.toggle('is-down', state.down.has(code));
  }
}

/* ---------------------------------------------------------------- events */

function shouldBlock(event) {
  if (!state.capture) return false;
  if (NEVER_BLOCK.has(event.code)) return false;
  const withModifier = event.ctrlKey || event.metaKey;
  if (withModifier && NEVER_BLOCK_WITH_MODIFIER.has(event.code)) return false;
  return true;
}

function onKeyDown(event) {
  if (shouldBlock(event)) event.preventDefault();

  const code = event.code || `Key${event.keyCode}`;
  const cap = caps.get(code);

  if (!event.repeat) {
    state.presses += 1;
    state.down.set(code, performance.now());
    state.rollover = Math.max(state.rollover, state.down.size);

    if (state.codes.has(code)) state.tested.add(code);

    if (cap) {
      cap.classList.add('is-down');
      if (state.codes.has(code)) cap.classList.add('is-done');
      restartRipple(cap);
      scrollCapIntoView(cap);
    }

    addHistory(event, code);
    updateProgress();
  }

  showReadout(event, code, cap);
}

function onKeyUp(event) {
  const code = event.code || `Key${event.keyCode}`;
  const pressedAt = state.down.get(code);
  state.down.delete(code);

  const cap = caps.get(code);
  if (cap) cap.classList.remove('is-down');

  if (pressedAt !== undefined) {
    $('fHeld').textContent = `${Math.round(performance.now() - pressedAt)} ms`;
  }

  if (state.down.size === 0) {
    $('liveState').textContent = 'Released';
    $('readoutKey').classList.remove('is-live');
  }
  updateModifiers(event);
}

/**
 * The browser does not always deliver keyup — holding a key while the window
 * loses focus, or releasing it under a Meta combination on macOS, both leave a
 * cap stuck down. Clearing on blur keeps the board honest.
 */
function releaseAll() {
  for (const code of state.down.keys()) {
    caps.get(code)?.classList.remove('is-down');
  }
  state.down.clear();
  $('readoutKey').classList.remove('is-live');
  $('liveState').textContent = 'Waiting';
  updateModifiers({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false });
}

/* -------------------------------------------------------------- painting */

function restartRipple(cap) {
  cap.classList.remove('is-hit');
  // Force a reflow so the animation can be retriggered on a rapid re-press.
  void cap.offsetWidth;
  cap.classList.add('is-hit');
}

/** Keep the pressed cap visible when the board is wider than the screen. */
function scrollCapIntoView(cap) {
  const shell = $('boardShell');
  if (shell.scrollWidth <= shell.clientWidth) return;
  const capBox = cap.getBoundingClientRect();
  const shellBox = shell.getBoundingClientRect();
  if (capBox.left < shellBox.left || capBox.right > shellBox.right) {
    cap.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }
}

/** Printable keys show themselves; named keys show their name. */
function displayName(event) {
  if (event.key === ' ') return 'Space';
  if (event.key && event.key.length === 1) return event.key;
  return event.key || event.code || 'Unknown';
}

function showReadout(event, code, cap) {
  const box = $('readoutKey');
  const big = $('readoutBig');

  $('readoutIdle').hidden = true;
  big.hidden = false;
  big.textContent = displayName(event);

  box.classList.add('is-live');
  box.classList.remove('is-pulse');
  void box.offsetWidth;
  box.classList.add('is-pulse');

  $('fKey').textContent = event.key === ' ' ? '" "' : (event.key ?? '—');
  $('fCode').textContent = event.code || '(not reported)';
  $('fKeyCode').textContent = String(event.keyCode ?? '—');
  $('fLocation').textContent = `${event.location} · ${LOCATION_NAMES[event.location] ?? 'unknown'}`;
  $('fHeld').textContent = 'holding…';

  $('liveState').textContent = cap
    ? 'Registered'
    : state.codes.has(code)
      ? 'Registered'
      : 'Not on this layout';

  updateModifiers(event);
  $('announce').textContent = `${displayName(event)} pressed, code ${event.code || 'unknown'}`;
}

function updateModifiers(event) {
  $('modCtrl').classList.toggle('on', Boolean(event.ctrlKey));
  $('modShift').classList.toggle('on', Boolean(event.shiftKey));
  $('modAlt').classList.toggle('on', Boolean(event.altKey));
  $('modMeta').classList.toggle('on', Boolean(event.metaKey));
  $('modRepeat').classList.toggle('on', Boolean(event.repeat));
}

function addHistory(event, code) {
  const list = $('history');
  const empty = list.querySelector('.empty');
  if (empty) empty.remove();

  const row = document.createElement('li');

  const name = document.createElement('span');
  name.className = 'hk';
  name.textContent = displayName(event);

  const codeEl = document.createElement('span');
  codeEl.className = 'hc';
  codeEl.textContent = code;

  const when = document.createElement('span');
  when.className = 'hd';
  when.textContent = new Date().toLocaleTimeString(undefined, { hour12: false });

  row.append(name, codeEl, when);
  list.prepend(row);

  while (list.children.length > MAX_HISTORY) list.lastElementChild.remove();
}

function updateProgress() {
  const total = state.codes.size;
  let tested = 0;
  for (const code of state.tested) if (state.codes.has(code)) tested += 1;

  const percent = total === 0 ? 0 : Math.round((tested / total) * 100);

  $('testedCount').textContent = String(tested);
  $('totalCount').textContent = String(total);
  $('percent').textContent = `${percent}%`;
  $('statPresses').textContent = String(state.presses);
  $('statRollover').textContent = String(state.rollover);
  $('statLeft').textContent = String(total - tested);

  const fill = $('barFill');
  fill.style.width = `${percent}%`;
  fill.parentElement.setAttribute('aria-valuenow', String(percent));

  $('doneBanner').hidden = !(total > 0 && tested === total);
}

/* --------------------------------------------------------------- controls */

function resetTest() {
  state.tested.clear();
  state.presses = 0;
  state.rollover = 0;
  releaseAll();
  repaintTested();
  updateProgress();

  const list = $('history');
  list.textContent = '';
  const empty = document.createElement('li');
  empty.className = 'empty';
  empty.textContent = 'Nothing pressed yet';
  list.appendChild(empty);

  $('readoutIdle').hidden = false;
  $('readoutBig').hidden = true;
  for (const id of ['fKey', 'fCode', 'fKeyCode', 'fLocation', 'fHeld']) $(id).textContent = '—';
  $('announce').textContent = 'Test reset';
}

function currentTheme() {
  const stamped = document.documentElement.getAttribute('data-theme');
  if (stamped === 'dark' || stamped === 'light') return stamped;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncThemeButton() {
  const next = currentTheme() === 'dark' ? 'Light' : 'Dark';
  const button = $('theme');
  button.textContent = next;
  button.setAttribute('aria-label', `Switch to ${next.toLowerCase()} theme`);
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    window.localStorage.setItem('keyscope.theme', next);
  } catch {
    /* the preference simply will not persist */
  }
  syncThemeButton();
}

function wire() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });

  for (const input of document.querySelectorAll('input[name="layout"]')) {
    input.addEventListener('change', (event) => {
      state.layout = event.target.value;
      renderBoard();
    });
  }

  for (const input of document.querySelectorAll('input[name="legend"]')) {
    input.addEventListener('change', (event) => {
      state.legend = event.target.value;
      renderBoard();
    });
  }

  $('capture').addEventListener('change', (event) => {
    state.capture = event.target.checked;
  });

  const refit = () => fitBoard();
  window.addEventListener('resize', refit);
  if ('ResizeObserver' in window) new ResizeObserver(refit).observe($('boardShell'));

  $('reset').addEventListener('click', resetTest);
  $('theme').addEventListener('click', toggleTheme);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeButton);

  /* The controls are buttons; keep them from swallowing the keys under test. */
  for (const control of document.querySelectorAll('.btn, .switch input, .seg label')) {
    control.addEventListener('keydown', (event) => event.stopPropagation(), true);
  }
}

renderBoard();
wire();
syncThemeButton();
