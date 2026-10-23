import { StringDecoder } from 'node:string_decoder';
import {
  bidiClass, isRtlLetter, resolveLevels, visualOrder, mirrorOf,
  L, R, AL, EN, AN, ES, ET, ON,
} from './bidi.mjs';
import { shapeCps } from './shaping.mjs';
import { cpWidth } from './width.mjs';

const isFormatChar = (cp) =>
  (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2060 && cp <= 0x206f) || cp === 0xfeff || cp === 0x061c;

const ATTRS = new Map();
const SGR_STEP = new Map();

function makeAttr(st) {
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
  const key = parts.join(';');
  let a = ATTRS.get(key);
  if (!a) {
    a = {
      key,
      st,
      seq: key ? `\x1b[${key}m` : '',
      visible: Boolean(st.bg || st.v),
      bce: null,
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
  constructor(cols, attr = DEFAULT_ATTR) {
    this.ch = new Array(cols).fill(' ');
    this.at = new Array(cols).fill(attr);
    this.rtl = false;
    this.shown = false;
    this.dirty = false;
    this.dir = 0;
    this.b0 = -1;
    this.cmap = null;
    this.cmapX = -1;
  }

  resize(cols) {
    const n = this.ch.length;
    if (cols < n) {
      this.ch.length = cols;
      this.at.length = cols;
      if (cols > 0 && this.ch[cols - 1] !== '' && cpWidth(this.ch[cols - 1].codePointAt(0)) === 2) {
        this.ch[cols - 1] = ' ';
      }
    } else {
      for (let x = n; x < cols; x++) { this.ch.push(' '); this.at.push(DEFAULT_ATTR); }
    }
    this.cmap = null;
  }
}

const blankRows = (rows, cols) => Array.from({ length: rows }, () => new Row(cols));

const cup = (y, x) => `\x1b[${y + 1};${x + 1}H`;

const PASS = true;
const DROP = false;

export class Relay {
  constructor({ cols = 80, rows = 24 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.decoder = new StringDecoder('utf8');
    this.pend = '';
    this.main = blankRows(rows, cols);
    this.alt = blankRows(rows, cols);
    this.scr = this.main;
    this.x = 0;
    this.y = 0;
    this.wrap = false;
    this.autowrap = true;
    this.top = 0;
    this.bot = rows - 1;
    this.attr = DEFAULT_ATTR;
    this.saved = null;
    this.frame = false;
    this.dirty = false;
    this.desync = false;
    this.lastCh = ' ';
    this.inj = '';
  }

  push(buf) {
    const s = this.pend + this.decoder.write(buf);
    this.pend = '';
    const out = [];
    this._parse(s, out);
    if (!this.frame) out.push(this._flush());
    return Buffer.from(out.join(''), 'utf8');
  }

  tick() {
    return Buffer.from(this._flush(), 'utf8');
  }

  resize(cols, rows) {
    if (!(cols > 0 && rows > 0) || (cols === this.cols && rows === this.rows)) return;
    for (const buf of [this.main, this.alt]) {
      while (buf.length > rows) buf.pop();
      while (buf.length < rows) buf.push(new Row(this.cols));
      for (const row of buf) {
        row.resize(cols);
        if (row.rtl || row.shown) { row.dirty = true; this.dirty = true; }
      }
    }
    this.cols = cols;
    this.rows = rows;
    this.top = 0;
    this.bot = rows - 1;
    this.x = Math.min(this.x, cols - 1);
    this.y = Math.min(this.y, rows - 1);
    this.wrap = false;
    this.desync = true;
  }

  _parse(s, out) {
    const n = s.length;
    let keep = 0;
    let i = 0;
    while (i < n) {
      const c = s.charCodeAt(i);
      let len = 1;
      let pass = PASS;
      if (c === 0x1b) {
        const end = seqEnd(s, i);
        if (end < 0) {
          if (i > keep) out.push(s.slice(keep, i));
          this.pend = s.slice(i);
          return;
        }
        len = end - i;
        pass = this._escape(s.slice(i, end));
      } else if (c < 0x20 || c === 0x7f || (c >= 0x80 && c < 0xa0)) {
        this._control(c);
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
      }
      i += len;
    }
    if (n > keep) out.push(s.slice(keep));
  }

  _sync() {
    if (this.desync) {
      this.inj += cup(this.y, this.x);
      this.desync = false;
    }
  }

  _print(cp, ch) {
    const w = cpWidth(cp);
    const cols = this.cols;
    if (w === 0) {
      let px = this.wrap ? this.x : this.x - 1;
      const row = this.scr[this.y];
      if (px > 0 && row.ch[px] === '') px -= 1;
      if (px < 0) return PASS;
      row.ch[px] += ch;
      if (row.rtl || row.shown) { this._touch(row); return DROP; }
      this._sync();
      return PASS;
    }
    if (this.wrap || (w === 2 && this.x === cols - 1)) {
      if (this.autowrap) {
        this.inj += (this.desync ? cup(this.y, this.x) : '') + '\r\n';
        this.desync = false;
        this.x = 0;
        this._index();
      } else if (w === 2) {
        return PASS;
      }
      this.wrap = false;
    }
    const row = this.scr[this.y];
    const x = this.x;
    this._put(row, x, ch, w);
    this.lastCh = ch;
    if (!row.rtl && cp >= 0x590 && isRtlLetter(cp)) row.rtl = true;
    this.x += w;
    if (this.x >= cols) { this.x = cols - 1; this.wrap = true; }
    if (row.rtl || row.shown) {
      this._touch(row);
      this.desync = true;
      return DROP;
    }
    if (this.desync) {
      this.inj += cup(this.y, x);
      this.desync = false;
    }
    return PASS;
  }

  _put(row, x, ch, w) {
    const cols = this.cols;
    if (row.ch[x] === '' && x > 0) row.ch[x - 1] = ' ';
    if (w === 2) {
      if (x + 2 < cols && row.ch[x + 2] === '') row.ch[x + 2] = ' ';
      row.ch[x + 1] = '';
      row.at[x + 1] = this.attr;
    } else if (x + 1 < cols && row.ch[x + 1] === '') {
      row.ch[x + 1] = ' ';
    }
    row.ch[x] = ch;
    row.at[x] = this.attr;
  }

  _touch(row) {
    row.dirty = true;
    this.dirty = true;
  }

  _erase(row, a, b) {
    const blank = bceOf(this.attr);
    if (a <= 0 && b >= this.cols) {
      row.ch.fill(' ');
      row.at.fill(blank);
      row.rtl = false;
      row.shown = false;
      row.dirty = false;
      row.cmap = null;
      return;
    }
    if (a > 0 && row.ch[a] === '') row.ch[a - 1] = ' ';
    if (b < this.cols && row.ch[b] === '') row.ch[b] = ' ';
    for (let x = Math.max(0, a); x < Math.min(b, this.cols); x++) {
      row.ch[x] = ' ';
      row.at[x] = blank;
    }
    if (row.rtl || row.shown) this._touch(row);
  }

  _index() {
    if (this.y === this.bot) this._scrollUp(this.top, this.bot, 1);
    else if (this.y < this.rows - 1) this.y += 1;
  }

  _scrollUp(top, bot, n) {
    n = Math.min(n, bot - top + 1);
    const blank = bceOf(this.attr);
    this.scr.splice(top, n);
    for (let k = 0; k < n; k++) this.scr.splice(bot - n + 1 + k, 0, new Row(this.cols, blank));
  }

  _scrollDown(top, bot, n) {
    n = Math.min(n, bot - top + 1);
    const blank = bceOf(this.attr);
    this.scr.splice(bot - n + 1, n);
    for (let k = 0; k < n; k++) this.scr.splice(top, 0, new Row(this.cols, blank));
  }

  _control(c) {
    switch (c) {
      case 0x08:
        this._sync();
        if (this.x > 0) this.x -= 1;
        this.wrap = false;
        break;
      case 0x09:
        this._sync();
        this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8);
        this.wrap = false;
        break;
      case 0x0a: case 0x0b: case 0x0c:
        this._sync();
        this._index();
        this.wrap = false;
        break;
      case 0x0d:
        this._sync();
        this.x = 0;
        this.wrap = false;
        break;
      default:
        break;
    }
  }

  _escape(seq) {
    const c1 = seq[1];
    if (c1 === '[') return this._csi(seq);
    if (c1 === ']' || c1 === 'P' || c1 === '_' || c1 === '^' || c1 === 'X') return PASS;
    switch (c1) {
      case '7':
        this.saved = { x: this.x, y: this.y, attr: this.attr, wrap: this.wrap };
        this._sync();
        return PASS;
      case '8':
        this._restoreCursor();
        return PASS;
      case 'D':
        this._sync();
        this._index();
        this.wrap = false;
        return PASS;
      case 'E':
        this._sync();
        this.x = 0;
        this._index();
        this.wrap = false;
        return PASS;
      case 'M':
        this._sync();
        if (this.y === this.top) this._scrollDown(this.top, this.bot, 1);
        else if (this.y > 0) this.y -= 1;
        this.wrap = false;
        return PASS;
      case 'c':
        this._reset();
        return PASS;
      default:
        return PASS;
    }
  }

  _restoreCursor() {
    const s = this.saved;
    if (s) {
      this.x = Math.min(s.x, this.cols - 1);
      this.y = Math.min(s.y, this.rows - 1);
      this.attr = s.attr;
      this.wrap = s.wrap;
    } else {
      this.x = 0;
      this.y = 0;
      this.attr = DEFAULT_ATTR;
      this.wrap = false;
    }
    this.desync = false;
  }

  _reset() {
    this.main = blankRows(this.rows, this.cols);
    this.alt = blankRows(this.rows, this.cols);
    this.scr = this.main;
    this.x = 0;
    this.y = 0;
    this.wrap = false;
    this.autowrap = true;
    this.top = 0;
    this.bot = this.rows - 1;
    this.attr = DEFAULT_ATTR;
    this.saved = null;
    this.frame = false;
    this.dirty = false;
    this.desync = false;
  }

  _csi(seq) {
    const final = seq[seq.length - 1];
    let body = seq.slice(2, -1);
    let priv = '';
    if (body && '<=>?'.includes(body[0])) { priv = body[0]; body = body.slice(1); }
    if (/[ -/]/.test(body)) return PASS;
    if (priv === '?') {
      if (final === 'h' || final === 'l') return this._mode(body, final === 'h');
      return PASS;
    }
    if (priv) return PASS;
    if (final === 'm') {
      this.attr = applySgr(this.attr, body);
      return PASS;
    }
    const p = body === '' ? [] : body.split(';').map((v) => parseInt(v, 10) || 0);
    const n1 = p[0] || 1;
    const rows = this.rows;
    const cols = this.cols;
    switch (final) {
      case 'H': case 'f':
        this.y = Math.min(rows - 1, Math.max(0, (p[0] || 1) - 1));
        this.x = Math.min(cols - 1, Math.max(0, (p[1] || 1) - 1));
        this.wrap = false;
        this.desync = false;
        return PASS;
      case 'A':
        this._sync();
        this.y = Math.max(this.y >= this.top ? this.top : 0, this.y - n1);
        this.wrap = false;
        return PASS;
      case 'B': case 'e':
        this._sync();
        this.y = Math.min(this.y <= this.bot ? this.bot : rows - 1, this.y + n1);
        this.wrap = false;
        return PASS;
      case 'C': case 'a':
        this._sync();
        this.x = Math.min(cols - 1, this.x + n1);
        this.wrap = false;
        return PASS;
      case 'D':
        this._sync();
        this.x = Math.max(0, this.x - n1);
        this.wrap = false;
        return PASS;
      case 'E':
        this._sync();
        this.y = Math.min(this.y <= this.bot ? this.bot : rows - 1, this.y + n1);
        this.x = 0;
        this.wrap = false;
        return PASS;
      case 'F':
        this._sync();
        this.y = Math.max(this.y >= this.top ? this.top : 0, this.y - n1);
        this.x = 0;
        this.wrap = false;
        return PASS;
      case 'G': case '`':
        this._sync();
        this.x = Math.min(cols - 1, n1 - 1);
        this.wrap = false;
        return PASS;
      case 'd':
        this._sync();
        this.y = Math.min(rows - 1, n1 - 1);
        this.wrap = false;
        return PASS;
      case 'J': {
        this._sync();
        const m = p[0] || 0;
        const row = this.scr[this.y];
        if (m === 0) {
          this._erase(row, this.x, cols);
          for (let y = this.y + 1; y < rows; y++) this._erase(this.scr[y], 0, cols);
        } else if (m === 1) {
          for (let y = 0; y < this.y; y++) this._erase(this.scr[y], 0, cols);
          this._erase(row, 0, this.x + 1);
        } else {
          for (let y = 0; y < rows; y++) this._erase(this.scr[y], 0, cols);
        }
        return PASS;
      }
      case 'K': {
        this._sync();
        const m = p[0] || 0;
        const row = this.scr[this.y];
        if (m === 0) this._erase(row, this.x, cols);
        else if (m === 1) this._erase(row, 0, this.x + 1);
        else this._erase(row, 0, cols);
        return PASS;
      }
      case 'X':
        this._sync();
        this._erase(this.scr[this.y], this.x, this.x + n1);
        return PASS;
      case '@': case 'P': {
        this._sync();
        const row = this.scr[this.y];
        const k = Math.min(n1, cols - this.x);
        const blank = bceOf(this.attr);
        if (final === '@') {
          row.ch.splice(this.x, 0, ...new Array(k).fill(' '));
          row.at.splice(this.x, 0, ...new Array(k).fill(blank));
          row.ch.length = cols;
          row.at.length = cols;
        } else {
          row.ch.splice(this.x, k);
          row.at.splice(this.x, k);
          for (let j = 0; j < k; j++) { row.ch.push(' '); row.at.push(blank); }
        }
        if (row.ch[this.x] === '') row.ch[this.x] = ' ';
        if (row.rtl || row.shown) this._touch(row);
        return PASS;
      }
      case 'L': case 'M':
        this._sync();
        if (this.y >= this.top && this.y <= this.bot) {
          if (final === 'L') this._scrollDown(this.y, this.bot, n1);
          else this._scrollUp(this.y, this.bot, n1);
          this.x = 0;
        }
        this.wrap = false;
        return PASS;
      case 'S':
        this._scrollUp(this.top, this.bot, n1);
        return PASS;
      case 'T':
        if (p.length <= 1) this._scrollDown(this.top, this.bot, n1);
        return PASS;
      case 'r': {
        const t = (p[0] || 1) - 1;
        const b = (p[1] || rows) - 1;
        if (t < b && b < rows) { this.top = t; this.bot = b; }
        else { this.top = 0; this.bot = rows - 1; }
        this.x = 0;
        this.y = 0;
        this.wrap = false;
        this.desync = false;
        return PASS;
      }
      case 's':
        if (body === '') {
          this.saved = { x: this.x, y: this.y, attr: this.attr, wrap: this.wrap };
          this._sync();
        }
        return PASS;
      case 'u':
        if (body === '') this._restoreCursor();
        return PASS;
      case 'b': {
        let rep = '';
        const ch = this.lastCh;
        for (let k = 0; k < Math.min(n1, cols * rows); k++) {
          const before = this.inj;
          this.inj = '';
          const ok = this._print(ch.codePointAt(0), ch);
          rep += before + this.inj + (ok ? ch : '');
          this.inj = '';
        }
        this.inj = rep;
        return DROP;
      }
      case 'n':
        this._sync();
        return PASS;
      default:
        return PASS;
    }
  }

  _mode(body, on) {
    for (const m of body.split(';')) {
      switch (m) {
        case '7':
          this.autowrap = on;
          break;
        case '2026':
          if (on) {
            this.inj += this._flush();
            this.frame = true;
          } else {
            this.inj += this._flush();
            this.frame = false;
          }
          break;
        case '1049': case '1047': case '47':
          if (on && this.scr !== this.alt) {
            if (m === '1049') this.saved = { x: this.x, y: this.y, attr: this.attr, wrap: this.wrap };
            this._sync();
            this.alt = blankRows(this.rows, this.cols);
            this.scr = this.alt;
          } else if (!on && this.scr === this.alt) {
            this.scr = this.main;
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
    let s = '';
    const cur = scr[this.y];
    if (cur.shown && cur.cmapX !== this.x) { cur.dirty = true; this.dirty = true; }
    if (this.dirty) {
      this.dirty = false;
      for (let y = 0; y < this.rows; y++) {
        const row = scr[y];
        if (!row.dirty) continue;
        row.dirty = false;
        row.rtl = rowHasRtl(row);
        if (row.rtl) {
          s += this._drawRtl(row, y, y > 0 ? scr[y - 1] : null);
          row.shown = true;
        } else {
          s += emitRow(y, row.ch, row.at, this.cols);
          row.shown = false;
          row.cmap = null;
        }
      }
    }
    let cx = this.x;
    if (cur.shown && cur.cmap) cx = cur.cmap[this.x];
    if (s || this.desync || cx !== this.x) {
      s += '\x1b[0m' + this.attr.seq + cup(this.y, cx);
      this.desync = cx !== this.x || this.wrap;
    }
    return s;
  }

  _drawRtl(row, y, above) {
    const cols = this.cols;
    const dch = row.ch.slice();
    const dat = row.at.slice();
    const cmap = new Int16Array(cols + 1);
    for (let x = 0; x <= cols; x++) cmap[x] = x;
    const cursorX = this.y === y ? this.x : -1;
    let a = 0;
    row.dir = 0;
    row.b0 = -1;
    for (let x = 0; x <= cols; x++) {
      if (x < cols && !isColumnRule(row.ch[x])) continue;
      if (x > a) {
        const whole = a === 0 && x === cols;
        layoutSegment(row, a, x, whole, dch, dat, cmap, cursorX, whole ? above : null, cols);
      }
      a = x + 1;
    }
    row.cmap = cmap;
    row.cmapX = cursorX;
    return emitRow(y, dch, dat, cols);
  }
}

function rowHasRtl(row) {
  for (const ch of row.ch) {
    if (ch === '' || ch === ' ') continue;
    const cp = ch.codePointAt(0);
    if (cp >= 0x590 && isRtlLetter(cp)) return true;
  }
  return false;
}

const isColumnRule = (ch) => ch === '│' || ch === '┃' || ch === '║' || ch === '┆' || ch === '┊';

const isSpace = (ch) =>
  ch === ' ' || ch === '' || ch === '\u00a0' || ch === '\u3000' || ch === '\u202f' ||
  ch === '\u205f' || (ch >= '\u2000' && ch <= '\u200a');
const blankCell = (ch, at) => isSpace(ch) && !at.visible;

const isMarker = (cp) => {
  if (cp === 0x20) return false;
  const c = bidiClass(cp);
  if (c !== ON && c !== ET && c !== ES) return false;
  return !'([{«“‘"\'<'.includes(String.fromCodePoint(cp));
};

const isDigit = (cp) => (cp >= 0x30 && cp <= 0x39) || (cp >= 0x660 && cp <= 0x669) || (cp >= 0x6f0 && cp <= 0x6f9);

function layoutSegment(row, a, b, whole, dch, dat, cmap, cursorX, above, cols) {
  const ch = row.ch;
  const at = row.at;
  const base = (x) => (ch[x] === '' ? 0x20 : ch[x].codePointAt(0));
  let m0 = a;
  while (m0 < b && blankCell(ch[m0], at[m0])) m0++;
  let j = m0;
  while (j < b && !blankCell(ch[j], at[j]) && isMarker(base(j))) j++;
  if (j === m0 && j < b && isDigit(base(j))) {
    let k = j;
    while (k < b && isDigit(base(k))) k++;
    if (k < b && (ch[k] === '.' || ch[k] === ')')) j = k + 1;
  }
  let b0 = m0;
  if (j > m0 && j < b && blankCell(ch[j], at[j])) {
    b0 = j;
    while (b0 < b && blankCell(ch[b0], at[b0])) b0++;
  }
  let b1 = b;
  while (b1 > b0 && blankCell(ch[b1 - 1], at[b1 - 1])) b1--;
  if (cursorX > b1 && cursorX < b) b1 = cursorX;
  if (b1 <= b0) return;

  let rtl = false;
  let pl = -1;
  for (let x = b0; x < b1; x++) {
    if (ch[x] === '') continue;
    const cp = base(x);
    if (!rtl && cp >= 0x590 && isRtlLetter(cp)) rtl = true;
    if (pl < 0) {
      const c = bidiClass(cp);
      if (c === R || c === AL || c === AN) pl = 1;
      else if (c === L || c === EN) pl = 0;
    }
  }
  if (!rtl) return;
  if (pl < 0) pl = 0;
  if (pl === 0 && above && above.shown && above.dir === 1 && above.b0 === b0) pl = 1;
  if (whole) { row.dir = pl; row.b0 = b0; }

  const from = pl === 1 ? (whole ? a : m0) : b0;
  const units = [];
  for (let x = from; x < b1; x++) {
    if (ch[x] === '') continue;
    units.push({ x, w: x + 1 < cols && ch[x + 1] === '' ? 2 : 1, text: ch[x], cp: base(x), at: at[x] });
  }

  const cps = [];
  const at0 = [];
  for (const u of units) {
    at0.push(cps.length);
    for (const c of u.text) cps.push(c.codePointAt(0));
  }
  const shaped = shapeCps(cps);
  const levels = resolveLevels(units.map((u) => u.cp), pl);
  const glyph = units.map((u, k) => {
    const s = shaped[at0[k]];
    if (s < 0) return null;
    let g = String.fromCodePoint(levels[k] & 1 ? mirrorOf(s) : s);
    const end = k + 1 < units.length ? at0[k + 1] : cps.length;
    for (let m = at0[k] + 1; m < end; m++) {
      if (!isFormatChar(cps[m]) && shaped[m] >= 0) g += String.fromCodePoint(shaped[m]);
    }
    return g;
  });

  let width = 0;
  for (let k = 0; k < units.length; k++) if (glyph[k] !== null) width += units[k].w;
  const limit = whole ? cols - 2 : b - 2;
  const start = pl === 1 ? Math.max(from, limit - width + 1) : from;

  for (let x = from; x < b1; x++) { dch[x] = ' '; dat[x] = DEFAULT_ATTR; }
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

  let k = 0;
  for (let x = from; x <= b1; x++) {
    while (k < units.length && units[k].x < x) k++;
    let c;
    if (k === 0) {
      c = pl === 1 ? start + width : start;
    } else {
      let u = k - 1;
      while (u > 0 && vis[u] < 0) u--;
      c = levels[u] & 1 ? vis[u] - 1 : vis[u] + units[u].w;
    }
    cmap[x] = Math.max(0, Math.min(cols - 1, c));
  }
}

function emitRow(y, ch, at, cols) {
  let end = cols;
  while (end > 0 && blankCell(ch[end - 1], at[end - 1]) && at[end - 1] === DEFAULT_ATTR) end--;
  let s = cup(y, 0);
  let cur = null;
  for (let x = 0; x < end; x++) {
    const c = ch[x];
    if (c === '') continue;
    if (at[x] !== cur) {
      cur = at[x];
      s += '\x1b[0m' + cur.seq;
    }
    s += c;
    if (x + 1 < cols && ch[x + 1] === '') s += `\x1b[${x + 3}G`;
  }
  s += '\x1b[0m';
  if (end < cols) s += '\x1b[K';
  return s;
}

function seqEnd(s, i) {
  const n = s.length;
  if (i + 1 >= n) return -1;
  const c1 = s[i + 1];
  if (c1 === '[') {
    for (let j = i + 2; j < n; j++) {
      const c = s.charCodeAt(j);
      if (c >= 0x40 && c <= 0x7e) return j + 1;
      if (c < 0x20 || c > 0x7e) return j;
    }
    return -1;
  }
  if (c1 === ']' || c1 === 'P' || c1 === '_' || c1 === '^' || c1 === 'X') {
    for (let j = i + 2; j < n; j++) {
      const c = s.charCodeAt(j);
      if (c === 0x07 && c1 === ']') return j + 1;
      if (c === 0x9c) return j + 1;
      if (c === 0x1b) {
        if (j + 1 >= n) return -1;
        return s[j + 1] === '\\' ? j + 2 : j;
      }
    }
    return n - i > 1 << 20 ? n : -1;
  }
  if ('()*+-./#% '.includes(c1)) return i + 3 <= n ? i + 3 : -1;
  return i + 2;
}
