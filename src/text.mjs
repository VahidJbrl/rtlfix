import { isRtlLetter, paragraphLevel, resolveLevels, visualOrder, mirrorOf } from './bidi.mjs';
import { shapeCps } from './shaping.mjs';
import { cpWidth } from './width.mjs';

const ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[ -/]*[0-~]?)/y;

const isFormatChar = (cp) =>
  (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2060 && cp <= 0x206f) || cp === 0xfeff || cp === 0x061c;

export function hasRtl(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x590 && cp !== 0x200f && cp !== 0x61c && isRtlLetter(cp)) return true;
  }
  return false;
}

export function newState() {
  return { sgr: '', link: '' };
}

function applyEscape(state, seq) {
  if (seq.endsWith('m') && seq.startsWith('\x1b[')) {
    const body = seq.slice(2, -1);
    if (body === '' || body === '0') state.sgr = '';
    else state.sgr += seq;
    return true;
  }
  if (seq.startsWith('\x1b]8;')) {
    const end = seq.endsWith('\x07') ? -1 : -2;
    const rest = seq.slice(4, end);
    const k = rest.indexOf(';');
    state.link = k >= 0 && rest.slice(k + 1) ? seq : '';
    return true;
  }
  return false;
}

export function tokenize(line, state) {
  const cells = [];
  let other = '';
  let i = 0;
  while (i < line.length) {
    if (line.charCodeAt(i) === 0x1b) {
      ESCAPE.lastIndex = i;
      const m = ESCAPE.exec(line);
      const seq = m ? m[0] : '\x1b';
      if (!applyEscape(state, seq)) other += seq;
      i += seq.length;
      continue;
    }
    const cp = line.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (cells.length && cp !== 0x09 && cpWidth(cp) === 0 && !isFormatChar(cp) && cp >= 0x20) {
      cells[cells.length - 1].extra.push(cp);
      continue;
    }
    cells.push({ cp, extra: [], sgr: state.sgr, link: state.link });
  }
  return { cells, other };
}

function render(cells, order, glyph) {
  let s = '';
  let sgr = '';
  let link = '';
  let styled = false;
  for (const k of order) {
    const g = glyph[k];
    if (g === null) continue;
    const c = cells[k];
    if (c.link !== link) {
      if (link) s += '\x1b]8;;\x1b\\';
      link = c.link;
      if (link) s += link;
    }
    if (c.sgr !== sgr) {
      s += '\x1b[0m' + c.sgr;
      sgr = c.sgr;
      styled = true;
    }
    s += g;
  }
  if (link) s += '\x1b]8;;\x1b\\';
  return { s, styled };
}

function shapeCells(cells) {
  const cps = [];
  const at = [];
  for (const c of cells) {
    at.push(cps.length);
    cps.push(c.cp);
    for (const e of c.extra) cps.push(e);
  }
  const shaped = shapeCps(cps);
  return cells.map((c, k) => {
    const s = shaped[at[k]];
    if (s < 0 || isFormatChar(s)) return null;
    let g = String.fromCodePoint(s);
    const end = k + 1 < cells.length ? at[k + 1] : cps.length;
    for (let m = at[k] + 1; m < end; m++) if (shaped[m] >= 0) g += String.fromCodePoint(shaped[m]);
    return g;
  });
}

export function lineWidth(text) {
  let w = 0;
  for (const ch of text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[ -/]*[0-~])/g, '')) {
    const cp = ch.codePointAt(0);
    w = cp === 0x09 ? (Math.floor(w / 8) + 1) * 8 : w + cpWidth(cp);
  }
  return w;
}

export function transformLine(line, { mode = 'visual', state = newState(), level = null, align = 0 } = {}) {
  const cr = line.endsWith('\r');
  const body = cr ? line.slice(0, -1) : line;
  const before = { ...state };
  if (!hasRtl(body)) {
    if (body.includes('\x1b')) tokenize(body, state);
    return { text: line, level: null };
  }
  const { cells, other } = tokenize(body, { ...before });
  tokenize(body, state);
  const glyph = shapeCells(cells);
  let order = cells.map((_, k) => k);
  let pl = 0;
  if (mode !== 'logical') {
    const cps = cells.map((c) => c.cp);
    pl = level ?? paragraphLevel(cps);
    const levels = resolveLevels(cps, pl);
    order = visualOrder(levels);
    for (let k = 0; k < cells.length; k++) {
      if (levels[k] & 1 && glyph[k] !== null) {
        const base = glyph[k].codePointAt(0);
        const m = mirrorOf(base);
        if (m !== base) glyph[k] = String.fromCodePoint(m) + glyph[k].slice(String.fromCodePoint(base).length);
      }
    }
  }
  const { s, styled } = render(cells, order, glyph);
  let text = other + s;
  if (styled || before.sgr || state.sgr) text += '\x1b[0m' + state.sgr;
  if (state.link) text += state.link;
  if (align > 0 && pl === 1) {
    const pad = align - lineWidth(text);
    if (pad > 0) text = ' '.repeat(pad) + text;
  }
  return { text: text + (cr ? '\r' : ''), level: pl };
}

export function visualText(text, opts = {}) {
  const state = newState();
  return text.split('\n').map((line) => transformLine(line, { ...opts, state }).text).join('\n');
}

export function wrapLine(line, width) {
  const cr = line.endsWith('\r');
  const body = cr ? line.slice(0, -1) : line;
  if (width <= 0 || lineWidth(body) <= width) return [line];
  const tokens = body.match(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[ -/]*[0-~])| +|[^ \x1b]+/g) || [];
  const lines = [];
  let cur = '';
  let curW = 0;
  let pend = '';
  const push = () => { lines.push(cur); cur = ''; curW = 0; };
  for (const t of tokens) {
    if (t.startsWith('\x1b')) { cur += t; continue; }
    if (t.startsWith(' ')) { pend += t; continue; }
    const tw = lineWidth(t);
    if (curW > 0 && curW + pend.length + tw > width) {
      push();
      pend = '';
    }
    if (tw > width) {
      cur += pend;
      curW += pend.length;
      pend = '';
      for (const ch of t) {
        const cw = cpWidth(ch.codePointAt(0));
        if (curW + cw > width && curW > 0) push();
        cur += ch;
        curW += cw;
      }
      continue;
    }
    cur += pend + t;
    curW += pend.length + tw;
    pend = '';
  }
  if (cur !== '' || lines.length === 0) lines.push(cur);
  return cr ? lines.map((l) => l + '\r') : lines;
}

export function wrapText(text, width) {
  if (width <= 0) return text;
  return text.split('\n').flatMap((l) => wrapLine(l, width)).join('\n');
}
