import {
  bidiClass, isRtlLetter, resolveLevels, visualOrder, mirrorOf, paragraphLevel, bracketType,
  L, R, AL, EN, ET, ES, AN, ON,
} from './bidi.mjs';
import { shapeCps } from './shaping.mjs';
import { cpWidth } from './width.mjs';

const DEC_SPECIAL = '◆▒␉␌␍␊°±␤␋┘┐┌└┼⎺⎻─⎼⎽├┤┴┬│≤≥π≠£·';
const CHARSETS = {
  0: (cp) => (cp >= 0x60 && cp <= 0x7e ? DEC_SPECIAL[cp - 0x60] : null),
  A: (cp) => (cp === 0x23 ? '£' : null),
};
const charsetName = (cs) => Object.keys(CHARSETS).find((k) => CHARSETS[k] === cs) || 'B';

function charsetRestore(relay, cs) {
  const g = relay.g;
  let s = `\x1b(${g[0]}`;
  const gl = relay.gl;
  if (gl !== 0) s += gl === 1 ? '\x0e' : gl === 2 ? '\x1bn' : '\x1bo';
  if ((CHARSETS[g[gl]] || null) !== cs) {
    const name = charsetName(cs);
    s += `\x1b${'()*+'[gl]}${name}`;
    g[gl] = name;
  }
  relay.cs = cs;
  return s;
}

const isFormatChar = (cp) =>
  (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2060 && cp <= 0x206f) || cp === 0xfeff || cp === 0x061c;

const isRtlText = (cp) => cp >= 0x0590 && cp !== 0x200f && cp !== 0x061c && isRtlLetter(cp);

let ATTRS = new Map();
const SGR_STEP = new Map();

function makeAttr(st, link = null) {
  const parts = [];
  if (st.b) parts.push('1');
  if (st.d) parts.push('2');
  if (st.i) parts.push('3');
  if (st.u) parts.push(st.u);
  if (st.k) parts.push(st.k);
  if (st.v) parts.push('7');
  if (st.h) parts.push('8');
  if (st.s) parts.push('9');
  if (st.o) parts.push('53');
  if (st.fg) parts.push(st.fg);
  if (st.bg) parts.push(st.bg);
  if (st.uc) parts.push(st.uc);
  const sgr = parts.join(';');
  const key = link ? `${sgr}\u0001${link}` : sgr;
  let a = ATTRS.get(key);
  if (!a) {
    if (ATTRS.size > 50000) ATTRS = new Map([['', DEFAULT_ATTR]]);
    a = {
      key,
      st,
      seq: sgr ? `\x1b[${sgr}m` : '',
      visible: Boolean(st.bg || st.v),
      bce: null,
      link,
      plain: null,
    };
    ATTRS.set(key, a);
  }
  return a;
}

export const DEFAULT_ATTR = makeAttr({});

function bceOf(a) {
  if (!a.bce) a.bce = a.st.bg ? makeAttr({ bg: a.st.bg }) : DEFAULT_ATTR;
  return a.bce;
}

function withLink(a, link) {
  return link ? makeAttr(a.st, link) : a;
}

function applySgr(attr, params) {
  const k = attr.key + '|' + params;
  let next = SGR_STEP.get(k);
  if (next) return next;
  const st = { ...attr.st };
  const p = params === '' ? ['0'] : params.split(';');
  for (let i = 0; i < p.length; i++) {
    const tok = p[i];
    const n = tok.includes(':') ? -1 : Number(tok);
    if (tok === '' || n === 0) { for (const f of Object.keys(st)) delete st[f]; continue; }
    if (tok.startsWith('4:')) { st.u = tok === '4:0' ? undefined : tok; continue; }
    if (tok.startsWith('38:')) { st.fg = tok; continue; }
    if (tok.startsWith('48:')) { st.bg = tok; continue; }
    if (tok.startsWith('58:')) { st.uc = tok; continue; }
    if (n === 38 || n === 48 || n === 58) {
      const mode = p[i + 1];
      const len = mode === '5' ? 2 : mode === '2' ? 4 : 0;
      const v = p.slice(i, i + 1 + len).join(';');
      i += len;
      if (n === 38) st.fg = v; else if (n === 48) st.bg = v; else st.uc = v;
      continue;
    }
    switch (n) {
      case 1: st.b = true; break;
      case 2: st.d = true; break;
      case 3: st.i = true; break;
      case 4: case 21: st.u = tok; break;
      case 5: case 6: st.k = tok; break;
      case 7: st.v = true; break;
      case 8: st.h = true; break;
      case 9: st.s = true; break;
      case 22: st.b = st.d = undefined; break;
      case 23: st.i = undefined; break;
      case 24: st.u = undefined; break;
      case 25: st.k = undefined; break;
      case 27: st.v = undefined; break;
      case 28: st.h = undefined; break;
      case 29: st.s = undefined; break;
      case 39: st.fg = undefined; break;
      case 49: st.bg = undefined; break;
      case 53: st.o = true; break;
      case 55: st.o = undefined; break;
      case 59: st.uc = undefined; break;
      default:
        if ((n >= 30 && n <= 37) || (n >= 90 && n <= 97)) st.fg = tok;
        else if ((n >= 40 && n <= 47) || (n >= 100 && n <= 107)) st.bg = tok;
    }
  }
  for (const f of Object.keys(st)) if (st[f] === undefined) delete st[f];
  next = makeAttr(st);
  if (SGR_STEP.size > 20000) SGR_STEP.clear();
  SGR_STEP.set(k, next);
  return next;
}

class Row {
  constructor(cols, attr = DEFAULT_ATTR, wrapped = false) {
    this.ch = new Array(cols).fill(' ');
    this.at = new Array(cols).fill(attr);
    this.rtl = false;
    this.shown = false;
    this.dirty = false;
    this.dir = 0;
    this.b0 = -1;
    this.cmap = null;
    this.cmapX = -1;
    this.wrapped = wrapped;
    this.tlen = 0;
  }

  resize(cols, keep = false) {
    const n = this.ch.length;
    if (cols < n) {
      if (keep) {
        this.tailCh = this.ch.slice(cols).concat(this.tailCh || []);
        this.tailAt = this.at.slice(cols).concat(this.tailAt || []);
      } else {
        this.tailCh = this.tailAt = null;
        if (cols > 0 && this.ch[cols - 1] !== '' && cpWidth(this.ch[cols - 1].codePointAt(0)) === 2) this.ch[cols - 1] = ' ';
      }
      this.ch.length = cols;
      this.at.length = cols;
    } else {
      for (let x = n; x < cols; x++) {
        if (this.tailCh && this.tailCh.length) {
          this.ch.push(this.tailCh.shift());
          this.at.push(this.tailAt.shift());
        } else {
          this.ch.push(' ');
          this.at.push(DEFAULT_ATTR);
        }
      }
    }
    this.tlen = Math.min(this.tlen, cols);
    this.cmap = null;
  }
}

const blankRows = (rows, cols, attr) => Array.from({ length: rows }, () => new Row(cols, attr));
const held = (row) => row.rtl || row.shown;

function defaultTabs(cols) {
  const tabs = new Set();
  for (let i = 0; i < cols; i += 8) tabs.add(i);
  return tabs;
}

function growTabs(tabs, cols) {
  let i = cols;
  if (!tabs.has(i)) {
    do i--; while (i > 0 && !tabs.has(i));
    i = Math.max(0, Math.min(i, cols - 1));
  }
  for (; i < cols; i += 8) tabs.add(i);
  return tabs;
}

const cup = (y, x) => `\x1b[${y + 1};${x + 1}H`;

const FATAL = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export class Utf8Decoder {
  constructor() {
    this.part = null;
  }

  write(buf) {
    let bytes = buf;
    if (this.part) {
      bytes = Buffer.concat([this.part, buf]);
      this.part = null;
    }
    const n = bytes.length;
    let end = n;
    for (let k = 1; k <= 3 && k <= n; k++) {
      const b = bytes[n - k];
      if ((b & 0xc0) === 0x80) continue;
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
      if (need > k) end = n - k;
      break;
    }
    let s;
    try {
      s = FATAL.decode(bytes.subarray(0, end));
      if (end < n) this.part = Buffer.from(bytes.subarray(end));
    } catch {
      s = this._slow(bytes);
    }
    return s.includes('\ufeff') ? s.replaceAll('\ufeff', '') : s;
  }

  _slow(bytes) {
    const n = bytes.length;
    const out = [];
    let s = '';
    const push = (cp) => {
      out.push(cp);
      if (out.length >= 4096) { s += String.fromCodePoint(...out); out.length = 0; }
    };
    const cont = (b) => (b & 0xc0) === 0x80;
    let i = 0;
    while (i < n) {
      const start = i;
      const b1 = bytes[i++];
      if (b1 < 0x80) { push(b1); continue; }
      const need = (b1 & 0xe0) === 0xc0 ? 2 : (b1 & 0xf0) === 0xe0 ? 3 : (b1 & 0xf8) === 0xf0 ? 4 : 0;
      if (!need) continue;
      let cp = b1 & (need === 2 ? 0x1f : need === 3 ? 0x0f : 0x07);
      let bad = false;
      for (let k = 1; k < need; k++) {
        if (i >= n) { this.part = Buffer.from(bytes.subarray(start)); return s + String.fromCodePoint(...out); }
        const b = bytes[i++];
        if (!cont(b)) { i--; bad = true; break; }
        cp = (cp << 6) | (b & 0x3f);
      }
      if (bad) continue;
      if (need === 2 && cp < 0x80) { i--; continue; }
      if (need === 3 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfeff)) continue;
      if (need === 4 && (cp < 0x10000 || cp > 0x10ffff)) continue;
      push(cp);
    }
    return s + String.fromCodePoint(...out);
  }
}

const INPUT_SEQ = /\x1b(\[|O)(\d*(?:;\d+)?)([CD])|\x1b\[<(\d+);(\d+);(\d+)([Mm])|\x1b\[M([\s\S])([\s\S])([\s\S])/g;
const PASS = true;
const DROP = false;

export class Relay {
  constructor({ cols = 80, rows = 24, cursor, visual = false, markCells = false } = {}) {
    this.visual = visual;
    this.markCells = markCells;
    this.cols = cols;
    this.rows = rows;
    this.decoder = new Utf8Decoder();
    this.pend = '';
    this.main = blankRows(rows, cols);
    this.alt = null;
    this.scr = this.main;
    this.saved = { main: null, alt: null };
    this.x = 0;
    this.y = 0;
    this.lost = false;
    this.mainLost = false;
    if (cursor === null) {
      this.lost = true;
    } else if (Array.isArray(cursor)) {
      this.y = Math.max(0, Math.min(rows - 1, cursor[0] | 0));
      this.x = Math.max(0, Math.min(cols - 1, cursor[1] | 0));
    }
    this.ty = this.y;
    this.mainY = this.y;
    this.wrap = false;
    this.tw = false;
    this.autowrap = true;
    this.origin = false;
    this.insert = false;
    this.top = 0;
    this.bot = rows - 1;
    this.attr = DEFAULT_ATTR;
    this.link = null;
    this.cell = DEFAULT_ATTR;
    this.g = ['B', 'B', 'B', 'B'];
    this.gl = 0;
    this.cs = null;
    this.tabs = defaultTabs(cols);
    this.frame = false;
    this.dirty = false;
    this.desync = false;
    this.join = 0;
    this.tjoin = false;
    this.lastRow = null;
    this.lastX = 0;
    this.inj = '';
    this.str = null;
    this.sb = Infinity;
    this.gone = null;
    this.drawing = false;
    this.parked = -1;
    this.margins = null;
    this.mainTabs = null;
    this.over = false;
    this.run = false;
    this.history = [];
  }

  push(buf) {
    const s = this.pend + this.decoder.write(buf);
    this.pend = '';
    const out = [];
    this._parse(s, out);
    if (!this.frame && !this.str) {
      const f = this._flush();
      if (f) { out.push(f); this.tjoin = false; }
    }
    return Buffer.from(out.join(''), 'utf8');
  }

  tick() {
    const f = this.str ? '' : this._flush();
    if (f) this.tjoin = false;
    return Buffer.from(f, 'utf8');
  }

  select(from, to) {
    const old = this.sel;
    this.sel = from && to ? { from, to } : null;
    for (const s of [old, this.sel]) {
      if (!s) continue;
      for (let y = Math.max(0, Math.min(s.from[0], s.to[0])); y <= Math.min(this.rows - 1, Math.max(s.from[0], s.to[0])); y++) this.scr[y].dirty = true;
      this.dirty = true;
    }
  }

  _logical([y, x]) {
    const row = this.scr[y];
    return [y, row && row.shown && row.lmap && x >= 0 && x < this.cols ? row.lmap[x] : x];
  }

  _span() {
    let a = this._logical(this.sel.from);
    let b = this._logical(this.sel.to);
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) [a, b] = [b, a];
    return [a, b];
  }

  _mark(y, at, lmap) {
    const [[y1, l1], [y2, l2]] = this._span();
    if (y < y1 || y > y2) return;
    for (let x = 0; x < this.cols; x++) {
      const l = lmap ? lmap[x] : x;
      if ((y > y1 || l >= l1) && (y < y2 || l <= l2)) at[x] = makeAttr({ ...at[x].st, v: !at[x].st.v }, at[x].link);
    }
  }

  selectedText() {
    if (!this.sel) return '';
    const [[y1, l1], [y2, l2]] = this._span();
    let text = '';
    let glued = false;
    for (let y = y1; y <= y2; y++) {
      const row = this.scr[y];
      if (!row) continue;
      const ch = row.shown && row.lch ? row.lch : row.ch;
      let line = '';
      for (let x = Math.max(0, y === y1 ? l1 : 0); x <= Math.min(this.cols - 1, y === y2 ? l2 : this.cols - 1); x++) if (ch[x] !== '') line += ch[x];
      text += glued ? line.trim() : line.trimEnd();
      glued = y < y2 && row.shown && row.x0 >= 0 && continues(this.scr[y + 1], row.x0, this.cols);
      if (y < y2) text += glued ? ' ' : '\n';
    }
    return text;
  }

  input(buf) {
    if (!buf.includes(0x1b)) return buf;
    const row = this.scr[this.y];
    const flip = Boolean(row && row.shown && row.dir === 1);
    const column = (x, y) => {
      const r = y >= 0 && y < this.rows ? this.scr[y] : null;
      return r && r.shown && r.vmap && x >= 0 && x < this.cols ? r.vmap[x] : x;
    };
    const text = buf.toString('latin1').replace(INPUT_SEQ, (m, intro, params, key, b, x, y, end, cb, cx, cy) => {
      if (key) return flip ? `\x1b${intro}${params}${key === 'C' ? 'D' : 'C'}` : m;
      if (b !== undefined) return `\x1b[<${b};${column(Number(x) - 1, Number(y) - 1) + 1};${y}${end}`;
      const nx = column(cx.charCodeAt(0) - 33, cy.charCodeAt(0) - 33) + 33;
      return nx < 256 ? `\x1b[M${cb}${String.fromCharCode(nx)}${cy}` : m;
    });
    return Buffer.from(text, 'latin1');
  }

  resize(cols, rows) {
    if (!(cols > 0 && rows > 0) || (cols === this.cols && rows === this.rows)) return;
    const onAlt = this.scr !== this.main;
    const px = this.wrap ? this.cols : this.x;
    if (rows !== this.rows) {
      this.unsure = false;
      const m = this._resizeRows(this.main, onAlt ? this.mainY : this.y, rows, true, this.saved.main);
      if (this.unsure) { if (onAlt) this.mainLost = true; else this.lost = true; }
      if (onAlt) this.mainY = m; else this.y = m;
      if (this.alt) this.y = this._resizeRows(this.alt, this.y, rows, false, this.saved.alt);
    }
    if (cols !== this.cols) {
      const reflow = this.main.some((r) => r.wrapped || r.tlen > cols);
      for (const row of this.main) row.resize(cols);
      if (this.alt) for (const row of this.alt) row.resize(cols, true);

      if (reflow) {
        for (const row of this.main) Object.assign(row, { rtl: false, shown: false, dirty: false, cmap: null, wrapped: false });
        this.history = [];
        this.sb = Infinity;
        if (onAlt) this.mainLost = true; else this.lost = true;
      }
    }
    this.cols = cols;
    this.rows = rows;
    growTabs(this.tabs, cols);
    if (this.mainTabs) growTabs(this.mainTabs, cols);
    for (const s of [this.saved.main, this.saved.alt]) if (s) s.x = Math.min(s.x, cols - 1);
    for (const buf of [this.main, this.alt]) {
      if (!buf) continue;
      for (const row of buf) if (held(row)) { row.dirty = true; this.dirty = true; }
    }
    this.top = 0;
    this.bot = rows - 1;
    this.x = Math.min(px, cols - 1);
    this.y = Math.min(this.y, rows - 1);
    this.mainY = Math.min(this.mainY, rows - 1);
    this.wrap = false;
    this.over = false;
    this.run = false;
    this.tw = false;
    this.desync = true;
    this.ty = this.y;
  }

  _resizeRows(buf, y, rows, isMain, saved) {
    while (buf.length < rows) {
      if (isMain && this.sb > 0 && y === buf.length - 1 && this.history.length) {
        const back = this.history.pop();
        back.resize(this.cols);
        buf.unshift(back);
        y++;
        this.sb--;
        if (saved) saved.y += 1;
      } else {
        if (isMain && this.sb > 0 && y === buf.length - 1) this.unsure = true;
        buf.push(new Row(this.cols));
      }
    }
    while (buf.length > rows) {
      if (y < buf.length - 1) {
        buf.pop();
      } else {
        const gone = buf.shift();
        y--;
        if (isMain) this._keep(gone);
        if (isMain && this.sb !== Infinity) this.sb++;
        if (saved) saved.y -= 1;
      }
    }
    return Math.max(0, Math.min(rows - 1, y));
  }

  _parse(s, out) {
    const n = s.length;
    let keep = 0;
    let i = 0;
    if (this.str) {
      i = this._strScan(s, 0);
      if (this.str) {
        if (this.pend) {
          out.push(s.slice(0, n - this.pend.length));
          return;
        }
        out.push(s);
        return;
      }
    }
    while (i < n) {
      const c = s.charCodeAt(i);
      let len = 1;
      let pass = PASS;
      const c1 = c >= 0x80 && c < 0xa0;
      if (c === 0x1b || (c1 && C1_INTRO.has(c))) {
        const kind = c === 0x1b ? s[i + 1] : String.fromCharCode(c - 0x40);
        if (kind === undefined) {
          if (i > keep) out.push(s.slice(keep, i));
          this.pend = s.slice(i);
          return;
        }
        if (kind === ']' || kind === 'P' || kind === '_' || kind === '^' || kind === 'X') {
          this.join = 0;
          this.run = false;
          this.str = { kind, buf: kind === ']' ? '' : null };
          const j = this._strScan(s, i + (c === 0x1b ? 2 : 1));
          if (this.str) {
            const upto = this.pend ? n - this.pend.length : n;
            if (upto > keep) out.push(s.slice(keep, upto));
            return;
          }
          len = j - i;
        } else {
          const end = c === 0x1b ? seqEnd(s, i) : csiEnd(s, i, i + 1);
          if (end < 0) {
            if (i > keep) out.push(s.slice(keep, i));
            this.pend = s.slice(i);
            return;
          }
          len = end - i;
          const seq = c === 0x1b ? s.slice(i, end) : `\x1b${kind}${s.slice(i + 1, end)}`;
          pass = this._escape(seq);
        }
      } else if (c < 0x20 || c === 0x7f || c1) {
        if (this._control(c) === DROP) pass = DROP;
      } else {
        let cp = c;
        if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
          cp = s.codePointAt(i);
          if (cp > 0xffff) len = 2;
        }
        pass = this._print(cp, len === 1 ? s[i] : s.slice(i, i + 2));
      }
      if (this.inj) {
        if (i > keep) out.push(s.slice(keep, i));
        out.push(this.inj);
        this.inj = '';
        keep = i;
      }
      if (pass === DROP) {
        if (i > keep) out.push(s.slice(keep, i));
        keep = i + len;
      } else {
        this.parked = -1;
      }
      i += len;
    }
    if (n > keep) out.push(s.slice(keep));
  }

  _strScan(s, from) {
    const n = s.length;
    const st = this.str;
    for (let j = from; j < n; j++) {
      const c = s.charCodeAt(j);
      let end = -1;
      let next = -1;
      if (c === 0x07 && st.kind === ']') { end = j; next = j + 1; }
      else if (c === 0x9c) { end = j; next = j + 1; }
      else if (c === 0x18 || c === 0x1a) { end = j; next = j + 1; st.buf = null; }
      else if (c === 0x1b) {
        if (j + 1 >= n) {
          this._strKeep(s, from, j);
          this.pend = '\x1b';
          return n;
        }
        end = j;
        next = s[j + 1] === '\\' ? j + 2 : j;
      }
      if (end >= 0) {
        this._strKeep(s, from, end);
        this.str = null;
        if (st.buf !== null && st.kind === ']') this._osc(st.buf);
        return next;
      }
    }
    this._strKeep(s, from, n);
    return n;
  }

  _strKeep(s, a, b) {
    const st = this.str;
    if (st.buf === null) return;
    if (st.buf.length + (b - a) > 8192) st.buf = null;
    else st.buf += s.slice(a, b);
  }

  _osc(body) {
    if (!body.startsWith('8;')) return;
    const k = body.indexOf(';', 2);
    if (k < 0) return;
    const uri = body.slice(k + 1);
    this.link = uri ? `${body.slice(2, k)};${uri}` : null;
    this.cell = withLink(this.attr, this.link);
  }

  _goto(y, x) {
    let s;
    if (this.lost) {
      const dy = y - this.ty;
      s = (dy < 0 ? `\x1b[${-dy}A` : dy > 0 ? `\x1b[${dy}B` : '') + `\x1b[${x + 1}G`;
    } else if (this.origin && !this.drawing) {
      s = cup(Math.max(0, y - this.top), x);
    } else {
      s = cup(y, x);
    }
    this.ty = y;
    return s;
  }

  _sync() {
    if (this.desync) {
      this.inj += this._place(this.x);
      this.desync = false;
    }
  }

  _place(cx) {
    const row = this.scr[this.y];
    if (!(this.wrap && cx === this.x && !held(row))) {
      this.tw = false;
      return this._goto(this.y, cx);
    }
    const cols = this.cols;
    let x = cols - 1;
    if (row.ch[x] === '' && x > 0) {
      x--;
    } else if (x > 0 && row.ch[x - 1] !== '' && row.ch[x - 1] !== ' ' && row.at[x - 1] === row.at[x] &&
      cpWidth(row.ch[x - 1].codePointAt(0)) === 2) {
      x--;
    }
    const a = row.at[x];
    let pre = '';
    let post = '';
    if (this.insert) { pre += '\x1b[4l'; post += '\x1b[4h'; }
    if (this.cs) {
      pre += '\x1b(B\x0f';
      post += charsetRestore(this, this.cs);
    }
    if (a.link !== this.link) {
      pre += `\x1b]8;${a.link || ';'}\x1b\\`;
      post += `\x1b]8;${this.link || ';'}\x1b\\`;
    }
    let s = this._goto(this.y, x) + pre + '\x1b[0m' + a.seq;
    for (let k = x; k < cols; k++) {
      const c = row.ch[k];
      if (c !== '') s += c;
    }
    s += post + '\x1b[0m' + this.attr.seq;
    if (this.over) s += '\u200b';
    this.tw = true;
    return s;
  }

  _open() {
    this.drawing = true;
    let s = this.frame ? '' : '\x1b[?2026h';
    if (this.insert) s += '\x1b[4l';
    if (this.origin && !this.lost) s += '\x1b[?6l';
    if (this.link) s += '\x1b]8;;\x1b\\';
    if (this.cs) s += this.gl !== 0 ? '\x1b(B\x0f' : '\x1b(B';
    return s;
  }

  _close() {
    this.drawing = false;
    let s = '\x1b[0m' + this.attr.seq;
    if (this.cs) s += charsetRestore(this, this.cs);
    if (this.link) s += `\x1b]8;${this.link}\x1b\\`;
    if (this.origin && !this.lost) { s += '\x1b[?6h'; this.ty = this.top; }
    if (this.insert) s += '\x1b[4h';
    return s;
  }

  _print(cp, ch) {
    if (cp < 0x7f && this.cs) {
      const m = this.cs(cp);
      if (m) { ch = m; cp = m.codePointAt(0); }
    }
    const w0 = cpWidth(cp);
    let w = w0;
    const cols = this.cols;
    let row = this.scr[this.y];
    if (w === 0) {
      if (this.join > 0) {
        let px = this.wrap ? this.x : this.x - 1;
        if (px > 0 && row.ch[px] === '') px -= 1;
        if (px < 0) return PASS;
        row.ch[px] += ch;
        if (held(row) || !this.tjoin || this.desync) { this._touch(row); return DROP; }
        return PASS;
      }
      if (this.wrap && !this.over) {
        this.over = true;
        if (!this.desync && !held(row)) return PASS;
        this.desync = true;
        return DROP;
      }
      w = 1;
    }
    const joinWidth = w0 === 0 ? 0 : w;
    if (this.wrap || (w === 2 && this.x === cols - 1)) {
      if (this.autowrap) {
        if (w === 2 && !this.wrap) {
          if (row.ch[cols - 1] === '' && cols > 1) row.ch[cols - 2] = ' ';
          row.ch[cols - 1] = ' ';
          row.at[cols - 1] = this.cell;
          if (held(row)) this._touch(row);
        }
        const next = this.y === this.bot ? null : this.scr[Math.min(this.y + 1, this.rows - 1)];
        const native = this.tw && !this.desync && !held(row) && !(next && held(next)) && !isRtlText(cp) &&
          !(this.y === this.bot && this.top === 0 && this.scr === this.main && this._needsDraw(this.scr[0]));
        if (!native) {
          if (this.desync) this.inj += this._goto(this.y, this.x);
          if (w === 2 && !this.wrap) this.inj += '\x1b[K';
          this._lineFeed(false);
          this.inj += '\r\n';
          this.ty = this.y;
        } else {
          this._lineFeed(true);
          this.ty = this.y;
        }
        this.x = 0;
        this.desync = false;
        this.tw = false;
        row = this.scr[this.y];
      } else if (w === 2) {
        this.wrap = false;
        this.x = cols - 1;
        if (!this.desync && !held(row)) return PASS;
        this.desync = true;
        return DROP;
      } else {
        this.run = true;
      }
      this.wrap = false;
    }
    this.over = false;
    const x = this.x;
    this._put(row, x, ch, w, w0 === 0 ? 0 : w);
    this.run = true;
    this.join = joinWidth;
    this.lastRow = row;
    this.lastX = x;
    if (!row.rtl && isRtlText(cp)) row.rtl = true;
    this.x += w;
    if (this.x >= cols) { this.x = cols - 1; this.wrap = true; }
    if (held(row)) {
      this._touch(row);
      this.desync = true;
      this.tw = false;
      this.tjoin = false;
      return DROP;
    }
    if (this.desync) {
      this.inj += this._goto(this.y, x);
      this.desync = false;
    }
    this.tw = this.wrap;
    this.tjoin = true;
    return PASS;
  }

  _put(row, x, ch, w, iw = w) {
    const cols = this.cols;
    if (row.ch[x] === '' && x > 0 && (!this.run || (this.insert && iw))) row.ch[x - 1] = ' ';
    if (this.insert && iw) {
      row.ch.splice(x, 0, ...new Array(iw).fill(' '));
      row.at.splice(x, 0, ...new Array(iw).fill(this.cell));
      row.ch.length = cols;
      row.at.length = cols;
      if (row.ch[cols - 1] !== '' && cols > 1 && row.ch[cols - 1] !== ' ' && cpWidth(row.ch[cols - 1].codePointAt(0)) === 2) row.ch[cols - 1] = ' ';
      row.tlen = Math.min(cols, row.tlen + iw);
    }
    if (w === 2) {
      if (x + 2 < cols && row.ch[x + 2] === '') row.ch[x + 2] = ' ';
      row.ch[x + 1] = '';
      row.at[x + 1] = this.cell;
    } else if (x + 1 < cols && row.ch[x + 1] === '') {
      row.ch[x + 1] = ' ';
    }
    row.ch[x] = ch;
    row.at[x] = this.cell;
    if (x + w > row.tlen) row.tlen = x + w;
  }

  _touch(row) {
    row.dirty = true;
    this.dirty = true;
  }

  _needsDraw(row) {
    return row.dirty && held(row);
  }

  _erase(row, a, b, reset = false) {
    const blank = bceOf(this.attr);
    const cols = this.cols;
    if (reset) row.tailCh = row.tailAt = null;
    if (a <= 0 && b >= cols) {
      row.ch.fill(' ');
      row.at.fill(blank);
      row.rtl = false;
      row.shown = false;
      row.dirty = false;
      row.cmap = null;
      row.tlen = 0;
      row.wrapped = false;
      return;
    }
    a = Math.max(0, a);
    b = Math.min(b, cols);
    if (a > 0 && row.ch[a] === '') row.ch[a - 1] = ' ';
    if (b < cols && (row.ch[b] === '' || (b > 0 && row.ch[b - 1] !== '' && cpWidth(row.ch[b - 1].codePointAt(0)) === 2))) row.ch[b] = ' ';
    for (let x = a; x < b; x++) {
      row.ch[x] = ' ';
      row.at[x] = blank;
    }
    if (b >= row.tlen) row.tlen = Math.min(row.tlen, a);
    if (held(row)) this._touch(row);
  }

  _lineFeed(wrapped) {
    if (this.y === this.bot) {
      this._scrollUp(this.top, this.bot, 1, wrapped, true);
    } else if (this.y < this.rows - 1) {
      this.y += 1;
      this.scr[this.y].wrapped = wrapped;
    }
  }

  _keep(row) {
    this.history.push(row);
    if (this.history.length > 1000) this.history.shift();
  }

  _savedSlot() {
    return this.scr === this.main ? 'main' : 'alt';
  }

  _scrollUp(top, bot, n, wrapped = false, feed = false) {
    n = Math.min(n, bot - top + 1);
    const blank = bceOf(this.attr);
    if (feed && top === 0) {
      for (let k = 0; k < n; k++) {
        const row = this.scr[k];
        if (this.scr === this.main) {
          if (this._needsDraw(row)) {
            this.inj += this._open() + this._drawRow(row, k, this.gone) + this._close() + this._goto(this.y, this.x) + (this.frame ? '' : '\x1b[?2026l');
            this.tw = false;
            this.desync = false;
          }
          this.gone = row;
          this._keep(row);
          if (this.sb !== Infinity) this.sb++;
        }
        const sv = this.saved.main;
        if (sv && this.scr === this.main) sv.y -= 1;
      }
    }
    this.scr.splice(top, n);
    for (let k = 0; k < n; k++) this.scr.splice(bot - n + 1 + k, 0, new Row(this.cols, blank, wrapped));
  }

  _scrollDown(top, bot, n, attr) {
    n = Math.min(n, bot - top + 1);
    this.scr.splice(bot - n + 1, n);
    for (let k = 0; k < n; k++) this.scr.splice(top, 0, new Row(this.cols, attr));
  }

  _control(c) {
    this.join = 0;
    this.run = false;
    switch (c) {
      case 0x08:
        this._sync();
        this.over = false;
        if (this.x > 0 && !this.wrap) this.x -= 1;
        else if (this.wrap) this.x = Math.max(0, this.cols - 2);
        this.wrap = false;
        break;
      case 0x09:
        if (this.wrap) return DROP;
        this._sync();
        this.x = this._nextTab(this.x);
        break;
      case 0x0a: case 0x0b: case 0x0c: {
        const over = this.over;
        this._sync();
        this._lineFeed(false);
        this.wrap = over;
        this.over = false;
        this.tw = over;
        this.ty = this.y;
        break;
      }
      case 0x0d:
        this._sync();
        this.over = false;
        this.x = 0;
        this.wrap = false;
        this.tw = false;
        break;
      case 0x0e:
        this._setGl(1);
        break;
      case 0x0f:
        this._setGl(0);
        break;
      case 0x84:
        this._escape('\x1bD');
        break;
      case 0x85:
        this._escape('\x1bE');
        break;
      case 0x88:
        this._escape('\x1bH');
        break;
      case 0x8d:
        this._escape('\x1bM');
        break;
      default:
        break;
    }
  }

  _nextTab(x) {
    for (x++; x < this.cols && !this.tabs.has(x); x++);
    return Math.min(x, this.cols - 1);
  }

  _prevTab(x) {
    for (x--; x > 0 && !this.tabs.has(x); x--);
    return Math.max(0, x);
  }

  _setGl(n) {
    this.gl = n;
    this.cs = CHARSETS[this.g[n]] || null;
  }

  _saveCursor() {
    this.saved[this._savedSlot()] = { x: this.x, y: this.y, attr: this.attr, cs: this.cs };
  }

  _restoreCursor() {
    const s = this.saved[this._savedSlot()];
    if (s) {
      this.x = Math.min(s.x, this.cols - 1);
      this.y = Math.max(0, Math.min(s.y, this.rows - 1));
      this.attr = s.attr;
      this.cs = s.cs;
    } else {
      this.x = 0;
      this.y = 0;
      this.attr = DEFAULT_ATTR;
      this.cs = null;
    }
    if (this.origin) this.y = Math.max(this.top, Math.min(this.bot, this.y));
    this.cell = withLink(this.attr, this.link);
    this.wrap = false;
    this.over = false;
    this.tw = false;
    this.desync = false;
    this.ty = this.y;
  }

  _home() {
    this.over = false;
    this.x = 0;
    this.y = this.origin ? this.top : 0;
    this.wrap = false;
    this.tw = false;
    this.desync = false;
    this._absolute();
  }

  _absolute() {
    if (this.lost && this.scr === this.main) this.mainLost = false;
    this.lost = false;
    this.ty = this.y;
  }

  _escape(seq) {
    const join = this.join;
    this.join = 0;
    this.run = false;
    const c1 = seq[1];
    if (c1 === '[') return this._csi(seq, join);
    switch (c1) {
      case '7':
        this._sync();
        this._saveCursor();
        return PASS;
      case '8':
        this._restoreCursor();
        return PASS;
      case 'D':
        this._sync();
        this.over = false;
        this._lineFeed(false);
        this.wrap = false;
        this.tw = false;
        this.ty = this.y;
        return PASS;
      case 'E':
        this._sync();
        this.over = false;
        this.x = 0;
        this._lineFeed(false);
        this.wrap = false;
        this.tw = false;
        this.ty = this.y;
        return PASS;
      case 'M':
        this._sync();
        this.over = false;
        if (this.y === this.top) this._scrollDown(this.top, this.bot, 1, bceOf(this.attr));
        else if (this.y > 0) this.y -= 1;
        this.wrap = false;
        this.tw = false;
        this.ty = this.y;
        return PASS;
      case 'H':
        this._sync();
        if (!this.wrap) this.tabs.add(this.x);
        return PASS;
      case 'c':
        this._reset();
        return PASS;
      case 'n':
        this._setGl(2);
        return PASS;
      case 'o':
        this._setGl(3);
        return PASS;
      case '(': case ')': case '*': case '+': case '-': case '.': case '/': {
        const slot = { '(': 0, ')': 1, '*': 2, '+': 3, '-': 1, '.': 2, '/': 3 }[c1];
        this.g[slot] = seq[2];
        if (slot === this.gl) this.cs = CHARSETS[seq[2]] || null;
        return PASS;
      }
      case '#':
        if (seq[2] === '8') {
          const e = this.cell;
          for (const row of this.scr) {
            row.tailCh = row.tailAt = null;
            row.ch.fill('E');
            row.at.fill(e);
            row.rtl = false;
            row.dirty = false;
            row.shown = false;
            row.cmap = null;
            row.tlen = this.cols;
            row.wrapped = false;
          }
          this._home();
        }
        return PASS;
      default:
        return PASS;
    }
  }

  _reset() {
    this.main = blankRows(this.rows, this.cols);
    this.alt = null;
    this.scr = this.main;
    this.saved = { main: null, alt: null };
    this.x = 0;
    this.y = 0;
    this.wrap = false;
    this.tw = false;
    this.autowrap = true;
    this.origin = false;
    this.insert = false;
    this.top = 0;
    this.bot = this.rows - 1;
    this.attr = DEFAULT_ATTR;
    this.link = null;
    this.cell = DEFAULT_ATTR;
    this.g = ['B', 'B', 'B', 'B'];
    this._setGl(0);
    this.tabs = defaultTabs(this.cols);
    this.frame = false;
    this.dirty = false;
    this.desync = false;
    this.sb = 0;
    this.history = [];
    this.mainLost = false;
    this._absolute();
  }

  _softReset() {
    this.top = 0;
    this.bot = this.rows - 1;
    this.attr = DEFAULT_ATTR;
    this.cell = withLink(this.attr, this.link);
    this.autowrap = true;
    this.origin = false;
    this.insert = false;
    this.g = ['B', 'B', 'B', 'B'];
    this._setGl(0);
    this.saved[this._savedSlot()] = { x: 0, y: 0, attr: DEFAULT_ATTR, cs: null };
  }

  _csi(seq, join = 0) {
    const final = seq[seq.length - 1];
    let body = seq.slice(2, -1);
    let priv = '';
    if (body && '<=>?'.includes(body[0])) { priv = body[0]; body = body.slice(1); }
    if (/[ -/]/.test(body)) {
      if (body === '!' && final === 'p' && !priv) this._softReset();
      return PASS;
    }
    if (priv === '?') {
      if (final === 'h' || final === 'l') return this._mode(body, final === 'h');
      if (final === 'J' || final === 'K') return this._csi(`\x1b[${body}${final}`);
      if (final === 'n') this._sync();
      return PASS;
    }
    if (priv) return PASS;
    if (final !== 'm' && final !== 'h' && final !== 'l' && final !== 'n' && final !== 'q' && final !== 't') this.over = false;
    if (final === 'm') {
      this.attr = applySgr(this.attr, body);
      this.cell = withLink(this.attr, this.link);
      return PASS;
    }
    const p = body === '' ? [] : body.split(';').map((v) => parseInt(v, 10) || 0);
    const n1 = p[0] || 1;
    const rows = this.rows;
    const cols = this.cols;
    switch (final) {
      case 'H': case 'f': {
        const top = this.origin ? this.top : 0;
        const bot = this.origin ? this.bot : rows - 1;
        this.y = Math.min(bot, Math.max(top, top + (p[0] || 1) - 1));
        this.x = Math.min(cols - 1, Math.max(0, (p[1] || 1) - 1));
        this.wrap = false;
        this.tw = false;
        this.desync = false;
        this._absolute();
        return PASS;
      }
      case 'A':
        this._sync();
        this.y = Math.max(this.y >= this.top ? this.top : 0, this.y - n1);
        this._moved();
        return PASS;
      case 'B': case 'e':
        this._sync();
        this.y = Math.min(this.y <= this.bot ? this.bot : rows - 1, this.y + n1);
        this._moved();
        return PASS;
      case 'C': case 'a':
        this._sync();
        this.x = Math.min(cols - 1, this.x + n1);
        this._moved();
        return PASS;
      case 'D':
        this._sync();
        this.x = Math.max(0, Math.min(this.x, cols - 1) - n1);
        this._moved();
        return PASS;
      case 'E':
        this._sync();
        this.y = Math.min(this.y <= this.bot ? this.bot : rows - 1, this.y + n1);
        this.x = 0;
        this._moved();
        return PASS;
      case 'F':
        this._sync();
        this.y = Math.max(this.y >= this.top ? this.top : 0, this.y - n1);
        this.x = 0;
        this._moved();
        return PASS;
      case 'G': case '`':
        this._sync();
        this.x = Math.min(cols - 1, n1 - 1);
        this._moved();
        return PASS;
      case 'd': {
        this._sync();
        const top = this.origin ? this.top : 0;
        const bot = this.origin ? this.bot : rows - 1;
        this.y = Math.min(bot, top + n1 - 1);
        this._moved(false);
        this._absolute();
        return PASS;
      }
      case 'I':
        if (this.wrap) return DROP;
        this._sync();
        for (let k = 0; k < n1; k++) this.x = this._nextTab(this.x);
        return PASS;
      case 'Z':
        if (this.wrap) return DROP;
        this._sync();
        for (let k = 0; k < n1; k++) this.x = this._prevTab(this.x);
        return PASS;
      case 'g':
        this._sync();
        if ((p[0] || 0) === 0) { if (!this.wrap) this.tabs.delete(this.x); } else if (p[0] === 3) this.tabs.clear();
        return PASS;
      case 'J': {
        this._sync();
        const m = p[0] || 0;
        const row = this.scr[this.y];
        const x = this.wrap ? cols : this.x;
        if (m === 0) {
          this._erase(row, x, cols);
          if (x === 0) row.wrapped = false;
          for (let y = this.y + 1; y < rows; y++) this._erase(this.scr[y], 0, cols, true);
        } else if (m === 1) {
          for (let y = 0; y < this.y; y++) this._erase(this.scr[y], 0, cols, true);
          this._erase(row, 0, x + 1);
        } else if (m === 2) {
          for (let y = 0; y < rows; y++) this._erase(this.scr[y], 0, cols, true);
        } else if (m === 3 && this.scr === this.main) {
          this.sb = 0;
          this.history = [];
        }
        return PASS;
      }
      case 'K': {
        this._sync();
        const m = p[0] || 0;
        const row = this.scr[this.y];
        const x = this.wrap ? cols : this.x;
        if (m === 0) this._erase(row, x, cols);
        else if (m === 1) this._erase(row, 0, x + 1);
        else if (m === 2) this._erase(row, 0, cols);
        return PASS;
      }
      case 'X':
        this._sync();
        this._erase(this.scr[this.y], this.x, this.x + n1);
        this.wrap = false;
        return PASS;
      case '@': case 'P': {
        this._sync();
        const row = this.scr[this.y];
        const blank = bceOf(this.attr);
        if (this.x > 0 && row.ch[this.x] === '') { row.ch[this.x - 1] = ' '; row.ch[this.x] = ' '; }
        const tail = row.tailCh ? row.tailCh.length : 0;
        const ch = tail ? row.ch.concat(row.tailCh) : row.ch;
        const at = tail ? row.at.concat(row.tailAt) : row.at;
        const len = ch.length;
        const k = Math.min(n1, len - this.x);
        if (final === '@') {
          ch.splice(this.x, 0, ...new Array(k).fill(' '));
          at.splice(this.x, 0, ...new Array(k).fill(blank));
          ch.length = len;
          at.length = len;
          if (ch[len - 1] !== '' && ch[len - 1] !== ' ' && cpWidth(ch[len - 1].codePointAt(0)) === 2) ch[len - 1] = ' ';
          row.tlen = Math.min(cols, row.tlen + k);
        } else {
          ch.splice(this.x, k);
          at.splice(this.x, k);
          for (let j = 0; j < k; j++) { ch.push(' '); at.push(blank); }
          row.tlen = Math.max(this.x, row.tlen - k);
        }
        if (tail) {
          row.ch = ch.slice(0, cols);
          row.at = at.slice(0, cols);
          row.tailCh = ch.slice(cols);
          row.tailAt = at.slice(cols);
        }
        if (row.ch[this.x] === '') row.ch[this.x] = ' ';
        this.wrap = false;
        if (held(row)) this._touch(row);
        return PASS;
      }
      case 'L': case 'M':
        this._sync();
        if (this.y >= this.top && this.y <= this.bot) {
          if (final === 'L') this._scrollDown(this.y, this.bot, n1, bceOf(this.attr));
          else this._scrollUp(this.y, this.bot, n1);
          this.x = 0;
        }
        this.wrap = false;
        this.tw = false;
        return PASS;
      case 'S':
        this._scrollUp(this.top, this.bot, n1);
        return PASS;
      case 'T':
        if (p.length <= 1) this._scrollDown(this.top, this.bot, n1, DEFAULT_ATTR);
        return PASS;
      case 'r': {
        const t = (p[0] || 1) - 1;
        let b = (p.length < 2 || p[1] > rows || p[1] === 0) ? rows : p[1];
        b -= 1;
        if (b > t) {
          this.top = t;
          this.bot = b;
          this._home();
        }
        return PASS;
      }
      case 's':
        if (body === '') { this._sync(); this._saveCursor(); }
        return PASS;
      case 'u':
        if (body === '') this._restoreCursor();
        return PASS;
      case 'b': {
        if (!join || !this.lastRow) return PASS;
        const ch = this.lastRow.ch[this.lastX] || ' ';
        let rep = '';
        const count = Math.min(n1, cols * rows);
        const cp = ch.codePointAt(0);
        for (let k = 0; k < count; k++) {
          const before = this.inj;
          this.inj = '';
          const saved = this.cs;
          this.cs = null;
          const ok = this._print(cp, ch);
          this.cs = saved;
          rep += before + this.inj + (ok ? ch : '');
          this.inj = '';
        }
        this.inj = rep;
        return DROP;
      }
      case 'h': case 'l':
        if (p.includes(4)) this.insert = final === 'h';
        return PASS;
      case 'n':
        this._sync();
        return PASS;
      default:
        return PASS;
    }
  }

  _moved(shift = true) {
    if (shift && this.origin) this.y = Math.min(this.bot, Math.max(this.top, this.top + this.y));
    this.wrap = false;
    this.over = false;
    this.tw = false;
    this.ty = this.y;
  }

  _mode(body, on) {
    if (body === '9001') return DROP;
    for (const m of body.split(';')) {
      switch (m) {
        case '6':
          this.origin = on;
          this._home();
          break;
        case '7':
          this.autowrap = on;
          break;
        case '2026':
          this.inj += this._flush();
          this.frame = on;
          break;
        case '1048':
          if (on) { this._sync(); this._saveCursor(); } else this._restoreCursor();
          break;
        case '1049': case '1047': case '47':
          this.inj += this._flush();
          this._sync();
          if (on) {
            if (m === '1049') this._saveCursor();
            if (this.scr === this.main) {
              this.mainY = this.y;
              this.mainTabs = this.tabs;
              this.tabs = defaultTabs(this.cols);
              this.margins = [this.top, this.bot];
              this.top = 0;
              this.bot = this.rows - 1;
              this.alt = blankRows(this.rows, this.cols, bceOf(this.attr));
              this.scr = this.alt;
            }
          } else {
            if (this.scr !== this.main) {
              this.scr = this.main;
              this.alt = null;
              if (this.margins) [this.top, this.bot] = this.margins;
              this.margins = null;
              if (this.mainTabs) this.tabs = this.mainTabs;
              this.mainTabs = null;
              if (this.mainLost) { this.lost = true; this.mainLost = false; }
            }
            if (m === '1049') this._restoreCursor();
          }
          break;
        default:
          break;
      }
    }
    return PASS;
  }

  _flush() {
    const scr = this.scr;
    const cur = scr[this.y];
    if (cur.shown && cur.cmapX !== this.x) { cur.dirty = true; this.dirty = true; }
    let body = '';
    if (this.dirty) {
      this.dirty = false;
      const ty = this.ty;
      const open = this._open();
      if (this.visual) {
        for (let y = 0; y + 1 < this.rows; y++) if (scr[y].dep && scr[y].shown && scr[y + 1].dirty) scr[y].dirty = true;
      }
      for (let y = 0; y < this.rows; y++) {
        const row = scr[y];
        if (!row.dirty) continue;
        body += this._drawRow(row, y, y > 0 ? scr[y - 1] : this.gone);
      }
      if (body) body = open + body + this._close();
      else { this.drawing = false; this.ty = ty; }
    }
    let cx = this.x;
    if (cur.shown && cur.cmap) cx = cur.cmap[this.x];
    if (!body && ((!this.desync && cx === this.x) || this.parked === this.y * 65536 + cx)) return '';
    let s = body;
    s += this._place(cx);
    if (body && !this.frame) s += '\x1b[?2026l';
    this.desync = cx !== this.x || (this.wrap && !this.tw);
    this.parked = this.y * 65536 + cx;
    return s;
  }

  _drawRow(row, y, above) {
    row.dirty = false;
    row.rtl = rowHasRtl(row);
    if (row.rtl) {
      const s = this._drawRtl(row, y, above);
      row.shown = true;
      return s;
    }
    row.shown = false;
    row.cmap = null;
    let at = row.at;
    if (this.sel) {
      at = row.at.slice();
      this._mark(y, at, null);
    }
    const [cells, end] = emitCells(row.ch, at, this.cols);
    row.tlen = end;
    return this._goto(y, 0) + cells;
  }

  _drawRtl(row, y, above) {
    const cols = this.cols;
    const dch = row.ch.slice();
    const dat = row.at.slice();
    const cmap = new Int16Array(cols + 1);
    for (let x = 0; x <= cols; x++) cmap[x] = x;
    const vmap = new Int16Array(cols);
    const lmap = new Int16Array(cols);
    for (let x = 0; x < cols; x++) vmap[x] = lmap[x] = x;
    const maps = { cmap, vmap, lmap, lch: row.ch.slice() };
    const cursorX = this.y === y && this.scr[this.y] === row ? this.x : -1;
    let a = 0;
    const below = this.visual && this.scr[y] === row && y + 1 < this.rows ? this.scr[y + 1] : null;
    row.dir = 0;
    row.b0 = -1;
    row.x0 = -1;
    row.dep = false;
    for (let x = 0; x <= cols; x++) {
      if (x < cols && !isColumnRule(row.ch[x])) continue;
      if (x > a) {
        const whole = a === 0 && x === cols;
        layoutSegment(row, a, x, whole, dch, dat, maps, cursorX, whole ? above : null, whole ? below : null, cols, this.visual, this.markCells);
      }
      a = x + 1;
    }
    row.cmap = cmap;
    row.vmap = vmap;
    row.lmap = lmap;
    row.lch = maps.lch;
    row.cmapX = cursorX;
    if (this.sel) this._mark(y, dat, lmap);
    const [cells, end] = emitCells(dch, dat, cols);
    row.tlen = end;
    return this._goto(y, 0) + cells;
  }
}

const C1_INTRO = new Set([0x9b, 0x9d, 0x90, 0x98, 0x9e, 0x9f]);

function rowHasRtl(row) {
  for (const ch of row.ch) {
    if (ch === '' || ch === ' ') continue;
    if (isRtlText(ch.codePointAt(0))) return true;
  }
  return false;
}

const isColumnRule = (ch) => ch === '│' || ch === '┃' || ch === '║' || ch === '┆' || ch === '┊';

const isSpace = (ch) =>
  ch === ' ' || ch === '\u00a0' || ch === '\u3000' || ch === '\u202f' ||
  ch === '\u205f' || (ch >= '\u2000' && ch <= '\u200a');
const blankCell = (ch, at) => isSpace(ch) && !at.visible;

const isMarker = (cp) => {
  if (cp === 0x20) return false;
  const c = bidiClass(cp);
  if (c !== ON && c !== ET && c !== ES) return false;
  return !'([{«“‘"\'<'.includes(String.fromCodePoint(cp));
};

const isDigit = (cp) => (cp >= 0x30 && cp <= 0x39) || (cp >= 0x660 && cp <= 0x669) || (cp >= 0x6f0 && cp <= 0x6f9);

const BIDI_FORMAT = (cp) => {
  const c = bidiClass(cp);
  return (c === L || c === R || c === AL || c >= 14) && isFormatChar(cp);
};

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function logicalText(text) {
  return text.split(/(\r?\n)/).map((part, k) => (k % 2 ? part : logicalLine(part))).join('');
}

function logicalLine(line) {
  const g = Array.from(GRAPHEMES.segment(line), (s) => s.segment);
  if (!g.some((c) => isRtlText(c.codePointAt(0)))) return line;
  let b = g.length;
  while (b > 0 && isSpace(g[b - 1])) b--;
  const [, , a] = leadOf(g, null, 0, b, true);
  const [first, last] = strongEnds(g, a, b);
  if (first < 0) return line;
  let level = first === 1 || last === 1 ? 1 : 0;
  if (labelEnd(g, null, a, b, true) > 0) level = 0;
  else if (first === 0 && last === 1 && edgeVote(g, a, 1) + edgeVote(g, b - 1, -1) < 0) level = 0;
  const levels = resolveLevels(g.slice(a, b).map((c) => c.codePointAt(0)), level, { glue: false });
  return g.slice(0, a).join('') + visualOrder(levels).map((k) => g[a + k]).join('') + g.slice(b).join('');
}

function leadOf(ch, at, a, b, loose = false) {
  const base = (x) => (ch[x] === '' ? 0x20 : ch[x].codePointAt(0));
  const blank = (x) => (loose ? isSpace(ch[x]) : blankCell(ch[x], at[x]));
  const markerEnd = (k) => {
    if (ch[k] === '[') {
      let c = k + 1;
      while (c < b && c - k < 80 && ch[c] !== ']' && !isRtlText(base(c))) c++;
      return c < b && ch[c] === ']' ? c + 1 : k;
    }
    let e = k;
    while (e < b && !blank(e) && isMarker(base(e))) e++;
    if (e === k && e < b && isDigit(base(e))) {
      let d = e;
      while (d < b && isDigit(base(d))) d++;
      if (d < b && (ch[d] === '.' || ch[d] === ')')) e = d + 1;
    }
    return e;
  };
  let m0 = a;
  while (m0 < b && blank(m0)) m0++;
  let j = markerEnd(m0);
  let b0 = m0;
  if (j > m0 && j < b && blank(j)) {
    b0 = j;
    while (b0 < b && blank(b0)) b0++;
    const k = markerEnd(b0);
    if (k > b0 && k < b && blank(k)) {
      j = k;
      b0 = k;
      while (b0 < b && blank(b0)) b0++;
    }
  }
  return [m0, j, b0];
}

function labelEnd(ch, at, x, b, loose = false) {
  let k = x;
  while (k < b && k - x < 24 && ch[k] !== '' && bidiClass(ch[k].codePointAt(0)) === L) k++;
  if (k === x || k >= b || ch[k] !== ':' || k + 1 >= b || !(loose ? isSpace(ch[k + 1]) : blankCell(ch[k + 1], at[k + 1]))) return -1;
  k++;
  while (k < b && (loose ? isSpace(ch[k]) : blankCell(ch[k], at[k]))) k++;
  return k < b ? k : -1;
}

function startsAt(row, cols) {
  const [m0, , b0] = leadOf(row.ch, row.at, 0, cols, true);
  return m0 < cols && b0 === m0 ? m0 : -1;
}

function continues(row, x0, cols) {
  const [m0, , b0] = leadOf(row.ch, row.at, 0, cols, true);
  return m0 < cols && b0 === m0 && m0 >= x0 && m0 <= x0 + 2;
}

function edgeVote(ch, x, step) {
  while (ch[x] === '') x += step;
  const cp = ch[x].codePointAt(0);
  const c = bidiClass(cp);
  if (c === L || c === R || c === AL || c === EN || c === AN) return 0;
  const bracket = bracketType(cp);
  if (bracket) return (bracket === 1) === (step > 0) ? -1 : 1;
  return step > 0 ? 1 : -1;
}

function strongEnds(ch, b0, b1) {
  let first = -1;
  let last = -1;
  for (let x = b0; x < b1; x++) {
    if (ch[x] === '') continue;
    const c = bidiClass(ch[x].codePointAt(0));
    const d = c === L ? 0 : c === R || c === AL ? 1 : -1;
    if (d < 0) continue;
    if (first < 0) first = d;
    last = d;
  }
  return [first, last];
}

function toLogical(ch, at, b0, b1, cols, level) {
  const cells = [];
  for (let x = b0; x < b1; x++) {
    if (ch[x] === '') continue;
    const w = cpWidth(ch[x].codePointAt(0)) === 2 && x + 1 < cols ? 2 : 1;
    cells.push({ ch: ch[x], at: at[x], w, x });
    if (w === 2) x++;
  }
  const levels = resolveLevels(cells.map((c) => c.ch.codePointAt(0)), level, { glue: false });
  const nch = ch.slice();
  const nat = at.slice();
  const org = new Int16Array(cols);
  for (let k = 0; k < cols; k++) org[k] = k;
  let x = b0;
  for (const k of visualOrder(levels)) {
    const c = cells[k];
    nch[x] = c.ch;
    nat[x] = c.at;
    org[x] = c.x;
    if (c.w === 2) { nch[x + 1] = ''; nat[x + 1] = c.at; org[x + 1] = c.x + 1; }
    x += c.w;
  }
  return [nch, nat, org];
}

function layoutSegment(row, a, b, whole, dch, dat, maps, cursorX, above, below, cols, visual = false, markCells = false) {
  const { cmap, vmap, lmap, lch } = maps;
  let ch = row.ch;
  let at = row.at;
  let org = null;
  const base = (x) => (ch[x] === '' ? 0x20 : ch[x].codePointAt(0));
  let [m0, j, b0] = leadOf(ch, at, a, b);
  let b1 = b;
  while (b1 > b0 && blankCell(ch[b1 - 1], at[b1 - 1])) b1--;
  const e1 = b1;
  if (visual) {
    const [v0, vj, vb] = leadOf(ch, at, a, b, true);
    let v1 = b;
    while (v1 > vb && isSpace(ch[v1 - 1])) v1--;
    let x0 = vb;
    let near = false;
    if (whole && vb > v0) x0 = vj + 1;
    else if (whole && above && above.shown && above.x0 >= 0 && vb >= above.x0) x0 = above.x0;
    else if (whole && vb > 0 && below && startsAt(below, cols) === vb - 1) { x0 = vb - 1; near = true; }
    const extra = vb > x0;
    const [first, last] = strongEnds(ch, vb, v1);
    const open = first === 0 && last === 1 && !extra;
    let level = first < 0 ? -1 : first === 1 || last === 1 ? 1 : 0;
    if (level >= 0 && labelEnd(ch, at, vb, v1, true) > 0) level = 0;
    else if (open) {
      const vote = edgeVote(ch, vb, 1) + edgeVote(ch, v1 - 1, -1);
      level = vote ? (vote > 0 ? 1 : 0) : whole && below && continues(below, x0, cols) ? 0 : 1;
    }
    if (whole) { row.x0 = x0; row.dep = open || near; }
    if (level >= 0) {
      [ch, at, org] = toLogical(ch, at, level === 1 && extra ? x0 : vb, v1, cols, level);
      [m0, j, b0] = leadOf(ch, at, a, b);
      b1 = b;
      while (b1 > b0 && blankCell(ch[b1 - 1], at[b1 - 1])) b1--;
    }
  }
  for (let x = a; x < b; x++) lch[x] = ch[x];
  if (cursorX > b1 && cursorX < b) b1 = cursorX;
  if (b1 <= b0) return;

  let rtl = false;
  const probe = [];
  for (let x = b0; x < b1; x++) {
    if (ch[x] === '') continue;
    const cp = base(x);
    if (!rtl && isRtlText(cp)) rtl = true;
    for (const c of ch[x]) probe.push(c.codePointAt(0));
  }
  if (!rtl) return;
  let pl = paragraphLevel(probe);
  const text = pl === 0 ? labelEnd(ch, at, b0, b1) : -1;
  if (text > 0) {
    const rest = [];
    for (let x = text; x < b1; x++) if (ch[x] !== '') for (const c of ch[x]) rest.push(c.codePointAt(0));
    if (paragraphLevel(rest) === 1) pl = 1;
  }
  if (pl === 0 && above && above.shown && above.dir === 1 && above.b0 === b0) pl = 1;
  if (whole) { row.dir = pl; row.b0 = b0; }

  const from = pl === 1 ? (whole ? a : m0) : b0;
  const units = [];
  for (let x = from; x < b1; x++) {
    if (ch[x] === '') continue;
    const w = cpWidth(base(x)) === 2 && x + 1 < cols ? 2 : 1;
    units.push({ x, w, text: ch[x], cp: base(x), at: at[x] });
    if (w === 2) x++;
  }

  const cps = [];
  const at0 = [];
  const bidiCps = [];
  const bidiAt = [];
  for (const u of units) {
    at0.push(cps.length);
    bidiAt.push(bidiCps.length);
    let first = true;
    for (const c of u.text) {
      const cp = c.codePointAt(0);
      cps.push(cp);
      if (first || BIDI_FORMAT(cp)) bidiCps.push(cp);
      first = false;
    }
  }
  const shaped = shapeCps(cps);
  const bidiLevels = resolveLevels(bidiCps, pl);
  const levels = new Uint8Array(units.length);
  for (let k = 0; k < units.length; k++) levels[k] = bidiLevels[bidiAt[k]];
  const glyph = new Array(units.length).fill(null);
  for (let k = 0; k < units.length; k++) {
    const s = shaped[at0[k]];
    const end = k + 1 < units.length ? at0[k + 1] : cps.length;
    let tail = '';
    for (let m = at0[k] + 1; m < end; m++) {
      if (!isFormatChar(cps[m]) && shaped[m] >= 0) tail += String.fromCodePoint(shaped[m]);
    }
    if (s < 0) {
      if (k > 0 && glyph[k - 1] !== null) glyph[k - 1] += tail;
      continue;
    }
    if (isFormatChar(s) || cpWidth(s) === 0) continue;
    glyph[k] = String.fromCodePoint(levels[k] & 1 ? mirrorOf(s) : s) + tail;
  }

  let width = 0;
  let marks = 0;
  for (let k = 0; k < units.length; k++) {
    if (glyph[k] === null) continue;
    width += units[k].w;
    if (markCells) marks += [...glyph[k]].length - 1;
  }
  const limit = whole ? cols - 2 : b - 2;
  const start = pl === 1 ? Math.max(from, limit - width - marks + 1) : from;
  const fill = bceOf(b1 < b ? at[b1] : at[from]);

  for (let x = from; x < Math.max(b1, e1); x++) { dch[x] = ' '; dat[x] = fill; }
  const vis = new Int16Array(units.length).fill(-1);
  let col = start;
  for (const k of visualOrder(levels)) {
    if (glyph[k] === null) continue;
    const u = units[k];
    if (col + u.w > cols) break;
    dch[col] = glyph[k];
    dat[col] = u.at;
    if (u.w === 2) { dch[col + 1] = ''; dat[col + 1] = u.at; }
    vis[k] = col;
    col += u.w;
  }

  let lo = cols;
  let hi = -1;
  for (let k = 0; k < units.length; k++) {
    if (vis[k] < 0) continue;
    const p = org ? org[units[k].x] : units[k].x;
    for (let w = 0; w < units[k].w; w++) {
      vmap[vis[k] + w] = p + w;
      lmap[vis[k] + w] = units[k].x + w;
    }
    lo = Math.min(lo, vis[k]);
    hi = Math.max(hi, vis[k] + units[k].w - 1);
  }
  if (hi >= 0) {
    for (let x = from; x < b; x++) {
      if (x < lo) {
        vmap[x] = vmap[lo];
        if (pl === 1) lmap[x] = cols;
      } else if (x > hi && pl === 1) {
        vmap[x] = vmap[hi];
        lmap[x] = -1;
      }
    }
  }

  let k = 0;
  for (let x = from; x <= b1; x++) {
    while (k < units.length && units[k].x < x) k++;
    let c;
    let u = k - 1;
    while (u >= 0 && vis[u] < 0) u--;
    if (u < 0) {
      c = pl === 1 ? start + width : start;
    } else {
      c = levels[u] & 1 ? vis[u] - 1 : vis[u] + units[u].w;
    }
    cmap[x] = Math.max(0, Math.min(cols - 1, c));
  }
}

function emitCells(ch, at, cols) {
  let end = cols;
  while (end > 0 && blankCell(ch[end - 1], at[end - 1]) && at[end - 1] === DEFAULT_ATTR) end--;
  let s = '';
  let cur = null;
  let link = null;
  for (let x = 0; x < end; x++) {
    let c = ch[x];
    if (c === '') continue;
    const a = at[x];
    if (a !== cur) {
      if (a.link !== link) {
        if (link) s += '\x1b]8;;\x1b\\';
        link = a.link;
        if (link) s += `\x1b]8;${link}\x1b\\`;
      }
      if (!cur || a.seq !== cur.seq) s += '\x1b[0m' + a.seq;
      cur = a;
    }
    const cw = cpWidth(c.codePointAt(0));
    if (cw === 0 || (cw === 2 && x === cols - 1)) c = ' ';
    s += c;
    if (x + 2 < cols && ch[x + 1] === '') s += `\x1b[${x + 3}G`;
  }
  if (link) s += '\x1b]8;;\x1b\\';
  s += '\x1b[0m';
  if (end < cols) s += '\x1b[K';
  return [s, end];
}

function csiEnd(s, i, from) {
  const n = s.length;
  for (let j = from; j < n; j++) {
    const c = s.charCodeAt(j);
    if (c >= 0x40 && c <= 0x7e) return j + 1;
    if (c < 0x20 || c > 0x7e) return j;
  }
  return -1;
}

function seqEnd(s, i) {
  const n = s.length;
  if (i + 1 >= n) return -1;
  const c1 = s[i + 1];
  if (c1 === '[') return csiEnd(s, i, i + 2);
  if (c1 < ' ') return i + 1;
  if ('()*+-./#% '.includes(c1)) return i + 3 <= n ? i + 3 : -1;
  return i + 2;
}
