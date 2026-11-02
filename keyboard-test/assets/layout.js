/**
 * Keyboard layouts.
 *
 * Every key is described once, in physical units: `w` is its width in key
 * units (1u = one letter key), `h` its height in rows. Legends carry both the
 * Windows and the Mac label, because the same `code` is printed differently on
 * the two, and a tester that lies about the legend is a tester you distrust.
 *
 * Keys are grouped into the four physical blocks a keyboard is built from, so
 * a layout preset is simply a choice of which blocks to show.
 */

/** @typedef {{code: string, label: string, top?: string, mac?: string, w?: number, h?: number, wide?: boolean}} Key */

const SPACER = (w) => ({ spacer: w });

export const BLOCKS = {
  /* ------------------------------------------------------------ function --- */
  functionRow: [
    [
      { code: 'Escape', label: 'esc', w: 1 },
      SPACER(1),
      { code: 'F1', label: 'F1' },
      { code: 'F2', label: 'F2' },
      { code: 'F3', label: 'F3' },
      { code: 'F4', label: 'F4' },
      SPACER(0.5),
      { code: 'F5', label: 'F5' },
      { code: 'F6', label: 'F6' },
      { code: 'F7', label: 'F7' },
      { code: 'F8', label: 'F8' },
      SPACER(0.5),
      { code: 'F9', label: 'F9' },
      { code: 'F10', label: 'F10' },
      { code: 'F11', label: 'F11' },
      { code: 'F12', label: 'F12' },
    ],
  ],

  /* ---------------------------------------------------------------- main --- */
  main: [
    [
      { code: 'Backquote', label: '`', top: '~' },
      { code: 'Digit1', label: '1', top: '!' },
      { code: 'Digit2', label: '2', top: '@' },
      { code: 'Digit3', label: '3', top: '#' },
      { code: 'Digit4', label: '4', top: '$' },
      { code: 'Digit5', label: '5', top: '%' },
      { code: 'Digit6', label: '6', top: '^' },
      { code: 'Digit7', label: '7', top: '&' },
      { code: 'Digit8', label: '8', top: '*' },
      { code: 'Digit9', label: '9', top: '(' },
      { code: 'Digit0', label: '0', top: ')' },
      { code: 'Minus', label: '-', top: '_' },
      { code: 'Equal', label: '=', top: '+' },
      { code: 'Backspace', label: 'backspace', mac: 'delete', w: 2, wide: true },
    ],
    [
      { code: 'Tab', label: 'tab', w: 1.5, wide: true },
      { code: 'KeyQ', label: 'Q' },
      { code: 'KeyW', label: 'W' },
      { code: 'KeyE', label: 'E' },
      { code: 'KeyR', label: 'R' },
      { code: 'KeyT', label: 'T' },
      { code: 'KeyY', label: 'Y' },
      { code: 'KeyU', label: 'U' },
      { code: 'KeyI', label: 'I' },
      { code: 'KeyO', label: 'O' },
      { code: 'KeyP', label: 'P' },
      { code: 'BracketLeft', label: '[', top: '{' },
      { code: 'BracketRight', label: ']', top: '}' },
      { code: 'Backslash', label: '\\', top: '|', w: 1.5 },
    ],
    [
      { code: 'CapsLock', label: 'caps lock', w: 1.75, wide: true },
      { code: 'KeyA', label: 'A' },
      { code: 'KeyS', label: 'S' },
      { code: 'KeyD', label: 'D' },
      { code: 'KeyF', label: 'F' },
      { code: 'KeyG', label: 'G' },
      { code: 'KeyH', label: 'H' },
      { code: 'KeyJ', label: 'J' },
      { code: 'KeyK', label: 'K' },
      { code: 'KeyL', label: 'L' },
      { code: 'Semicolon', label: ';', top: ':' },
      { code: 'Quote', label: "'", top: '"' },
      { code: 'Enter', label: 'enter', mac: 'return', w: 2.25, wide: true },
    ],
    [
      { code: 'ShiftLeft', label: 'shift', w: 2.25, wide: true },
      { code: 'KeyZ', label: 'Z' },
      { code: 'KeyX', label: 'X' },
      { code: 'KeyC', label: 'C' },
      { code: 'KeyV', label: 'V' },
      { code: 'KeyB', label: 'B' },
      { code: 'KeyN', label: 'N' },
      { code: 'KeyM', label: 'M' },
      { code: 'Comma', label: ',', top: '<' },
      { code: 'Period', label: '.', top: '>' },
      { code: 'Slash', label: '/', top: '?' },
      { code: 'ShiftRight', label: 'shift', w: 2.75, wide: true },
    ],
    [
      { code: 'ControlLeft', label: 'ctrl', mac: 'control', w: 1.25, wide: true },
      { code: 'MetaLeft', label: 'win', mac: 'command', w: 1.25, wide: true },
      { code: 'AltLeft', label: 'alt', mac: 'option', w: 1.25, wide: true },
      { code: 'Space', label: 'space', w: 6.25, wide: true },
      { code: 'AltRight', label: 'alt', mac: 'option', w: 1.25, wide: true },
      { code: 'MetaRight', label: 'win', mac: 'command', w: 1.25, wide: true },
      { code: 'ContextMenu', label: 'menu', w: 1.25, wide: true },
      { code: 'ControlRight', label: 'ctrl', mac: 'control', w: 1.25, wide: true },
    ],
  ],

  /* ----------------------------------------------------------------- nav --- */
  navTop: [
    [
      { code: 'PrintScreen', label: 'prt sc', wide: true },
      { code: 'ScrollLock', label: 'scr lk', wide: true },
      { code: 'Pause', label: 'pause', wide: true },
    ],
  ],

  nav: [
    [
      { code: 'Insert', label: 'insert', wide: true },
      { code: 'Home', label: 'home', wide: true },
      { code: 'PageUp', label: 'pg up', wide: true },
    ],
    [
      { code: 'Delete', label: 'delete', wide: true },
      { code: 'End', label: 'end', wide: true },
      { code: 'PageDown', label: 'pg dn', wide: true },
    ],
  ],

  arrows: [
    [SPACER(1), { code: 'ArrowUp', label: '↑' }, SPACER(1)],
    [
      { code: 'ArrowLeft', label: '←' },
      { code: 'ArrowDown', label: '↓' },
      { code: 'ArrowRight', label: '→' },
    ],
  ],

  /*
   * The numpad is placed on a grid rather than in flex rows, because two of
   * its keys are two rows tall. `h: 2` is a real row span, not a taller box.
   */
  numpad: [
    [
      { code: 'NumLock', label: 'num', wide: true },
      { code: 'NumpadDivide', label: '/' },
      { code: 'NumpadMultiply', label: '*' },
      { code: 'NumpadSubtract', label: '−' },
    ],
    [
      { code: 'Numpad7', label: '7' },
      { code: 'Numpad8', label: '8' },
      { code: 'Numpad9', label: '9' },
      { code: 'NumpadAdd', label: '+', h: 2 },
    ],
    [
      { code: 'Numpad4', label: '4' },
      { code: 'Numpad5', label: '5' },
      { code: 'Numpad6', label: '6' },
    ],
    [
      { code: 'Numpad1', label: '1' },
      { code: 'Numpad2', label: '2' },
      { code: 'Numpad3', label: '3' },
      { code: 'NumpadEnter', label: 'enter', mac: 'return', h: 2, wide: true },
    ],
    [
      { code: 'Numpad0', label: '0', w: 2 },
      { code: 'NumpadDecimal', label: '.' },
    ],
  ],
};

/**
 * Layout presets. A preset is a set of physical blocks, which is exactly how
 * keyboards themselves are sized.
 */
export const LAYOUTS = {
  full: {
    id: 'full',
    label: 'Full size · 104 keys',
    short: 'Full',
    blocks: ['functionRow', 'navTop', 'main', 'nav', 'arrows', 'numpad'],
  },
  tkl: {
    id: 'tkl',
    label: 'Tenkeyless · 87 keys',
    short: 'TKL',
    blocks: ['functionRow', 'navTop', 'main', 'nav', 'arrows'],
  },
  compact: {
    id: 'compact',
    label: 'Compact · 61 keys',
    short: '60%',
    blocks: ['main'],
  },
};

/** Every code a preset contains, used for the "tested" progress count. */
export function codesFor(layoutId) {
  const layout = LAYOUTS[layoutId] ?? LAYOUTS.full;
  const codes = new Set();
  for (const blockName of layout.blocks) {
    for (const row of BLOCKS[blockName]) {
      for (const key of row) {
        if (key.code) codes.add(key.code);
      }
    }
  }
  return codes;
}

export { SPACER };
