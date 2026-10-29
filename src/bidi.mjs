import { BIDI, MIRROR, BRACKETS } from './unicode-tables.mjs';

export const L = 0;
export const R = 1;
export const AL = 2;
export const EN = 3;
export const ES = 4;
export const ET = 5;
export const AN = 6;
export const CS = 7;
export const NSM = 8;
export const BN = 9;
export const B = 10;
export const S = 11;
export const WS = 12;
export const ON = 13;
export const LRE = 14;
export const LRO = 15;
export const RLE = 16;
export const RLO = 17;
export const PDF = 18;
export const LRI = 19;
export const RLI = 20;
export const FSI = 21;
export const PDI = 22;

export const CLASS_NAMES = ['L', 'R', 'AL', 'EN', 'ES', 'ET', 'AN', 'CS', 'NSM', 'BN', 'B', 'S', 'WS', 'ON', 'LRE', 'LRO', 'RLE', 'RLO', 'PDF', 'LRI', 'RLI', 'FSI', 'PDI'];

const MAX_DEPTH = 125;
const MAX_BRACKETS = 63;

function lookup(cp) {
  let lo = 0;
  let hi = BIDI.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = mid * 3;
    if (cp < BIDI[k]) hi = mid - 1;
    else if (cp > BIDI[k + 1]) lo = mid + 1;
    else return BIDI[k + 2];
  }
  return L;
}

const ASCII = new Uint8Array(128);
for (let cp = 0; cp < 128; cp++) ASCII[cp] = lookup(cp);

export function bidiClass(cp) {
  return cp < 128 ? ASCII[cp] : lookup(cp);
}

export function isRtlLetter(cp) {
  if (cp < 0x0590) return false;
  const c = lookup(cp);
  return c === R || c === AL;
}

const MIRRORS = new Map();
for (let k = 0; k < MIRROR.length; k += 2) MIRRORS.set(MIRROR[k], MIRROR[k + 1]);

export function mirrorOf(cp) {
  return MIRRORS.get(cp) ?? cp;
}

const OPEN = 1;
const CLOSE = 2;
const BRACKET_TYPE = new Map();
const BRACKET_CANON = new Map();
const BRACKET_PAIR = new Map();
for (let k = 0; k < BRACKETS.length; k += 4) {
  BRACKET_PAIR.set(BRACKETS[k], BRACKETS[k + 1]);
  BRACKET_TYPE.set(BRACKETS[k], BRACKETS[k + 2]);
  BRACKET_CANON.set(BRACKETS[k], BRACKETS[k + 3]);
}
const canon = (cp) => BRACKET_CANON.get(cp) ?? cp;

const isIsolateInit = (t) => t === LRI || t === RLI || t === FSI;
const isRemoved = (t) => t === BN || (t >= LRE && t <= PDF);
const isNeutral = (t) => t === B || t === S || t === WS || t === ON || (t >= LRI && t <= PDI);
const strongDir = (t) => (t === L ? L : t === R || t === EN || t === AN ? R : -1);

function firstStrong(types, from, to) {
  let depth = 0;
  for (let i = from; i < to; i++) {
    const t = types[i];
    if (isIsolateInit(t)) depth++;
    else if (t === PDI) { if (depth > 0) depth--; }
    else if (t === B) break;
    else if (depth === 0) {
      if (t === L) return 0;
      if (t === R || t === AL) return 1;
    }
  }
  return -1;
}

export function classesOf(cps) {
  const out = new Uint8Array(cps.length);
  for (let i = 0; i < cps.length; i++) out[i] = bidiClass(cps[i]);
  return out;
}

export function paragraphLevel(cps) {
  return Math.max(0, firstStrong(classesOf(cps), 0, cps.length));
}

export const firstStrongLevel = paragraphLevel;

export function resolveLevels(cps, paraLevel, opts) {
  return resolveClasses(classesOf(cps), paraLevel, cps, opts);
}

export function resolveClasses(initial, paraLevel, cps = null, { glue = true } = {}) {
  const n = initial.length;
  if (paraLevel !== 0 && paraLevel !== 1) paraLevel = Math.max(0, firstStrong(initial, 0, n));
  const levels = new Uint8Array(n);
  if (n === 0) return levels;
  const types = Uint8Array.from(initial);

  const matchPdi = new Int32Array(n).fill(-1);
  const matchInit = new Int32Array(n).fill(-1);
  {
    const open = [];
    for (let i = 0; i < n; i++) {
      const t = initial[i];
      if (isIsolateInit(t)) open.push(i);
      else if (t === PDI && open.length) {
        const j = open.pop();
        matchPdi[j] = i;
        matchInit[i] = j;
      } else if (t === B) open.length = 0;
    }
  }

  const stLevel = [paraLevel];
  const stOverride = [ON];
  const stIsolate = [false];
  let overflowIsolate = 0;
  let overflowEmbedding = 0;
  let validIsolate = 0;
  const push = (level, override, isolate) => { stLevel.push(level); stOverride.push(override); stIsolate.push(isolate); };
  const pop = () => { stLevel.pop(); stOverride.pop(); stIsolate.pop(); };
  for (let i = 0; i < n; i++) {
    const t = initial[i];
    const top = stLevel.length - 1;
    switch (t) {
      case RLE: case LRE: case RLO: case LRO: {
        const rtl = t === RLE || t === RLO;
        const level = rtl ? (stLevel[top] + 1) | 1 : (stLevel[top] + 2) & ~1;
        levels[i] = stLevel[top];
        if (level <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
          push(level, t === RLO ? R : t === LRO ? L : ON, false);
        } else if (overflowIsolate === 0) {
          overflowEmbedding++;
        }
        break;
      }
      case RLI: case LRI: case FSI: {
        levels[i] = stLevel[top];
        if (stOverride[top] !== ON) types[i] = stOverride[top];
        let rtl = t === RLI;
        if (t === FSI) rtl = firstStrong(initial, i + 1, matchPdi[i] >= 0 ? matchPdi[i] : n) === 1;
        const level = rtl ? (stLevel[top] + 1) | 1 : (stLevel[top] + 2) & ~1;
        if (level <= MAX_DEPTH && overflowIsolate === 0 && overflowEmbedding === 0) {
          validIsolate++;
          push(level, ON, true);
        } else {
          overflowIsolate++;
        }
        break;
      }
      case PDI: {
        if (overflowIsolate > 0) {
          overflowIsolate--;
        } else if (validIsolate > 0) {
          overflowEmbedding = 0;
          while (!stIsolate[stIsolate.length - 1]) pop();
          pop();
          validIsolate--;
        }
        const k = stLevel.length - 1;
        levels[i] = stLevel[k];
        if (stOverride[k] !== ON) types[i] = stOverride[k];
        break;
      }
      case PDF:
        if (overflowIsolate === 0) {
          if (overflowEmbedding > 0) overflowEmbedding--;
          else if (!stIsolate[top] && stLevel.length >= 2) pop();
        }
        levels[i] = stLevel[stLevel.length - 1];
        break;
      case B:
        levels[i] = paraLevel;
        break;
      case BN:
        levels[i] = stLevel[top];
        break;
      default:
        levels[i] = stLevel[top];
        if (stOverride[top] !== ON) types[i] = stOverride[top];
    }
  }

  const kept = [];
  for (let i = 0; i < n; i++) if (!isRemoved(initial[i])) kept.push(i);
  const runs = [];
  for (let k = 0; k < kept.length; k++) {
    const i = kept[k];
    if (k === 0 || levels[i] !== levels[kept[k - 1]]) runs.push([i]);
    else runs[runs.length - 1].push(i);
  }
  const embed = levels.slice();
  const runStartingAt = new Map();
  for (const run of runs) runStartingAt.set(run[0], run);
  const keptPos = new Int32Array(n).fill(-1);
  kept.forEach((i, k) => { keptPos[i] = k; });

  for (const run of runs) {
    const first = run[0];
    if (initial[first] === PDI && matchInit[first] >= 0) continue;
    const seq = run.slice();
    let last = seq[seq.length - 1];
    while (isIsolateInit(initial[last]) && matchPdi[last] >= 0) {
      const next = runStartingAt.get(matchPdi[last]);
      if (!next) break;
      for (const i of next) seq.push(i);
      last = seq[seq.length - 1];
    }
    resolveSequence(seq, initial, types, levels, embed, paraLevel, cps, glue, kept, keptPos);
  }

  for (let i = 0; i < n; i++) {
    if (isRemoved(initial[i])) levels[i] = i > 0 ? levels[i - 1] : paraLevel;
  }
  let reset = true;
  for (let i = n - 1; i >= 0; i--) {
    const t = initial[i];
    if (t === S || t === B) {
      levels[i] = paraLevel;
      reset = true;
    } else if (reset && (t === WS || isIsolateInit(t) || t === PDI || isRemoved(t))) {
      levels[i] = paraLevel;
    } else {
      reset = false;
    }
  }
  return levels;
}

function resolveSequence(seq, initial, types, levels, embed, paraLevel, cps, glue, kept, keptPos) {
  const len = seq.length;
  const level = embed[seq[0]];
  const e = level & 1 ? R : L;
  const before = keptPos[seq[0]] > 0 ? embed[kept[keptPos[seq[0]] - 1]] : paraLevel;
  const sos = Math.max(level, before) & 1 ? R : L;
  const lastI = seq[len - 1];
  let after = paraLevel;
  if (!isIsolateInit(initial[lastI])) {
    const k = keptPos[lastI] + 1;
    if (k < kept.length) after = embed[kept[k]];
  }
  const eos = Math.max(level, after) & 1 ? R : L;
  const t = new Uint8Array(len);
  for (let k = 0; k < len; k++) t[k] = types[seq[k]];

  for (let k = 0; k < len; k++) {
    if (t[k] !== NSM) continue;
    if (k === 0) t[k] = sos;
    else t[k] = isIsolateInit(t[k - 1]) || t[k - 1] === PDI ? ON : t[k - 1];
  }
  let strong = sos;
  for (let k = 0; k < len; k++) {
    const c = t[k];
    if (c === L || c === R || c === AL) strong = c;
    else if (c === EN && strong === AL) t[k] = AN;
  }
  for (let k = 0; k < len; k++) if (t[k] === AL) t[k] = R;
  for (let k = 1; k < len - 1; k++) {
    const c = t[k];
    if (c !== ES && c !== CS) continue;
    const p = t[k - 1];
    const q = t[k + 1];
    if (p === EN && q === EN) t[k] = EN;
    else if (c === CS && p === AN && q === AN) t[k] = AN;
  }
  for (let k = 0; k < len; k++) {
    if (t[k] !== ET) continue;
    let j = k;
    while (j < len && t[j] === ET) j++;
    if ((k > 0 && t[k - 1] === EN) || (j < len && t[j] === EN)) for (let m = k; m < j; m++) t[m] = EN;
    k = j - 1;
  }
  for (let k = 0; k < len; k++) if (t[k] === ES || t[k] === ET || t[k] === CS) t[k] = ON;
  strong = sos;
  for (let k = 0; k < len; k++) {
    const c = t[k];
    if (c === L || c === R) strong = c;
    else if (c === EN && strong === L) t[k] = L;
  }

  if (cps) {
    const pairs = [];
    const stack = [];
    for (let k = 0; k < len; k++) {
      if (t[k] !== ON) continue;
      const cp = cps[seq[k]];
      const bt = BRACKET_TYPE.get(cp);
      if (bt === OPEN) {
        if (stack.length === MAX_BRACKETS) break;
        stack.push([canon(BRACKET_PAIR.get(cp)), k]);
      } else if (bt === CLOSE) {
        const want = canon(cp);
        for (let s = stack.length - 1; s >= 0; s--) {
          if (stack[s][0] === want) {
            pairs.push([stack[s][1], k]);
            stack.length = s;
            break;
          }
        }
      }
    }
    pairs.sort((a, b) => a[0] - b[0]);
    for (const [o, c] of pairs) {
      let foundE = false;
      let foundOpp = false;
      for (let k = o + 1; k < c; k++) {
        const d = strongDir(t[k]);
        if (d === e) { foundE = true; break; }
        if (d !== -1) foundOpp = true;
      }
      let dir;
      if (foundE) {
        dir = e;
      } else if (foundOpp) {
        let ctx = sos;
        for (let k = o - 1; k >= 0; k--) {
          const d = strongDir(t[k]);
          if (d !== -1) { ctx = d; break; }
        }
        dir = ctx !== e ? ctx : e;
      } else if (glue && c === o + 1 && o > 0 && t[o - 1] === L) {
        dir = L;
      } else {
        continue;
      }
      t[o] = dir;
      t[c] = dir;
      for (let k = o + 1; k < len && initial[seq[k]] === NSM; k++) t[k] = dir;
      for (let k = c + 1; k < len && initial[seq[k]] === NSM; k++) t[k] = dir;
    }
  }

  for (let k = 0; k < len; k++) {
    if (!isNeutral(t[k])) continue;
    let j = k;
    while (j < len && isNeutral(t[j])) j++;
    const lead = k === 0 ? sos : strongDir(t[k - 1]);
    const trail = j === len ? eos : strongDir(t[j]);
    const dir = lead === trail ? lead : e;
    for (let m = k; m < j; m++) t[m] = dir;
    k = j - 1;
  }

  for (let k = 0; k < len; k++) {
    const i = seq[k];
    const c = t[k];
    if (level & 1) {
      if (c === L || c === EN || c === AN) levels[i] = level + 1;
    } else if (c === R) {
      levels[i] = level + 1;
    } else if (c === AN || c === EN) {
      levels[i] = level + 2;
    }
  }
}

export function visualOrder(levels) {
  const n = levels.length;
  const order = new Array(n);
  let max = 0;
  let minOdd = 255;
  for (let i = 0; i < n; i++) {
    order[i] = i;
    const lv = levels[i];
    if (lv > max) max = lv;
    if (lv & 1 && lv < minOdd) minOdd = lv;
  }
  for (let lv = max; lv >= minOdd; lv--) {
    for (let i = 0; i < n; i++) {
      if (levels[order[i]] < lv) continue;
      let j = i + 1;
      while (j < n && levels[order[j]] >= lv) j++;
      for (let a = i, z = j - 1; a < z; a++, z--) {
        const tmp = order[a];
        order[a] = order[z];
        order[z] = tmp;
      }
      i = j;
    }
  }
  return order;
}

export function reorderLine(line, paraLevel) {
  const cps = [...line].map((ch) => ch.codePointAt(0));
  const pl = paraLevel ?? paragraphLevel(cps);
  const levels = resolveLevels(cps, pl);
  let out = '';
  for (const i of visualOrder(levels)) {
    out += String.fromCodePoint(levels[i] & 1 ? mirrorOf(cps[i]) : cps[i]);
  }
  return out;
}
