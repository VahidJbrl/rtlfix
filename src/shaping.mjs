import { AR_JOIN, AR_FORMS, AR_LAM, AR_LAMALEF, isArabicMark } from './arabic-tables.mjs';

const ZWNJ = 0x200c;
const ZWJ = 0x200d;
const TATWEEL = 0x0640;
const DAGGER_ALEF = 0x0670;

function joinType(code) {
  if (code === ZWNJ || code === ZWJ) return 'C';
  return AR_JOIN.get(code) || null;
}

const isLetter = (code) => AR_FORMS.has(code);

function scan(cps, i, dir) {
  let j = i + dir;
  let zwnj = false;
  while (j >= 0 && j < cps.length) {
    const c = cps[j];
    if (isArabicMark(c) || c === DAGGER_ALEF || c === TATWEEL || c === ZWJ) {
      j += dir;
      continue;
    }
    if (c === ZWNJ) {
      zwnj = true;
      j += dir;
      continue;
    }
    return { c, j, zwnj };
  }
  return null;
}

function rightConnection(cps, i) {
  const t = joinType(cps[i]);
  if (t !== 'D' && t !== 'R') return false;
  const n = scan(cps, i, -1);
  if (!n || !isLetter(n.c) || n.zwnj) return false;
  return joinType(n.c) === 'D';
}

function leftConnection(cps, i) {
  if (joinType(cps[i]) !== 'D') return false;
  const n = scan(cps, i, 1);
  if (!n || !isLetter(n.c) || n.zwnj) return false;
  return joinType(n.c) === 'D' || joinType(n.c) === 'R';
}

export function shapeCps(cps) {
  const out = cps.slice();
  for (let i = 0; i < cps.length; i++) {
    const c = cps[i];
    if (!isLetter(c)) continue;
    if (c === AR_LAM) {
      const n = scan(cps, i, 1);
      const laf = n && isLetter(n.c) ? AR_LAMALEF.get(n.c) : null;
      if (laf && !n.zwnj) {
        out[i] = rightConnection(cps, i) ? laf[1] : laf[0];
        out[n.j] = -1;
        i = n.j;
        continue;
      }
    }
    const r = rightConnection(cps, i);
    const l = leftConnection(cps, i);
    const forms = AR_FORMS.get(c);
    const idx = r && l ? 3  : r ? 1  : l ? 2  : 0 ;
    if (forms[idx]) out[i] = forms[idx];
  }
  return out;
}

export function preShapeArabic(text) {
  const cps = [...text].map((s) => s.codePointAt(0));
  let out = '';
  for (const c of shapeCps(cps)) if (c >= 0) out += String.fromCodePoint(c);
  return out;
}
