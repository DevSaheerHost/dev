/**
 * Copies the built app from `app/dist` up to the folder the static host serves
 * (`/my-work-ledger/`), so the published URL carries no `dist` segment while
 * the source keeps a conventional layout.
 *
 * Only generated output is touched: the previous `assets` directory is removed
 * first because its filenames are content-hashed and stale ones would otherwise
 * accumulate forever. Everything else is copied over the top.
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
