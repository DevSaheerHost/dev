/**
 * Regenerates `src/features/reports/notoSansSubset.ts`.
 *
 * jsPDF's built-in Helvetica has no U+20B9, so a statement would print the
 * rupee sign as a blank box. Rather than fall back to "Rs.", the font is
 * embedded — but only the characters a statement can actually contain, which
 * takes Noto Sans from ~450 KB per weight down to about 10 KB.
 *
 * Needs `pyftsubset` (pip install fonttools) and the font package:
 *
 *   pip install fonttools
 *   npm install --no-save @expo-google-fonts/noto-sans
 *   npm run build:pdf-font
 *
 * The generated file is committed, so a normal build and a fresh clone need
 * neither of those.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Latin, digits and punctuation, plus the rupee sign and the few typographic
// characters the statement layout uses.
const UNICODES = [
  'U+0020-007E',
  'U+00A0',
  'U+00B7',
  'U+2013',
  'U+2014',
  'U+2018',
  'U+2019',
  'U+201C',
  'U+201D',
  'U+2022',
  'U+20B9',
].join(',');

const WEIGHTS = [
  { dir: '400Regular', constant: 'NOTO_SANS_REGULAR_BASE64' },
  { dir: '700Bold', constant: 'NOTO_SANS_BOLD_BASE64' },
];

const work = mkdtempSync(join(tmpdir(), 'pdf-font-'));
const chunks = [];

for (const weight of WEIGHTS) {
  const source = `node_modules/@expo-google-fonts/noto-sans/${weight.dir}/NotoSans_${weight.dir}.ttf`;
  const output = join(work, `${weight.dir}.ttf`);

  execFileSync('pyftsubset', [
    source,
    `--unicodes=${UNICODES}`,
    `--output-file=${output}`,
    '--no-hinting',
    '--desubroutinize',
    '--drop-tables+=GSUB,GPOS,GDEF,morx,kern',
  ]);

  const base64 = readFileSync(output).toString('base64');
  const lines = base64.match(/.{1,96}/g) ?? [];
  chunks.push(
    `export const ${weight.constant} =\n${lines.map((line) => `  '${line}' +`).join('\n').replace(/ \+$/, '')};\n`,
  );
  console.log(`${weight.dir}: ${readFileSync(output).length} bytes`);
}

const header = `/**
 * Noto Sans, subsetted, as base64 TTF.
 *
 * jsPDF ships Helvetica, which has no U+20B9 — the rupee sign renders as a
 * blank box. A statement handed to a shop owner with no currency symbol on it
 * is not something to ship, so the font is embedded instead.
 *
 * Generated, not hand-written. Regenerate with \`npm run build:pdf-font\`, which
 * subsets Noto Sans to the characters a statement can contain (Latin, digits,
 * punctuation and the rupee sign). Two weights at roughly 10 KB each, loaded
 * only inside the lazy PDF chunk, so nothing here touches the dashboard.
 *
 * Noto Sans is licensed under the SIL Open Font License 1.1.
 */

`;

writeFileSync('src/features/reports/notoSansSubset.ts', `${header}\n${chunks.join('\n')}`);
console.log('wrote src/features/reports/notoSansSubset.ts');
