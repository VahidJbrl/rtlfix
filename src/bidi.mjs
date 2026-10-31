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

const LEADS = new Set([0x5f, 0x2d, 0x2e, 0x23, 0x40, 0x7e, 0x2f, 0x5c, 0x24, 0x25]);
const TRAILS = new Set([0x5f, 0x2d, 0x2f, 0x5c, 0x2b, 0x23, 0x25]);
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

export function bracketType(cp) {
  return BRACKET_TYPE.get(cp) || 0;
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

  if (glue && cps) {
    for (let k = 0; k < len && e === R; k++) {
      if (t[k] !== EN && t[k] !== AN) continue;
      let j = k;
      while (j < len && (t[j] === EN || t[j] === AN)) j++;
      if (j + 1 < len && initial[seq[j]] === WS && t[j + 1] === L) for (let m = k; m <= j; m++) t[m] = L;
      k = j;
    }
    const gap = (k) => k < 0 || k >= len || isNeutral(t[k]);
    for (let k = 0; k < len; k++) {
      if (t[k] !== ON || !(LEADS.has(cps[seq[k]]) || TRAILS.has(cps[seq[k]]))) continue;
      let j = k;
      while (j < len && t[j] === ON && (LEADS.has(cps[seq[j]]) || TRAILS.has(cps[seq[j]]))) j++;
      let lead = true;
      let trail = true;
      for (let m = k; m < j; m++) {
        lead &&= LEADS.has(cps[seq[m]]);
        trail &&= TRAILS.has(cps[seq[m]]);
      }
      if ((lead && gap(k - 1) && j < len && t[j] === L) || (trail && gap(j) && k > 0 && t[k - 1] === L)) for (let m = k; m < j; m++) t[m] = L;
      k = j - 1;
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

const GAPS = new Set([0x20, 0xa0, 0x3000, 0x202f, 0x205f, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a]);
const STOPS = new Set([0x2c, 0x3b, 0x3a, 0x2e, 0x21, 0x3f, 0x60c, 0x61b, 0x61f]);
const PROSE = new Set([0x60c, 0x61b, 0x61f]);
const AFTER_DIGITS = new Set([0x25, 0x66a, 0x2030, 0x2031, 0xb0]);
const BEFORE_DIGITS = new Set([0x24, 0x20ac, 0xa3, 0xa5, 0x20b9, 0x23]);
const isDigitCp = (cp) => cp >= 0 && (bidiClass(cp) === EN || bidiClass(cp) === AN);
const LINKS = new Set([0x2d, 0x5f, 0x2f, 0x5c, 0x2e, 0x3a, 0x2b]);
const words = (list) => new Set(list.split(' '));
const MONTHS = words('january february march april may june july august september october november december ' +
  'jan feb mar apr jun jul aug sep sept oct nov dec ' +
  '\u0641\u0631\u0648\u0631\u062f\u06cc\u0646 \u0627\u0631\u062f\u06cc\u0628\u0647\u0634\u062a \u062e\u0631\u062f\u0627\u062f \u062a\u06cc\u0631 \u0645\u0631\u062f\u0627\u062f \u0634\u0647\u0631\u06cc\u0648\u0631 ' +
  '\u0645\u0647\u0631 \u0622\u0628\u0627\u0646 \u0622\u0630\u0631 \u062f\u06cc \u0628\u0647\u0645\u0646 \u0627\u0633\u0641\u0646\u062f');
const COUNT_WORDS = words('\u062d\u062f\u0648\u062f \u062a\u0627 \u0628\u06cc\u0646 \u0637\u06cc \u062d\u062f\u0627\u0642\u0644 \u062d\u062f\u0627\u06a9\u062b\u0631 \u0633\u0627\u0644 \u0622\u062f\u0631\u0633');
const LEAD_WORDS = words('n s e w ne nw se sw am pm gb mb kb tb km kg ms');
const YEAR_WORDS = words('\u062f\u0631 \u0627\u0632 \u0628\u0647 \u0628\u0627 \u0628\u0631\u0627\u06cc');
const UNITS = words('\u0631\u0627 \u0631\u0648\u0632 \u0633\u0627\u0644 \u0645\u0627\u0647 \u0647\u0641\u062a\u0647 \u0633\u0627\u0639\u062a \u062f\u0642\u06cc\u0642\u0647 \u0633\u0647\u0645 \u0646\u0641\u0631 \u0628\u0627\u0631 \u062f\u0631\u0635\u062f \u062f\u0644\u0627\u0631 \u062a\u0648\u0645\u0627\u0646 \u0647\u0632\u0627\u0631 \u0645\u06cc\u0644\u06cc\u0648\u0646');
const scriptOf = (cp) => {
  if (cp < 0) return -1;
  const c = bidiClass(cp);
  return c === L ? L : c === R || c === AL ? R : -1;
};

function wordAt(cps, k, step) {
  const out = [];
  while (k >= 0 && k < cps.length && scriptOf(cps[k]) >= 0) {
    out.push(cps[k]);
    k += step;
  }
  if (step < 0) out.reverse();
  return String.fromCodePoint(...out).toLowerCase();
}

function numberHints(cps) {
  const n = cps.length;
  let bonus = 0;
  for (let k = 0; k < n; k++) {
    if (!isDigitCp(cps[k]) || (k > 0 && isDigitCp(cps[k - 1]))) continue;
    let b = k + 1;
    let dotted = false;
    while (b < n && (isDigitCp(cps[b]) || (STOPS.has(cps[b]) && b + 1 < n && isDigitCp(cps[b + 1])))) {
      if (cps[b] === 0x2e) dotted = true;
      b++;
    }
    const year = b - k === 4 && (cps[k] === 0x31 || cps[k] === 0x32);
    const before = k >= 2 && GAPS.has(cps[k - 1]) ? wordAt(cps, k - 2, -1) : '';
    let a = b;
    if (a < n && cps[a] === 0x2c) a++;
    const after = a + 1 < n && GAPS.has(cps[a]) ? wordAt(cps, a + 1, 1) : '';
    if (MONTHS.has(before)) bonus += 4;
    else if (MONTHS.has(after)) bonus += 2;
    if (COUNT_WORDS.has(before) || (year && YEAR_WORDS.has(before))) bonus++;
    if (UNITS.has(after) || LEAD_WORDS.has(after)) bonus++;
    if (dotted && before && scriptOf(before.codePointAt(0)) === L) bonus++;
    k = b - 1;
  }
  return bonus;
}

function pairUp(cps, idx, swapped) {
  const out = [];
  const stack = [];
  const opener = swapped ? CLOSE : OPEN;
  for (const k of idx) {
    const cp = cps[k];
    const bt = BRACKET_TYPE.get(cp);
    if (bt === opener) {
      if (stack.length === MAX_BRACKETS) break;
      stack.push([canon(swapped ? cp : BRACKET_PAIR.get(cp)), k]);
    } else if (bt) {
      const want = canon(swapped ? BRACKET_PAIR.get(cp) : cp);
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s][0] === want) {
          out.push([stack[s][1], k]);
          stack.length = s;
          break;
        }
      }
    }
  }
  return out;
}

function numberRuns(t, p) {
  const n = t.length;
  const runs = [];
  const strongAt = (k) => (t[k] === L || t[k] === R || t[k] === AL ? t[k] : -1);
  for (let k = 0; k < n; k++) {
    if (t[k] !== EN || (k > 0 && t[k - 1] === EN)) continue;
    let b = k + 1;
    while (b < n && (t[b] === EN || ((t[b] === CS || t[b] === ES) && b + 1 < n && t[b + 1] === EN))) b++;
    let left = -1;
    for (let j = k - 1; j >= 0 && left < 0; j--) left = strongAt(j);
    let right = -1;
    for (let j = b; j < n && right < 0; j++) right = strongAt(j);
    let def;
    let alt;
    if (p) {
      def = left === L ? L : right < 0 ? R : right;
      alt = left === L ? (right < 0 ? R : right) : left;
    } else {
      const back = left < 0 ? L : left;
      def = back === L || right < 0 || right === L ? back : right;
      alt = right < 0 ? -1 : def === back ? right : back;
    }
    const glued = (k > 0 && t[k - 1] === L) || (b < n && t[b] === L);
    runs.push({ a: k, b, def, alt: alt === def || glued ? -1 : alt });
    k = b - 1;
  }
  return runs;
}

function visualTypes(t0, cps, p, runs, flip, swappedFirst) {
  const n = t0.length;
  const e = p ? R : L;
  const t = Uint8Array.from(t0);
  const kind = new Int8Array(n).fill(-1);
  runs.forEach((run, i) => {
    const pre = flip[i] && run.alt >= 0 ? run.alt : run.def;
    const k0 = pre === AL ? AN : pre === L ? L : EN;
    for (let k = run.a; k < run.b; k++) {
      if (t[k] !== EN) continue;
      kind[k] = k0;
      if (k0 === AN) t[k] = AN;
    }
  });
  for (let k = 0; k < n; k++) if (t[k] === AL) t[k] = R;
  for (let k = 1; k < n - 1; k++) {
    if (t[k] !== ES && t[k] !== CS) continue;
    if (t[k - 1] === EN && t[k + 1] === EN) { t[k] = EN; kind[k] = kind[k - 1]; }
    else if (t[k] === CS && t[k - 1] === AN && t[k + 1] === AN) t[k] = AN;
  }
  for (let k = 0; k < n; k++) {
    if (t[k] !== ET) continue;
    let j = k;
    while (j < n && t[j] === ET) j++;
    const from = k > 0 && t[k - 1] === EN ? k - 1 : j < n && t[j] === EN ? j : -1;
    if (from >= 0) for (let m = k; m < j; m++) { t[m] = EN; kind[m] = kind[from]; }
    k = j - 1;
  }
  for (let k = 0; k < n; k++) {
    if (t[k] === ES || t[k] === ET || t[k] === CS) t[k] = ON;
    else if (t[k] === EN && kind[k] === L) t[k] = L;
  }
  const idx = [];
  for (let k = 0; k < n; k++) if (t[k] === ON && BRACKET_TYPE.has(cps[k])) idx.push(k);
  const first = pairUp(cps, idx, swappedFirst);
  const used = new Set(first.flat());
  const second = pairUp(cps, idx.filter((k) => !used.has(k)), !swappedFirst);
  const swapped = swappedFirst ? first : second;
  const normal = (swappedFirst ? second : first).sort((x, y) => x[0] - y[0]);
  for (const [o, c] of swapped) t[o] = t[c] = R;
  for (const [o, c] of normal) {
    let foundE = false;
    let foundOpp = false;
    for (let k = o + 1; k < c && !foundE; k++) {
      const d = strongDir(t[k]);
      if (d === e) foundE = true;
      else if (d !== -1) foundOpp = true;
    }
    if (!foundE && !foundOpp) continue;
    let dir = e;
    if (!foundE) {
      for (let k = o - 1; k >= 0; k--) {
        const d = strongDir(t[k]);
        if (d !== -1) { dir = d; break; }
      }
    }
    t[o] = t[c] = dir;
  }
  for (let k = 0; k < n; k++) {
    if (!isNeutral(t[k])) continue;
    let j = k;
    while (j < n && isNeutral(t[j])) j++;
    const lead = k === 0 ? e : strongDir(t[k - 1]);
    const trail = j === n ? e : strongDir(t[j]);
    const dir = lead === trail ? lead : e;
    for (let m = k; m < j; m++) t[m] = dir;
    k = j - 1;
  }
  const levels = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const c = t[k];
    levels[k] = p ? (c === R ? 1 : 2) : c === R ? 1 : c === L ? 0 : 2;
  }
  return levels;
}

function oddness(cps) {
  const n = cps.length;
  let pen = n && (GAPS.has(cps[0]) || STOPS.has(cps[0])) ? 1 : 0;
  pen -= numberHints(cps);
  const open = [];
  for (let i = 0; i < n; i++) {
    const c = cps[i];
    const prev = i > 0 ? cps[i - 1] : -1;
    const next = i + 1 < n ? cps[i + 1] : -1;
    if (LINKS.has(c) && scriptOf(prev) >= 0 && scriptOf(next) >= 0 && scriptOf(prev) !== scriptOf(next)) pen++;
    if (STOPS.has(c)) {
      const glued = next >= 0 && !GAPS.has(next) && !STOPS.has(next) && BRACKET_TYPE.get(next) !== CLOSE;
      if (GAPS.has(prev) && (glued || PROSE.has(c))) pen++;
      else if (PROSE.has(c) && glued && !(isDigitCp(prev) && isDigitCp(next))) pen++;
    }
    if (AFTER_DIGITS.has(c) && isDigitCp(next) && !isDigitCp(prev)) pen++;
    if (BEFORE_DIGITS.has(c) && isDigitCp(prev) && !isDigitCp(next)) pen++;
    const bt = BRACKET_TYPE.get(c);
    if (bt === OPEN) {
      open.push(canon(BRACKET_PAIR.get(c)));
      if (GAPS.has(next)) pen++;
    } else if (bt === CLOSE) {
      if (GAPS.has(prev)) pen++;
      const o = open.lastIndexOf(canon(c));
      if (o >= 0) open.splice(o, 1);
      else if (cps.some((x, j) => j > i && BRACKET_TYPE.get(x) === OPEN && canon(BRACKET_PAIR.get(x)) === canon(c))) pen++;
    }
  }
  return pen;
}

function tryVisual(cps, t0, p, runs, flip, swappedFirst) {
  const levels = visualTypes(t0, cps, p, runs, flip, swappedFirst);
  const order = visualOrder(levels);
  const text = order.map((k) => cps[k]);
  let ok = Math.max(0, firstStrong(classesOf(text), 0, text.length)) === p && firstStrong(t0, 0, t0.length) >= 0;
  let kept = false;
  if (ok) {
    const back = visualOrder(resolveLevels(text, p, { glue: false }));
    for (let j = 0; j < back.length && ok; j++) ok = order[back[j]] === j;
    if (ok) kept = visualOrder(resolveLevels(text, p)).every((k, j) => order[k] === j);
  }
  let flips = swappedFirst === (p === 1) ? 0 : 1;
  for (const f of flip) flips += f;
  return { levels, ok, pen: oddness(text), kept, flips, flip, swappedFirst };
}

const better = (a, b) => (a.ok !== b.ok ? a.ok : a.pen !== b.pen ? a.pen < b.pen : a.kept !== b.kept ? a.kept : a.flips < b.flips);

export function fromVisual(cps, p) {
  const t0 = classesOf(cps);
  for (let k = 0; k < t0.length; k++) {
    if (t0[k] === BN) t0[k] = ON;
    else if (t0[k] === NSM) t0[k] = k ? t0[k - 1] : p ? R : L;
  }
  const runs = numberRuns(t0, p);
  const open = [];
  runs.forEach((run, i) => { if (run.alt >= 0) open.push(i); });
  const both = cps.some((cp) => BRACKET_TYPE.has(cp)) ? [p === 1, p !== 1] : [p === 1];
  let top = null;
  for (const swappedFirst of both) {
    let cur = tryVisual(cps, t0, p, runs, runs.map(() => 0), swappedFirst);
    for (let round = 0; round <= 2 * open.length; round++) {
      let best = cur;
      for (const i of open) {
        const flip = cur.flip.slice();
        flip[i] ^= 1;
        const next = tryVisual(cps, t0, p, runs, flip, swappedFirst);
        if (better(next, best)) best = next;
      }
      if (best === cur) break;
      cur = best;
    }
    if (!top || better(cur, top)) top = cur;
  }
  return { levels: top.levels, ok: top.ok, pen: top.pen };
}

const CODE = new Set([0x3d, 0x3b, 0x7b, 0x7d, 0x3c, 0x3e]);

export function leansRtl(cps) {
  let rWords = 0;
  let lWords = 0;
  let rLetters = 0;
  let lLetters = 0;
  let last = -1;
  let prev = -1;
  let quoted = false;
  for (let k = 0; k < cps.length; k++) {
    const cp = cps[k];
    const c = bidiClass(cp);
    if (cp === 0x22 || cp === 0x60 || (cp === 0x27 && !(scriptOf(cps[k - 1] ?? -1) >= 0 && scriptOf(cps[k + 1] ?? -1) >= 0))) {
      quoted = !quoted;
      prev = -1;
      continue;
    }
    if (quoted) continue;
    if (CODE.has(cp)) return false;
    if (c === NSM || c === BN) continue;
    const d = c === L ? L : c === R || c === AL ? R : -1;
    if (d === L) {
      lLetters++;
      if (prev !== L) lWords++;
    } else if (d === R) {
      rLetters++;
      if (prev !== R) rWords++;
    }
    if (d >= 0) last = d;
    prev = d;
  }
  if (!rLetters) return false;
  return rWords >= lWords || (last === R && 2 * rLetters >= lLetters);
}
