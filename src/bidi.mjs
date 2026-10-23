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

const ASCII = new Uint8Array(128).fill(ON);
for (let c = 0; c < 0x20; c++) ASCII[c] = BN;
ASCII[0x09] = S; ASCII[0x0a] = B; ASCII[0x0b] = S; ASCII[0x0c] = WS; ASCII[0x0d] = B;
ASCII[0x1c] = B; ASCII[0x1d] = B; ASCII[0x1e] = B; ASCII[0x1f] = S;
ASCII[0x20] = WS; ASCII[0x7f] = BN;
for (const c of '#$%') ASCII[c.charCodeAt(0)] = ET;
for (const c of '+-') ASCII[c.charCodeAt(0)] = ES;
for (const c of ',./:') ASCII[c.charCodeAt(0)] = CS;
for (let c = 0x30; c <= 0x39; c++) ASCII[c] = EN;
for (let c = 0x41; c <= 0x5a; c++) ASCII[c] = L;
for (let c = 0x61; c <= 0x7a; c++) ASCII[c] = L;

const RANGES = [
  [0x00a0, 0x00a0, CS], [0x00a2, 0x00a5, ET], [0x00ad, 0x00ad, BN],
  [0x00b0, 0x00b1, ET], [0x00b2, 0x00b3, EN], [0x00b9, 0x00b9, EN],
  [0x0300, 0x036f, NSM], [0x0483, 0x0489, NSM],
  [0x0590, 0x0590, R], [0x0591, 0x05bd, NSM], [0x05be, 0x05be, R], [0x05bf, 0x05bf, NSM],
  [0x05c0, 0x05c0, R], [0x05c1, 0x05c2, NSM], [0x05c3, 0x05c3, R], [0x05c4, 0x05c5, NSM],
  [0x05c6, 0x05c6, R], [0x05c7, 0x05c7, NSM], [0x05c8, 0x05ff, R],
  [0x0600, 0x0605, AN], [0x0606, 0x0607, ON], [0x0608, 0x0608, AL], [0x0609, 0x060a, ET],
  [0x060b, 0x060b, AL], [0x060c, 0x060c, CS], [0x060d, 0x060d, AL], [0x060e, 0x060f, ON],
  [0x0610, 0x061a, NSM], [0x061b, 0x061b, AL], [0x061c, 0x061c, BN], [0x061d, 0x064a, AL],
  [0x064b, 0x065f, NSM], [0x0660, 0x0669, AN], [0x066a, 0x066a, ET], [0x066b, 0x066c, AN],
  [0x066d, 0x066f, AL], [0x0670, 0x0670, NSM], [0x0671, 0x06d5, AL], [0x06d6, 0x06dc, NSM],
  [0x06dd, 0x06dd, AN], [0x06de, 0x06de, ON], [0x06df, 0x06e4, NSM], [0x06e5, 0x06e6, AL],
  [0x06e7, 0x06e8, NSM], [0x06e9, 0x06e9, ON], [0x06ea, 0x06ed, NSM], [0x06ee, 0x06ef, AL],
  [0x06f0, 0x06f9, EN], [0x06fa, 0x070f, AL], [0x0710, 0x0710, AL], [0x0711, 0x0711, NSM],
  [0x0712, 0x072f, AL], [0x0730, 0x074a, NSM], [0x074b, 0x07a5, AL], [0x07a6, 0x07b0, NSM],
  [0x07b1, 0x07bf, AL], [0x07c0, 0x07ea, R], [0x07eb, 0x07f3, NSM], [0x07f4, 0x07ff, R],
  [0x0800, 0x0815, R], [0x0816, 0x082d, NSM], [0x082e, 0x085f, R], [0x0860, 0x088f, AL],
  [0x0890, 0x0891, AN], [0x0892, 0x0897, AL], [0x0898, 0x089f, NSM], [0x08a0, 0x08c9, AL],
  [0x08ca, 0x08e1, NSM], [0x08e2, 0x08e2, AN], [0x08e3, 0x08ff, NSM],
  [0x2000, 0x200a, WS], [0x200b, 0x200d, BN], [0x200e, 0x200e, L], [0x200f, 0x200f, R],
  [0x2028, 0x2028, WS], [0x2029, 0x2029, B], [0x202a, 0x202e, BN], [0x202f, 0x202f, CS],
  [0x2030, 0x2034, ET], [0x2044, 0x2044, CS], [0x205f, 0x205f, WS], [0x2060, 0x206f, BN],
  [0x2070, 0x2070, EN], [0x2074, 0x2079, EN], [0x207a, 0x207b, ES], [0x2080, 0x2089, EN],
  [0x208a, 0x208b, ES], [0x20a0, 0x20cf, ET], [0x20d0, 0x20ff, NSM], [0x2212, 0x2212, ES],
  [0x2213, 0x2213, ET], [0x3000, 0x3000, WS],
  [0xfb1d, 0xfb1d, R], [0xfb1e, 0xfb1e, NSM], [0xfb1f, 0xfb28, R], [0xfb29, 0xfb29, ES],
  [0xfb2a, 0xfb4f, R], [0xfb50, 0xfd3d, AL], [0xfd3e, 0xfd4f, ON], [0xfd50, 0xfdcf, AL],
  [0xfdf0, 0xfdff, AL], [0xfe00, 0xfe0f, NSM], [0xfe20, 0xfe2f, NSM],
  [0xfe50, 0xfe50, CS], [0xfe52, 0xfe52, CS], [0xfe55, 0xfe55, CS], [0xfe5f, 0xfe5f, ET],
  [0xfe62, 0xfe63, ES], [0xfe69, 0xfe6a, ET], [0xfe70, 0xfefe, AL], [0xfeff, 0xfeff, BN],
  [0xff03, 0xff05, ET], [0xff0b, 0xff0b, ES], [0xff0c, 0xff0c, CS], [0xff0d, 0xff0d, ES],
  [0xff0e, 0xff0f, CS], [0xff10, 0xff19, EN], [0xff1a, 0xff1a, CS],
  [0x10800, 0x10cff, R], [0x10d00, 0x10d3f, AL], [0x10d40, 0x10eff, R], [0x10f00, 0x10f2f, R],
  [0x10f30, 0x10f6f, AL], [0x10f70, 0x10fff, R], [0x1e800, 0x1edff, R],
  [0x1ee00, 0x1eeff, AL], [0x1ef00, 0x1efff, R],
];

const cache = new Map();

function lookup(cp) {
  let lo = 0;
  let hi = RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = RANGES[mid];
    if (cp < r[0]) hi = mid - 1;
    else if (cp > r[1]) lo = mid + 1;
    else return r[2];
  }
  return -1;
}

export function bidiClass(cp) {
  if (cp < 0x80) return ASCII[cp];
  let c = cache.get(cp);
  if (c !== undefined) return c;
  c = lookup(cp);
  if (c < 0) {
    const ch = String.fromCodePoint(cp);
    if (/\p{M}/u.test(ch)) c = NSM;
    else if (/\p{Cf}|\p{Cc}/u.test(ch)) c = BN;
    else if (/\p{Zs}/u.test(ch)) c = WS;
    else if (/[\p{P}\p{S}]/u.test(ch)) c = ON;
    else c = L;
  }
  cache.set(cp, c);
  return c;
}

export function isRtlLetter(cp) {
  if (cp < 0x0590) return false;
  const c = bidiClass(cp);
  return c === R || c === AL;
}

const MIRROR = new Map();
for (const pair of [
  '()', '<>', '[]', '{}', '«»', '‹›', '⁅⁆', '⁽⁾', '₍₎', '∈∋', '∉∌', '∊∍', '≤≥', '≦≧',
  '≪≫', '≮≯', '≰≱', '⊂⊃', '⊆⊇', '⌈⌉', '⌊⌋', '〈〉', '❨❩', '❪❫', '❬❭', '❮❯', '❰❱',
  '❲❳', '❴❵', '⟦⟧', '⟨⟩', '⟪⟫', '⦃⦄', '⦅⦆', '〈〉', '《》', '「」', '『』', '【】',
  '〔〕', '〖〗', '〘〙', '〚〛', '（）', '＜＞', '［］', '｛｝', '｟｠', '｢｣',
]) {
  const [a, b] = [...pair].map((ch) => ch.codePointAt(0));
  MIRROR.set(a, b);
  MIRROR.set(b, a);
}

export function mirrorOf(cp) {
  return MIRROR.get(cp) ?? cp;
}

const OPEN = new Map();
const CLOSE = new Map();
for (const pair of [
  '()', '[]', '{}', '⁅⁆', '⁽⁾', '₍₎', '⌈⌉', '⌊⌋', '〈〉', '❨❩', '❪❫', '❬❭', '❮❯', '❰❱',
  '❲❳', '❴❵', '⟦⟧', '⟨⟩', '⟪⟫', '⦃⦄', '⦅⦆', '〈〉', '《》', '「」', '『』', '【】',
  '〔〕', '〖〗', '〘〙', '〚〛', '（）', '［］', '｛｝', '｟｠', '｢｣',
]) {
  const [a, b] = [...pair].map((ch) => ch.codePointAt(0));
  OPEN.set(a, b);
  CLOSE.set(b, a);
}

const strongDir = (t) => (t === L ? L : t === R || t === EN || t === AN ? R : -1);

export function resolveLevels(cps, paraLevel) {
  const n = cps.length;
  const orig = new Uint8Array(n);
  const t = new Uint8Array(n);
  for (let i = 0; i < n; i++) orig[i] = t[i] = bidiClass(cps[i]);
  const e = paraLevel & 1 ? R : L;

  for (let i = 0; i < n; i++) {
    if (t[i] === NSM || t[i] === BN) t[i] = i > 0 ? t[i - 1] : e;
  }
  let last = e;
  for (let i = 0; i < n; i++) {
    const c = t[i];
    if (c === L || c === R || c === AL) last = c;
    else if (c === EN && last === AL) t[i] = AN;
  }
  for (let i = 0; i < n; i++) if (t[i] === AL) t[i] = R;
  for (let i = 1; i < n - 1; i++) {
    const p = t[i - 1];
    const q = t[i + 1];
    if (t[i] === ES && p === EN && q === EN) t[i] = EN;
    else if (t[i] === CS && p === q && (p === EN || p === AN)) t[i] = p;
  }
  for (let i = 0; i < n; i++) {
    if (t[i] !== ET) continue;
    let j = i;
    while (j < n && t[j] === ET) j++;
    const en = (i > 0 && t[i - 1] === EN) || (j < n && t[j] === EN);
    for (let k = i; k < j; k++) t[k] = en ? EN : ON;
    i = j - 1;
  }
  for (let i = 0; i < n; i++) if (t[i] === ES || t[i] === CS || t[i] === ET) t[i] = ON;
  last = e;
  for (let i = 0; i < n; i++) {
    if (t[i] === L || t[i] === R) last = t[i];
    else if (t[i] === EN && last === L) t[i] = L;
  }

  const stack = [];
  const pairs = [];
  for (let i = 0; i < n; i++) {
    if (t[i] !== ON) continue;
    const cp = cps[i];
    if (OPEN.has(cp)) {
      if (stack.length === 63) break;
      stack.push([OPEN.get(cp), i]);
    } else if (CLOSE.has(cp)) {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k][0] === cp) {
          pairs.push([stack[k][1], i]);
          stack.length = k;
          break;
        }
      }
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [o, c] of pairs) {
    let inside = -1;
    for (let k = o + 1; k < c; k++) {
      const d = strongDir(t[k]);
      if (d === e) { inside = e; break; }
      if (d !== -1) inside = d;
    }
    if (inside === -1) {
      if (o > 0 && t[o - 1] === L && c === o + 1) { t[o] = L; t[c] = L; }
      continue;
    }
    let dir = e;
    if (inside !== e) {
      let before = e;
      for (let k = o - 1; k >= 0; k--) {
        const d = strongDir(t[k]);
        if (d !== -1) { before = d; break; }
      }
      dir = before === inside ? inside : e;
    }
    t[o] = dir;
    t[c] = dir;
  }

  const neutral = (c) => c === B || c === S || c === WS || c === ON;
  for (let i = 0; i < n; i++) {
    if (!neutral(t[i])) continue;
    let j = i;
    while (j < n && neutral(t[j])) j++;
    const before = i > 0 ? strongDir(t[i - 1]) : e;
    const after = j < n ? strongDir(t[j]) : e;
    const dir = before === after ? before : e;
    for (let k = i; k < j; k++) t[k] = dir;
    i = j - 1;
  }

  const levels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = t[i];
    if (paraLevel & 1) levels[i] = c === R ? paraLevel : paraLevel + 1;
    else levels[i] = c === L ? paraLevel : c === R ? paraLevel + 1 : paraLevel + 2;
  }
  let trailing = true;
  for (let i = n - 1; i >= 0; i--) {
    const c = orig[i];
    if (c === S || c === B) { levels[i] = paraLevel; trailing = true; }
    else if (trailing && (c === WS || c === BN)) levels[i] = paraLevel;
    else trailing = false;
  }
  return levels;
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
  const pl = paraLevel ?? firstStrongLevel(cps);
  const levels = resolveLevels(cps, pl);
  let out = '';
  for (const i of visualOrder(levels)) {
    out += String.fromCodePoint(levels[i] & 1 ? mirrorOf(cps[i]) : cps[i]);
  }
  return out;
}

export function firstStrongLevel(cps) {
  for (const cp of cps) {
    const c = bidiClass(cp);
    if (c === L) return 0;
    if (c === R || c === AL) return 1;
  }
  return 0;
}
