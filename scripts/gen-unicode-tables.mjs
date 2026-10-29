#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const [ucd, ucdWidth] = process.argv.slice(2);
if (!ucd || !ucdWidth) {
  console.error('usage: node scripts/gen-unicode-tables.mjs <ucd-dir> <ucd-12.1.0-dir>');
  console.error('  <ucd-dir>        UnicodeData.txt, BidiBrackets.txt, BidiMirroring.txt, extracted/ files of the current Unicode version');
  console.error('  <ucd-12.1.0-dir> EastAsianWidth.txt and DerivedGeneralCategory.txt of Unicode 12.1.0 (the widths xterm.js uses)');
  process.exit(1);
}

const read = (dir, name) => {
  for (const p of [join(dir, name), join(dir, 'extracted', name)]) {
    try { return readFileSync(p, 'utf8'); } catch { }
  }
  throw new Error(`missing ${name} in ${dir}`);
};

const MAX = 0x110000;

function propertyArray(text, fill, names) {
  const out = new Array(MAX).fill(fill);
  for (const line of text.split('\n')) {
    const m = line.match(/^#\s*@missing:\s*([0-9A-F]+)\.\.([0-9A-F]+)\s*;\s*(\w+)/);
    if (m) {
      const v = names ? names[m[3]] : m[3];
      if (v === undefined) throw new Error(`unknown value ${m[3]}`);
      out.fill(v, parseInt(m[1], 16), parseInt(m[2], 16) + 1);
    }
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9A-F]+)(?:\.\.([0-9A-F]+))?\s*;\s*(\w+)/);
    if (!m) continue;
    const a = parseInt(m[1], 16);
    const b = m[2] ? parseInt(m[2], 16) : a;
    out.fill(m[3], a, b + 1);
  }
  return out;
}

function ranges(values, keep) {
  const out = [];
  let start = -1;
  let cur = null;
  for (let cp = 0; cp <= MAX; cp++) {
    const v = cp < MAX ? values[cp] : null;
    if (cp < MAX && v === cur) continue;
    if (start >= 0 && keep(cur)) out.push([start, cp - 1, cur]);
    start = cp;
    cur = v;
  }
  return out;
}

const BIDI_CLASSES = ['L', 'R', 'AL', 'EN', 'ES', 'ET', 'AN', 'CS', 'NSM', 'BN', 'B', 'S', 'WS', 'ON', 'LRE', 'LRO', 'RLE', 'RLO', 'PDF', 'LRI', 'RLI', 'FSI', 'PDI'];
const LONG = {
  Left_To_Right: 'L', Right_To_Left: 'R', Arabic_Letter: 'AL', European_Number: 'EN', European_Separator: 'ES',
  European_Terminator: 'ET', Arabic_Number: 'AN', Common_Separator: 'CS', Nonspacing_Mark: 'NSM',
  Boundary_Neutral: 'BN', Paragraph_Separator: 'B', Segment_Separator: 'S', White_Space: 'WS', Other_Neutral: 'ON',
};
const bidi = propertyArray(read(ucd, 'DerivedBidiClass.txt'), 'L', LONG);
const bidiRanges = ranges(bidi, (v) => v !== 'L').map(([a, b, v]) => [a, b, BIDI_CLASSES.indexOf(v)]);

const mirrors = [];
for (const line of read(ucd, 'BidiMirroring.txt').split('\n')) {
  const m = line.match(/^([0-9A-F]+);\s*([0-9A-F]+)/);
  if (m) mirrors.push([parseInt(m[1], 16), parseInt(m[2], 16)]);
}

const decomposition = new Map();
const generalCategory = new Map();
const names = new Map();
const byName = new Map();
for (const line of read(ucd, 'UnicodeData.txt').split('\n')) {
  if (!line) continue;
  const f = line.split(';');
  const cp = parseInt(f[0], 16);
  names.set(cp, f[1]);
  generalCategory.set(cp, f[2]);
  if (!byName.has(f[1])) byName.set(f[1], cp);
  if (f[5]) decomposition.set(cp, f[5]);
}

const brackets = [];
for (const line of read(ucd, 'BidiBrackets.txt').split('\n')) {
  const m = line.match(/^([0-9A-F]+);\s*([0-9A-F]+);\s*([oc])/);
  if (!m) continue;
  const cp = parseInt(m[1], 16);
  const dec = decomposition.get(cp);
  const canon = dec && /^[0-9A-F]+$/.test(dec) ? parseInt(dec, 16) : cp;
  brackets.push([cp, parseInt(m[2], 16), m[3] === 'o' ? 1 : 2, canon]);
}

const gc12 = propertyArray(read(ucdWidth, 'DerivedGeneralCategory.txt'), 'Cn');
const eaw12 = propertyArray(read(ucdWidth, 'EastAsianWidth.txt'), 'N');
const width = new Array(MAX).fill(1);
for (let cp = 0; cp < MAX; cp++) {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) width[cp] = 0;
  else if (cp < 0x7f) width[cp] = 1;
  else if ((gc12[cp] === 'Mn' || gc12[cp] === 'Me' || gc12[cp] === 'Cf') && cp !== 0xad) width[cp] = 0;
  else if ((cp >= 0x1160 && cp <= 0x11ff) || cp === 0x200b) width[cp] = 0;
  else if (eaw12[cp] === 'W' || eaw12[cp] === 'F') width[cp] = 2;
  else if ((cp >= 0x20000 && cp <= 0x2fffd) || (cp >= 0x30000 && cp <= 0x3fffd)) width[cp] = 2;
}
const widthRanges = ranges(width, (v) => v !== 1).filter(([a]) => a >= 0xa0);

const joining = propertyArray(read(ucd, 'DerivedJoiningType.txt'), 'U');
const ARABIC = [[0x0600, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]];
const inArabic = (cp) => ARABIC.some(([a, b]) => cp >= a && cp <= b);
const joinValues = new Array(MAX).fill('U');
for (let cp = 0; cp < MAX; cp++) {
  const v = joining[cp];
  if (v.length === 1 && ('CT'.includes(v) || (inArabic(cp) && 'RDL'.includes(v)))) joinValues[cp] = v;
}
const joinRanges = ranges(joinValues, (v) => v !== 'U').map(([a, b, v]) => [a, b, 'RDLCT'.indexOf(v)]);

const forms = new Map();
const lamAlef = new Map();
for (const [cp, name] of [...names.entries()].sort((a, b) => a[0] - b[0])) {
  if (!((cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff))) continue;
  const m = name.match(/^(.*) (ISOLATED|FINAL|INITIAL|MEDIAL) FORM$/);
  if (!m) continue;
  const kind = { ISOLATED: 0, FINAL: 1, INITIAL: 2, MEDIAL: 3 }[m[2]];
  if (name.startsWith('ARABIC LIGATURE LAM WITH ALEF')) {
    const d = (decomposition.get(cp) || '').match(/<\w+>\s+0644\s+([0-9A-F]+)$/);
    if (!d) continue;
    const alef = parseInt(d[1], 16);
    if (!/^ARABIC LETTER ALEF(?! MAKSURA)/.test(names.get(alef) || '')) continue;
    if (!lamAlef.has(alef)) lamAlef.set(alef, [0, 0]);
    if (kind <= 1) lamAlef.get(alef)[kind] = cp;
    continue;
  }
  if (/ (FATHATAN|DAMMATAN|KASRATAN|FATHA|DAMMA|KASRA|SHADDA|SUKUN)( ON TATWEEL)?$/.test(m[1])) continue;
  const base = byName.get(m[1]);
  if (base === undefined || base < 0x0600 || base > 0x08ff) continue;
  if (!['Lo', 'Lm'].includes(generalCategory.get(base))) continue;
  const d = decomposition.get(cp) || '';
  if (!new RegExp(`^<\\w+>\\s+${base.toString(16).toUpperCase().padStart(4, '0')}$`).test(d)) continue;
  if (!forms.has(base)) forms.set(base, [0, 0, 0, 0]);
  forms.get(base)[kind] = cp;
}

const flat = (rows) => JSON.stringify(rows.flat());
const version = (read(ucd, 'DerivedBidiClass.txt').match(/DerivedBidiClass-([\d.]+)\.txt/) || [])[1] || 'unknown';

const out = `export const UNICODE_VERSION = '${version}';
export const BIDI = ${flat(bidiRanges)};
export const MIRROR = ${flat(mirrors)};
export const BRACKETS = ${flat(brackets)};
export const WIDTH = ${flat(widthRanges)};
export const JOINING = ${flat(joinRanges)};
export const FORMS = ${flat([...forms.entries()].sort((a, b) => a[0] - b[0]).map(([cp, f]) => [cp, ...f]))};
export const LAM_ALEF = ${flat([...lamAlef.entries()].sort((a, b) => a[0] - b[0]).map(([cp, f]) => [cp, ...f]))};
`;
writeFileSync(join(ROOT, 'src', 'unicode-tables.mjs'), out);
console.log(`src/unicode-tables.mjs: Unicode ${version}, ${bidiRanges.length} bidi ranges, ${mirrors.length} mirrors, ${brackets.length} brackets, ${widthRanges.length} width ranges, ${joinRanges.length} joining ranges, ${forms.size} letters with forms, ${lamAlef.size} lam-alef ligatures, ${out.length} bytes`);
