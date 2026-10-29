#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLevels, resolveClasses, visualOrder, paragraphLevel, CLASS_NAMES } from '../src/bidi.mjs';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/bidi-conformance.mjs <dir with BidiTest.txt and BidiCharacterTest.txt>');
  process.exit(1);
}

function check(levels, want, order, n) {
  for (let i = 0; i < n; i++) if (want[i] !== 'x' && Number(want[i]) !== levels[i]) return false;
  const keep = [];
  for (let i = 0; i < n; i++) if (want[i] !== 'x') keep.push(i);
  return visualOrder(keep.map((i) => levels[i])).map((k) => keep[k]).join(' ') === order;
}

let failed = 0;
let total = 0;
for (const line of readFileSync(join(dir, 'BidiCharacterTest.txt'), 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [cpsF, dirF, plF, levF, ordF] = line.split(';');
  const cps = cpsF.trim().split(' ').map((h) => parseInt(h, 16));
  const d = Number(dirF);
  const levels = resolveLevels(cps, d === 2 ? null : d, { glue: false });
  const pl = d === 2 ? paragraphLevel(cps) : d;
  total++;
  if (Number(plF) !== pl || !check(levels, levF.trim().split(' '), ordF.trim(), cps.length)) failed++;
}
console.log(`BidiCharacterTest.txt: ${total - failed}/${total} passed`);

const index = Object.fromEntries(CLASS_NAMES.map((n, i) => [n, i]));
let levels = [];
let order = '';
let failed2 = 0;
let total2 = 0;
for (const line of readFileSync(join(dir, 'BidiTest.txt'), 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  if (line.startsWith('@Levels:')) { levels = line.slice(8).trim().split(/\s+/).filter(Boolean); continue; }
  if (line.startsWith('@Reorder:')) { order = line.slice(9).trim(); continue; }
  if (line.startsWith('@')) continue;
  const [typesF, bitsF] = line.split(';');
  const types = Uint8Array.from(typesF.trim().split(/\s+/).map((n) => index[n]));
  for (const [bit, pl] of [[1, null], [2, 0], [4, 1]]) {
    if (!(Number(bitsF) & bit)) continue;
    total2++;
    if (!check(resolveClasses(types, pl, null, { glue: false }), levels, order, types.length)) failed2++;
  }
}
console.log(`BidiTest.txt: ${total2 - failed2}/${total2} passed`);
process.exit(failed || failed2 ? 1 : 0);
