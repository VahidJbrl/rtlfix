#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const [udPath, jtPath, gcPath] = process.argv.slice(2);
if (!udPath || !jtPath || !gcPath) {
  console.error('usage: node scripts/gen-arabic-tables.mjs UnicodeData.txt DerivedJoiningType.txt DerivedGeneralCategory.txt');
  process.exit(1);
}

const BLOCKS = [
  [0x0600, 0x06ff],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0x08e0, 0x08ef],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];
const inBlock = (cp) => BLOCKS.some(([a, b]) => cp >= a && cp <= b);

const nameByCp = new Map();
const cpByName = new Map();
const catByCp = new Map();
const decByCp = new Map();
for (const line of readFileSync(udPath, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const f = line.split(';');
  const cp = parseInt(f[0], 16);
  const name = f[1];
  const cat = f[2];
  nameByCp.set(cp, name);
  catByCp.set(cp, cat);
  decByCp.set(cp, f[5] || '');
  if (!cpByName.has(name)) cpByName.set(name, []);
  cpByName.get(name).push(cp);
}

const joinByCp = new Map();
for (const line of readFileSync(jtPath, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [range, rest] = line.split(';');
  const type = rest.trim().split(' ')[0];
  if (!type) continue;
  const expand = (hex) => parseInt(hex, 16);
  if (range.includes('..')) {
    const [a, b] = range.split('..').map(expand);
    for (let cp = a; cp <= b; cp++) joinByCp.set(cp, type);
  } else {
    joinByCp.set(expand(range), type);
  }
}

const mnByCp = new Map();
for (const line of readFileSync(gcPath, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [range, rest] = line.split(';');
  const cat = rest.trim().split(' ')[0];
  if (cat !== 'Mn') continue;
  if (range.includes('..')) {
    const [a, b] = range.split('..').map((h) => parseInt(h, 16));
    for (let cp = a; cp <= b; cp++) mnByCp.set(cp, true);
  } else {
    mnByCp.set(parseInt(range, 16), true);
  }
}

const joinEntries = [];
for (const [cp, t] of [...joinByCp.entries()].sort((a, b) => a[0] - b[0])) {
  if (!inBlock(cp)) continue;
  if (!'RDNCL'.includes(t)) continue;
  joinEntries.push([cp, t]);
}

const mnEntries = [];
for (const cp of [...mnByCp.keys()].sort((a, b) => a - b)) {
  if (cp >= 0x0600 && cp <= 0x08ef) mnEntries.push(cp);
}

const formsByName = new Map();
const lamalefByAlef = new Map();

for (const [cp, name] of [...nameByCp.entries()].sort((a, b) => a[0] - b[0])) {
  if (!((cp >= 0xfb50 && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfeff))) continue;
  if (name.startsWith('ARABIC LIGATURE LAM')) {
    const m = (decByCp.get(cp) || '').match(/<\w+>\s+([0-9a-f]{4})\s+([0-9a-f]{4})/i);
    if (m) {
      const lam = parseInt(m[1], 16);
      const alef = parseInt(m[2], 16);
      if (lam === 0x0644) {
        if (!lamalefByAlef.has(alef)) lamalefByAlef.set(alef, {});
        const e = lamalefByAlef.get(alef);
        if (name.endsWith(' ISOLATED OR INITIAL FORM')) e.isoOrIni = cp;
        else if (name.endsWith(' ISOLATED FORM')) e.iso = cp;
        else if (name.endsWith(' FINAL FORM')) e.fin = cp;
      }
    }
    continue;
  }
  let base = null;
  let keys = null;
  if (name.endsWith(' ISOLATED OR INITIAL FORM')) {
    base = name.slice(0, -' ISOLATED OR INITIAL FORM'.length);
    keys = ['iso', 'ini'];
  } else if (name.endsWith(' ISOLATED FORM')) {
    base = name.slice(0, -' ISOLATED FORM'.length);
    keys = ['iso'];
  } else if (name.endsWith(' FINAL FORM')) {
    base = name.slice(0, -' FINAL FORM'.length);
    keys = ['fin'];
  } else if (name.endsWith(' INITIAL FORM')) {
    base = name.slice(0, -' INITIAL FORM'.length);
    keys = ['ini'];
  } else if (name.endsWith(' MEDIAL FORM')) {
    base = name.slice(0, -' MEDIAL FORM'.length);
    keys = ['med'];
  } else {
    continue;
  }
  if (/( FATHATAN| DAMMATAN| KASRATAN)$/.test(base)) continue;
  if (!formsByName.has(base)) formsByName.set(base, {});
  const entry = formsByName.get(base);
  for (const k of keys) entry[k] = cp;
}

const formsByCp = new Map();
for (const [base, f] of formsByName) {
  const cps = (cpByName.get(base) || []).filter(
    (cp) => cp >= 0x0600 && cp <= 0x08ef && (catByCp.get(cp) === 'Lo' || catByCp.get(cp) === 'Lm')
  );
  if (!cps.length) continue;
  formsByCp.set(cps[0], f);
}

for (const [alef] of [...lamalefByAlef.entries()]) {
  const nm = nameByCp.get(alef) || '';
  if (!nm.startsWith('ARABIC LETTER ALEF')) lamalefByAlef.delete(alef);
}

const ranges = (entries) => {
  const out = [];
  let start = null,
    prev = null;
  for (const cp of entries) {
    if (start === null) start = prev = cp;
    else if (cp === prev + 1) prev = cp;
    else {
      out.push([start, prev]);
      start = prev = cp;
    }
  }
  if (start !== null) out.push([start, prev]);
  return out;
};

const joinRanges = [];
{
  let start = null,
    prev = null,
    prevT = null;
  for (const [cp, t] of joinEntries) {
    if (start === null) start = prev = cp, prevT = t;
    else if (cp === prev + 1 && t === prevT) prev = cp;
    else {
      joinRanges.push([start, prev, prevT]);
      start = prev = cp, prevT = t;
    }
  }
  if (start !== null) joinRanges.push([start, prev, prevT]);
}

const hex = (n) => '0x' + n.toString(16).toLowerCase();

const out = `const AR_JOIN_RANGES = ${JSON.stringify(joinRanges)};

export const AR_JOIN = new Map();
for (const [a, b, t] of AR_JOIN_RANGES) for (let cp = a; cp <= b; cp++) AR_JOIN.set(cp, t);

const AR_MN_RANGES = ${JSON.stringify(ranges(mnEntries))};

export const isArabicMark = (cp) => AR_MN_RANGES.some(([a, b]) => cp >= a && cp <= b);

export const AR_FORMS = new Map(${JSON.stringify(
  [...formsByCp.entries()].sort((a, b) => a[0] - b[0]).map(([cp, f]) => [
    cp,
    [f.iso || 0, f.fin || 0, f.ini || 0, f.med || 0],
  ])
)});

export const AR_LAM = 0x0644;
export const AR_LAMALEF = new Map(${JSON.stringify(
  [...lamalefByAlef.entries()].sort((a, b) => a[0] - b[0]).map(([alef, f]) => [
    alef,
    [f.iso || 0, f.fin || 0, f.isoOrIni || 0],
  ])
)});
`;

writeFileSync(join(ROOT, 'src', 'arabic-tables.mjs'), out);
const la = [...lamalefByAlef.entries()]
  .map(([a, f]) => `${hex(a)}:iso=${hex(f.iso || 0)} fin=${hex(f.fin || 0)}`)
  .join(' ');
console.log(
  `wrote src/arabic-tables.mjs: ${joinRanges.length} join ranges, ${mnEntries.length} mark cps, ${formsByCp.size} letters with forms, lamalef ${la}`
);
