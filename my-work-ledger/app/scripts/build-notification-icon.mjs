/**
 * Renders the Android status-bar icon from `assets/notification-icon.svg`.
 *
 * `capacitor-assets` generates launcher icons and splash screens but not the
 * small icon a notification posts with, and Android needs one per density. A
 * missing `ic_stat_notify` is not a build error — the notification simply
 * falls back to the launcher icon, which Android then renders as a white
 * square, so this is worth having checked in rather than discovered on a phone.
 *
 * Run with `npm run build:notification-icon` after editing the SVG. The PNGs it
 * writes are committed; this does not run as part of a build.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = join(root, 'assets', 'notification-icon.svg');

/** Android's drawable densities, and the pixel size of a 24dp icon in each. */
const DENSITIES = [
  ['drawable-mdpi', 24],
  ['drawable-hdpi', 36],
  ['drawable-xhdpi', 48],
  ['drawable-xxhdpi', 72],
  ['drawable-xxxhdpi', 96],
];

for (const [folder, size] of DENSITIES) {
  const directory = join(root, 'android', 'app', 'src', 'main', 'res', folder);
  mkdirSync(directory, { recursive: true });
  const png = await sharp(source).resize(size, size).png().toBuffer();
  writeFileSync(join(directory, 'ic_stat_notify.png'), png);
  console.log(`${folder}/ic_stat_notify.png  ${size}x${size}  ${png.length} bytes`);
}
