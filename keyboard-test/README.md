# Keyscope — keyboard test

Press a key, watch it light up. A browser keyboard tester for finding the
switch that stopped working, checking a second-hand board before you buy, or
confirming a repair.

Live: <https://saheerlab.vercel.app/keyboard-test/>

## What it does

- **Live board** — every key lights violet while it is held and turns green
  once it has registered. Grey means it has not been proven yet.
- **Three layouts** — full size (104), tenkeyless (87) and 60% (61). Progress
  carries across a switch, because the keys themselves have not changed.
- **Windows or Mac legends** — the same physical key is labelled `win` / `alt`
  / `backspace` or `command` / `option` / `delete`.
- **What the browser actually saw** — `event.key`, `event.code`,
  `event.keyCode`, the key's location (left, right, numpad) and how long it was
  held, plus live modifier state.
- **Rollover check** — hold several keys at once and see how many your keyboard
  can report simultaneously. Cheaper boards stop around six.
- **Progress** — tested, untested and total press count, with a banner when
  every key on the layout has answered.
- **Recent presses** — the last 40, newest first, with their codes.

## How it works

`event.code` identifies the *physical* key and does not change with the user's
language or layout, so the board is keyed on it; `event.key` is only ever
displayed. Caps are drawn from a layout table in `assets/layout.js` that
describes keys in key units (1u = one letter key), which is how keyboards are
actually dimensioned — so a layout preset is just a choice of which physical
blocks to show.

The board scales to the width it has: it renders at a known unit size, measures
what actually came out, and corrects. Below a readable minimum it scrolls
inside its own container instead of shrinking further, so the page body never
scrolls sideways.

The numpad is a CSS grid rather than flex rows, because `+` and `enter` are two
rows tall and a span is the honest way to say that.

## Keys the page cannot see

- **Fn and most media keys** are handled inside the keyboard's firmware and
  never reach any web page. They are not broken.
- **F5, F11, F12 and Ctrl/Cmd with W, T, N, R or Q** stay with the browser, so
  the page can never trap you. Everything else is held back while
  *Hold shortcuts* is on.
- **macOS** does not always deliver `keyup` for keys released under ⌘, so the
  board clears every held key when the window loses focus.

## Files

```
index.html           markup and document structure
assets/styles.css    design tokens, keycap physics, light and dark themes
assets/theme.js      applies the saved theme before first paint
assets/layout.js     key tables in key units, and the layout presets
assets/app.js        event handling, board rendering, progress
```

No build step, no dependencies, no tracking. Open `index.html` through any
static server.
