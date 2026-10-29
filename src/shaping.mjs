import { JOINING, FORMS, LAM_ALEF } from './unicode-tables.mjs';

const RIGHT = 0;
const DUAL = 1;
const LEFT = 2;
const CAUSING = 3;
const TRANSPARENT = 4;
const NONE = 5;
const LAM = 0x0644;

const FORM = new Map();
for (let k = 0; k < FORMS.length; k += 5) FORM.set(FORMS[k], FORMS.slice(k + 1, k + 5));
const LIGATURE = new Map();
for (let k = 0; k < LAM_ALEF.length; k += 3) LIGATURE.set(LAM_ALEF[k], [LAM_ALEF[k + 1], LAM_ALEF[k + 2]]);

function joinType(cp) {
  let lo = 0;
  let hi = JOINING.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = mid * 3;
    if (cp < JOINING[k]) hi = mid - 1;
    else if (cp > JOINING[k + 1]) lo = mid + 1;
    else return JOINING[k + 2];
  }
  return NONE;
}

function neighbour(types, i, dir) {
  for (let j = i + dir; j >= 0 && j < types.length; j += dir) {
    if (types[j] !== TRANSPARENT) return j;
  }
  return -1;
}

const joinsBack = (t) => t === DUAL || t === LEFT || t === CAUSING;
const joinsAhead = (t) => t === DUAL || t === RIGHT || t === CAUSING;

export function shapeCps(cps) {
  const n = cps.length;
  const out = cps.slice();
  const types = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    types[i] = cps[i] < 0x0300 ? NONE : joinType(cps[i]);
    if (FORM.has(cps[i])) any = true;
  }
  if (!any) return out;
  const right = (i) => {
    const t = types[i];
    if (t !== DUAL && t !== RIGHT) return false;
    const p = neighbour(types, i, -1);
    return p >= 0 && joinsBack(types[p]);
  };
  const left = (i) => {
    const t = types[i];
    if (t !== DUAL && t !== LEFT) return false;
    const q = neighbour(types, i, 1);
    return q >= 0 && joinsAhead(types[q]);
  };
  for (let i = 0; i < n; i++) {
    const c = cps[i];
    const forms = FORM.get(c);
    if (!forms) continue;
    if (c === LAM) {
      const q = neighbour(types, i, 1);
      const lig = q >= 0 ? LIGATURE.get(cps[q]) : null;
      if (lig) {
        out[i] = right(i) ? lig[1] : lig[0];
        out[q] = -1;
        i = q;
        continue;
      }
    }
    const r = right(i);
    const l = left(i);
    const f = forms[r && l ? 3 : r ? 1 : l ? 2 : 0];
    if (f) out[i] = f;
    else if (r && l && forms[1]) out[i] = forms[1];
    else if (forms[0]) out[i] = forms[0];
  }
  return out;
}

export function preShapeArabic(text) {
  const cps = [...text].map((s) => s.codePointAt(0));
  let out = '';
  for (const c of shapeCps(cps)) if (c >= 0) out += String.fromCodePoint(c);
  return out;
}
