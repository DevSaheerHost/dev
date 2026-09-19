/**
 * Copies the built app from `app/dist` up to the folder the static host serves
 * (`/transferbox/`), so the published URL has no `dist` segment in it while the
 * source keeps a conventional layout.
 *
 * Only generated files are touched: the previous `assets` directory is removed
 * (its filenames are content-hashed, so stale ones would accumulate forever)
 * and everything else is copied over the top.
 */

import { cp, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '..', 'dist');
const target = resolve(here, '..', '..');

await rm(join(target, 'assets'), { recursive: true, force: true });

for (const entry of await readdir(dist)) {
  await cp(join(dist, entry), join(target, entry), { recursive: true });
}

console.log(`Published ${dist} -> ${target}`);
