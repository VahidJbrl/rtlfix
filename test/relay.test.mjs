import test from 'node:test';
import assert from 'node:assert/strict';
import { Relay } from '../src/relay.mjs';
import { preShapeArabic } from '../src/shaping.mjs';

const ESC = '\x1b';
const cup = (y, x) => `${ESC}[${y};${x}H`;
const frame = (body) => `${ESC}[?2026h${ESC}[?25l${body}${ESC}[?25h${ESC}[?2026l`;
const joined = (word) => [...preShapeArabic(word)].reverse().join('');
const text = (row) => row.ch.filter((c) => c !== '').join('').trimEnd();

class Terminal extends Relay {
  constructor(cols, rows, cursor) {
    super({ cols, rows, cursor });
    this.lines = [];
  }

  _scrollUp(top, bot, n, wrapped, feed) {
    if (feed && top === 0 && this.scr === this.main) for (let k = 0; k < n; k++) this.lines.push(text(this.scr[k]));
    return super._scrollUp(top, bot, n, wrapped, feed);
  }
}

function screen(bytes, cols, rows, { pre = '', cursor } = {}) {
  const t = new Terminal(cols, rows);
  if (pre) t.push(Buffer.from(pre, 'utf8'));
  t.push(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8'));
  return { row: (y) => text(t.scr[y - 1]), cursor: [t.y + 1, t.x + 1], history: t.lines, term: t };
}

function relayed(chunks, cols, rows, opts = {}) {
  const r = new Relay({ cols, rows, ...opts });
  return Buffer.concat(chunks.map((c) => r.push(Buffer.from(c, 'utf8'))).concat([r.tick()]));
}

test('output without RTL text passes through byte for byte', () => {
  const s = `${ESC}[?1049h${ESC}[2J${cup(1, 1)}${ESC}[1;32mhello${ESC}[0m world\r\n` +
    `${ESC}]0;title${ESC}\\  ● done ${ESC}[38;2;1;2;3mok${ESC}[39m\r\n${cup(5, 3)}${ESC}[K${'x'.repeat(95)}`;
  assert.equal(relayed([s], 40, 10).toString('utf8'), s);
  const r = new Relay({ cols: 40, rows: 10 });
  const out = Buffer.concat([...Buffer.from(s, 'utf8')].map((b) => r.push(Buffer.from([b]))));
  assert.equal(out.toString('utf8'), s);
});

test('an escape sequence split across reads is passed on once', () => {
  assert.equal(relayed([`${ESC}[3`, '1mab', 'cd', 'ef'], 20, 3).toString('utf8'), `${ESC}[31mabcdef`);
  assert.equal(relayed([`ab${ESC}${ESC}[31mc`], 20, 3).toString('utf8'), `ab${ESC}${ESC}[31mc`);
});

test('typed Persian is joined, right-aligned, with the cursor left of the text', () => {
  const chunks = [frame(`${cup(3, 1)}❯ ${cup(3, 3)}`)];
  [...'سلام'].forEach((ch, i) => chunks.push(frame(`${cup(3, 3 + i)}${ch}${cup(3, 4 + i)}`)));
  const t = screen(relayed(chunks, 30, 5), 30, 5);
  const line = joined('سلام') + ' ❮';
  assert.equal(t.row(3), ' '.repeat(29 - line.length) + line);
  assert.deepEqual(t.cursor, [3, 29 - line.length]);
});

test('an English word typed inside Persian stays whole and the cursor follows it', () => {
  const chunks = [frame(`${cup(2, 1)}* `)];
  [...'سلام hel'].forEach((ch, i) => chunks.push(frame(`${cup(2, 3 + i)}${ch}${cup(2, 4 + i)}`)));
  const t = screen(relayed(chunks, 30, 3), 30, 3);
  const line = `hel ${joined('سلام')} *`;
  assert.equal(t.row(2), ' '.repeat(29 - line.length) + line);
  assert.deepEqual(t.cursor, [2, 29 - line.length + 4]);
});

test('a full-row redraw with a drawn cursor cell', () => {
  const row = `${ESC}[38;5;1m* ${ESC}[39mیک${ESC}[48;2;212;212;212m ${ESC}[49m\u200b`;
  const out = relayed([frame(`${cup(4, 1)}${ESC}[2K${row}${cup(4, 5)}`)], 20, 6);
  const t = screen(out, 20, 6);
  const line = ` ${joined('یک')} *`;
  assert.equal(t.row(4), ' '.repeat(19 - line.length) + line);
  assert.deepEqual(t.cursor, [4, 19 - line.length + 1]);
  assert.ok(!out.toString('utf8').includes('\u200b'));
});

test('brackets in an RTL paragraph are mirrored', () => {
  const t = screen(relayed([`${cup(1, 1)}سلام (دنیا)`], 30, 2), 30, 2);
  assert.equal(t.row(1).trim(), `(${joined('دنیا')}) ${joined('سلام')}`);
});

test('a sentence that starts with a number is right-to-left', () => {
  const t = screen(relayed([`${cup(1, 1)}● ۱. فایل تغییر کرد`], 30, 2), 30, 2);
  assert.equal(t.row(1).trim(), `${joined('کرد')} ${joined('تغییر')} ${joined('فایل')} .۱ ●`);
});

test('an English sentence with a Persian word keeps its place', () => {
  const t = screen(relayed([`${cup(1, 1)}  Python یک زبان است`], 40, 2), 40, 2);
  assert.equal(t.row(1), `  Python ${joined('است')} ${joined('زبان')} ${joined('یک')}`);
});

test('table columns stay put and Persian cells align right inside them', () => {
  const t = screen(relayed([`${cup(1, 1)}│ نام      │ value │`], 30, 2), 30, 2);
  assert.equal(t.row(1), `│      ${joined('نام')} │ value │`);
});

test('a wrapped line continues the RTL paragraph above it', () => {
  const t = screen(relayed([`${cup(1, 1)}● سلام دنیا\r\n  server.py را ببین`], 40, 3), 40, 3);
  assert.equal(t.row(1).trim(), `${joined('دنیا')} ${joined('سلام')} ●`);
  const line = `${joined('ببین')} ${joined('را')} server.py`;
  assert.equal(t.row(2), ' '.repeat(37 - line.length) + line);
});

test('emoji keep their two cells and RLM takes none', () => {
  const t = screen(relayed([`${cup(1, 1)}سلام 👋 دنیا`], 20, 2), 20, 2);
  assert.equal(t.row(1), ' '.repeat(20 - 1 - 11) + `${joined('دنیا')} 👋 ${joined('سلام')}`);
  const r = screen(relayed([`${cup(1, 1)}ab\u200fcd${cup(2, 1)}x`], 20, 3), 20, 3);
  assert.equal(r.row(1), 'ab\u200fcd');
  assert.deepEqual(r.cursor, [2, 2]);
});

test('a row that stops containing RTL text shows the new text', () => {
  assert.equal(screen(relayed([`${cup(2, 1)}سلام${cup(2, 1)}${ESC}[2Kplain text`], 20, 3), 20, 3).row(2), 'plain text');
  assert.equal(screen(relayed([`${cup(2, 1)}سلام`, `${cup(2, 1)}abcd`], 20, 3), 20, 3).row(2), 'abcd');
});

test('Persian lines that scroll away in one read reach the scrollback drawn', () => {
  let s = '';
  for (let i = 1; i <= 8; i++) s += `سطر ${i}\r\n`;
  const t = screen(relayed([s], 20, 4), 20, 4);
  assert.equal(t.history.length, 5);
  t.history.forEach((line, i) => assert.equal(line.trim(), `${i + 1} ${joined('سطر')}`));
  assert.equal(t.row(1).trim(), `6 ${joined('سطر')}`);
});

test('the relay starts where the terminal cursor is', () => {
  const pre = '$ ls\r\nfile1 file2\r\n$ rtlfix tui prog\r\n';
  const prog = ['سلام دنیا', '\r\n> abc', `${ESC}[1A\r${ESC}[2Kخط اول`];
  for (const cursor of [[3, 0], null]) {
    const t = screen(relayed(prog, 30, 6, { cursor }), 30, 6, { pre });
    assert.equal(t.row(3), '$ rtlfix tui prog');
    assert.equal(t.row(4).trim(), `${joined('اول')} ${joined('خط')}`);
    assert.equal(t.row(5), '> abc');
  }
});

test('scrolling moves redrawn rows with the screen', () => {
  const t = screen(relayed([`${cup(1, 1)}سلام\r\nline2\r\nline3\r\n`, 'line4'], 10, 3), 10, 3);
  assert.deepEqual([t.row(1), t.row(2), t.row(3)], ['line2', 'line3', 'line4']);
});

test('the alternate screen keeps the main screen and its saved cursor', () => {
  const t = screen(relayed([`${cup(1, 1)}سلام`, `${ESC}[?1049h${cup(1, 1)}alt${ESC}[?1049l`], 12, 2), 12, 2);
  assert.equal(t.row(1), ' '.repeat(12 - 1 - 3) + joined('سلام'));
  const u = screen(relayed([`${cup(5, 4)}${ESC}[?1049h${cup(2, 2)}${ESC}7alt${ESC}[?1049lx`], 12, 6), 12, 6);
  assert.equal(u.row(5), '   x');
});

test('resizing follows the terminal', () => {
  const r = new Relay({ cols: 12, rows: 2 });
  const a = r.push(Buffer.from(`${cup(1, 1)}سلام`, 'utf8'));
  r.resize(20, 2);
  assert.equal(screen(Buffer.concat([a, r.tick()]), 20, 2).row(1), ' '.repeat(20 - 1 - 3) + joined('سلام'));
  const h = new Relay({ cols: 10, rows: 5 });
  h.push(Buffer.from('l1\r\nl2\r\nl3\r\nl4\r\nسلام', 'utf8'));
  h.resize(10, 3);
  assert.deepEqual([h.y, h.scr.map(text)[2].endsWith('سلام')], [2, true]);
  assert.equal(text(h.scr[0]), 'l3');
});

test('line drawing, hyperlinks and other terminal state survive a redraw', () => {
  const dec = relayed([`سلام config.py\r\n${ESC}(0lqqk`], 30, 3).toString('utf8');
  assert.ok(dec.endsWith(`${ESC}(0`) || dec.lastIndexOf(`${ESC}(0`) > dec.lastIndexOf('config.py'));
  const t = screen(Buffer.from(dec, 'utf8'), 30, 3);
  assert.equal(t.row(1).trim(), `config.py ${joined('سلام')}`);
  const link = `${ESC}]8;;https://example.com/${ESC}\\`;
  const out = relayed([`سلام ${link}docs${ESC}]8;;${ESC}\\ را ببین\r\n${link}cl`, `ick${ESC}]8;;${ESC}\\`], 40, 3).toString('utf8');
  assert.ok(out.includes(`${link}docs`));
  const redraw = out.slice(out.indexOf('\x1b[?2026h'));
  assert.ok(redraw.indexOf(`${ESC}]8;;${ESC}\\`) < redraw.indexOf('\x1b[1;1H'));
});

test('invalid UTF-8 is dropped the way xterm.js drops it', () => {
  const out = new Relay({ cols: 20, rows: 2 }).push(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0xff, 0x21]));
  assert.equal(out.toString('utf8'), 'caf !');
});

test('a huge OSC string passes through untouched', () => {
  const payload = 'A'.repeat(3 << 20);
  const s = `${ESC}]1337;File=x:${payload}\x07سلام`;
  const r = new Relay({ cols: 20, rows: 2 });
  const bytes = Buffer.from(s, 'utf8');
  const parts = [];
  for (let i = 0; i < bytes.length; i += 65536) parts.push(r.push(bytes.subarray(i, i + 65536)));
  const out = Buffer.concat(parts).toString('utf8');
  assert.ok(out.startsWith(`${ESC}]1337;File=x:${payload}\x07`));
  assert.equal(r.x, 4);
});

test('the same picture whatever the read size', () => {
  const s = frame(`${cup(1, 1)}● سلام (دنیا) و server.py${cup(2, 1)}  ادامه متن${cup(3, 1)}│ نام │ x │${cup(4, 3)}`);
  const whole = screen(relayed([s], 40, 5), 40, 5);
  const bytes = Buffer.from(s, 'utf8');
  for (const size of [1, 3, 7, 64]) {
    const r = new Relay({ cols: 40, rows: 5 });
    const parts = [];
    for (let i = 0; i < bytes.length; i += size) parts.push(r.push(bytes.subarray(i, i + size)));
    parts.push(r.tick());
    const t = screen(Buffer.concat(parts), 40, 5);
    for (let y = 1; y <= 4; y++) assert.equal(t.row(y), whole.row(y), `size ${size}, row ${y}`);
    assert.deepEqual(t.cursor, whole.cursor);
  }
});

const rev = (s) => [...s].reverse().join('');

test('Claude Code on Windows: its own reordering is undone and the line is drawn again', () => {
  const t = screen(relayed([`${cup(1, 1)}● ${rev('سلام دنیا')}`], 30, 3, { visual: true }), 30, 3);
  const line = joined('سلام دنیا') + ' ●';
  assert.equal(t.row(1), ' '.repeat(29 - line.length) + line);
});

test('Claude Code on Windows: a wrapped line that starts with an English word keeps its order', () => {
  const bytes = `${cup(1, 1)}   ${rev('سلام دنیا')}${cup(2, 1)}  Claude ${rev('خوب است')}.`;
  const t = screen(relayed([bytes], 40, 3, { visual: true }), 40, 3);
  const first = joined('سلام دنیا');
  const second = '.' + joined('خوب است') + ' Claude';
  assert.equal(t.row(1), ' '.repeat(37 - first.length) + first);
  assert.equal(t.row(2), ' '.repeat(37 - second.length) + second);
});

test('Claude Code on Windows: a highlighted prompt line keeps its marker on the right', () => {
  const bytes = `${cup(1, 1)}${ESC}[48;5;236m❯ ${rev('سلام')}      ${ESC}[0m`;
  const t = screen(relayed([bytes], 40, 3, { visual: true }), 40, 3);
  const line = joined('سلام') + ' ❮';
  assert.equal(t.row(1), ' '.repeat(39 - line.length) + line);
});

test('the request for the Windows console input encoding is not passed on', () => {
  assert.equal(relayed([`${ESC}[?9001h${ESC}[?1004hab`], 20, 3).toString('utf8'), `${ESC}[?1004hab`);
});

test('Claude Code on Windows: brackets at the ends of a line tell its direction', () => {
  const bytes = `${cup(1, 1)}   ${rev('سلام دنیا')}${cup(2, 1)}  (npm) ${rev('خوب است')}.`;
  const t = screen(relayed([bytes], 40, 3, { visual: true }), 40, 3);
  const line = '.' + joined('خوب است') + ' (npm)';
  assert.equal(t.row(2), ' '.repeat(37 - line.length) + line);
});

test('a mark on an alef stays on the lam-alef ligature', () => {
  const [m, th, la] = [...preShapeArabic('مثلا')];
  const line = la + '\u064b' + th + m;
  assert.equal(screen(relayed([`${cup(1, 1)}مثلاً`], 20, 2), 20, 2).row(1), ' '.repeat(16) + line);
});

test('where marks take a cell of their own, a right-aligned line leaves room for them', () => {
  const [m, th, la] = [...preShapeArabic('مثلا')];
  const line = la + '\u064b' + th + m;
  assert.equal(screen(relayed([`${cup(1, 1)}مثلاً`], 20, 2, { markCells: true }), 20, 2).row(1), ' '.repeat(15) + line);
});

test('Claude Code on Windows: a space typed after Persian keeps the text in place and moves the cursor', () => {
  const typed = (text, spaces) => frame(`${cup(3, 1)}❯ ${' '.repeat(spaces + 1)}${rev(text)}${cup(3, 3 + [...text].length + spaces)}`);
  const before = screen(relayed([typed('سلام', 0)], 30, 5, { visual: true }), 30, 5);
  const after = screen(relayed([typed('سلام', 0), typed('سلام', 1)], 30, 5, { visual: true }), 30, 5);
  const two = screen(relayed([typed('سلام', 0), typed('سلام', 2)], 30, 5, { visual: true }), 30, 5);
  assert.ok(before.row(3).endsWith(joined('سلام') + ' ❮'));
  assert.equal(after.row(3), before.row(3));
  assert.equal(two.row(3), before.row(3));
  assert.deepEqual(after.cursor, [3, before.cursor[1] - 1]);
  assert.deepEqual(two.cursor, [3, before.cursor[1] - 2]);
});

test('a space typed after Persian keeps the text in place and moves the cursor', () => {
  const typed = (text) => frame(`${cup(3, 1)}❯ ${text}${cup(3, 3 + [...text].length)}`);
  const before = screen(relayed([typed('سلام')], 30, 5), 30, 5);
  const after = screen(relayed([typed('سلام'), typed('سلام ')], 30, 5), 30, 5);
  assert.equal(after.row(3), before.row(3));
  assert.deepEqual(after.cursor, [3, before.cursor[1] - 1]);
});

test('a Persian line after an English label such as recap: reads right to left', () => {
  const t = screen(relayed([`${cup(1, 1)}※ recap: سلام دنیا`], 40, 3), 40, 3);
  const line = joined('سلام دنیا') + ' :recap ※';
  assert.equal(t.row(1), ' '.repeat(39 - line.length) + line);
  const english = screen(relayed([`${cup(1, 1)}※ recap: fixed the سلام bug`], 40, 3), 40, 3);
  assert.equal(english.row(1), `※ recap: fixed the ${joined('سلام')} bug`);
});

test('Claude Code on Windows: the recap line is turned back and reads right to left', () => {
  const plain = screen(relayed([`${cup(1, 1)}※ recap: ${rev('سلام دنیا')}`], 40, 3, { visual: true }), 40, 3);
  const line = joined('سلام دنیا') + ' :recap ※';
  assert.equal(plain.row(1), ' '.repeat(39 - line.length) + line);
  const mixed = screen(relayed([`${cup(1, 1)}※ recap: ${rev('فایل')} config.py ${rev('درست شد')}`], 50, 3, { visual: true }), 50, 3);
  const both = joined('درست شد') + ' config.py ' + joined('فایل') + ' :recap ※';
  assert.equal(mixed.row(1), ' '.repeat(49 - both.length) + both);
});
