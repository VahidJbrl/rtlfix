import test from 'node:test';
import assert from 'node:assert/strict';
import { Relay } from '../src/relay.mjs';
import { preShapeArabic } from '../src/shaping.mjs';

const ESC = '\x1b';
const cup = (y, x) => `${ESC}[${y};${x}H`;
const frame = (body) => `${ESC}[?2026h${ESC}[?25l${body}${ESC}[?25h${ESC}[?2026l`;
const joined = (word) => [...preShapeArabic(word)].reverse().join('');

function screen(bytes, cols, rows) {
  const t = new Relay({ cols, rows });
  t.push(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8'));
  return { row: (y) => t.scr[y - 1].ch.join('').trimEnd(), cursor: [t.y + 1, t.x + 1] };
}

function relayed(chunks, cols, rows) {
  const r = new Relay({ cols, rows });
  return Buffer.concat(chunks.map((c) => r.push(Buffer.from(c, 'utf8'))));
}

test('output without RTL text passes through byte for byte', () => {
  const s = `${ESC}[?1049h${ESC}[2J${cup(1, 1)}${ESC}[1;32mhello${ESC}[0m world\r\n` +
    `${ESC}]0;title${ESC}\\  ● done ${ESC}[38;2;1;2;3mok${ESC}[39m\r\n${cup(5, 3)}${ESC}[K`;
  assert.equal(relayed([s], 40, 10).toString('utf8'), s);
  const r = new Relay({ cols: 40, rows: 10 });
  const out = Buffer.concat([...Buffer.from(s, 'utf8')].map((b) => r.push(Buffer.from([b]))));
  assert.equal(out.toString('utf8'), s);
});

test('an escape sequence split across reads is passed on once', () => {
  assert.equal(relayed([`${ESC}[3`, '1mab', 'cd', 'ef'], 20, 3).toString('utf8'), `${ESC}[31mabcdef`);
});

test('typed Persian is joined, right-aligned, with the cursor left of the text', () => {
  const chunks = [frame(`${cup(3, 1)}❯ ${cup(3, 3)}`)];
  [...'سلام'].forEach((ch, i) => chunks.push(frame(`${cup(3, 3 + i)}${ch}${cup(3, 4 + i)}`)));
  const t = screen(relayed(chunks, 30, 5), 30, 5);
  const text = joined('سلام') + ' ❮';
  assert.equal(t.row(3), ' '.repeat(29 - text.length) + text);
  assert.deepEqual(t.cursor, [3, 29 - text.length]);
});

test('an English word typed inside Persian stays whole and the cursor follows it', () => {
  const chunks = [frame(`${cup(2, 1)}* `)];
  [...'سلام hel'].forEach((ch, i) => chunks.push(frame(`${cup(2, 3 + i)}${ch}${cup(2, 4 + i)}`)));
  const t = screen(relayed(chunks, 30, 3), 30, 3);
  const text = `hel ${joined('سلام')} *`;
  assert.equal(t.row(2), ' '.repeat(29 - text.length) + text);
  assert.deepEqual(t.cursor, [2, 29 - text.length + 4]);
});

test('a full-row redraw with a drawn cursor cell', () => {
  const row = `${ESC}[38;5;1m* ${ESC}[39mیک${ESC}[48;2;212;212;212m ${ESC}[49m​`;
  const out = relayed([frame(`${cup(4, 1)}${ESC}[2K${row}${cup(4, 5)}`)], 20, 6);
  const t = screen(out, 20, 6);
  const text = ` ${joined('یک')} *`;
  assert.equal(t.row(4), ' '.repeat(19 - text.length) + text);
  assert.deepEqual(t.cursor, [4, 19 - text.length + 1]);
  assert.ok(!out.toString('utf8').includes('​'));
});

test('brackets in an RTL paragraph are mirrored', () => {
  const t = screen(relayed([`${cup(1, 1)}سلام (دنیا)`], 30, 2), 30, 2);
  assert.equal(t.row(1).trim(), `(${joined('دنیا')}) ${joined('سلام')}`);
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
  const text = `${joined('ببین')} ${joined('را')} server.py`;
  assert.equal(t.row(2), ' '.repeat(37 - text.length) + text);
});

test('emoji keep their two cells', () => {
  const t = screen(relayed([`${cup(1, 1)}سلام 👋 دنیا`], 20, 2), 20, 2);
  assert.equal(t.row(1), ' '.repeat(20 - 1 - 11) + `${joined('دنیا')} 👋 ${joined('سلام')}`);
});

test('a row that stops containing RTL text shows the new text', () => {
  assert.equal(screen(relayed([`${cup(2, 1)}سلام${cup(2, 1)}${ESC}[2Kplain text`], 20, 3), 20, 3).row(2), 'plain text');
  assert.equal(screen(relayed([`${cup(2, 1)}سلام`, `${cup(2, 1)}abcd`], 20, 3), 20, 3).row(2), 'abcd');
});

test('scrolling moves redrawn rows with the screen', () => {
  const t = screen(relayed([`${cup(1, 1)}سلام\r\nline2\r\nline3\r\n`, 'line4'], 10, 3), 10, 3);
  assert.deepEqual([t.row(1), t.row(2), t.row(3)], ['line2', 'line3', 'line4']);
});

test('the alternate screen keeps the main screen intact', () => {
  const t = screen(relayed([`${cup(1, 1)}سلام`, `${ESC}[?1049h${cup(1, 1)}alt${ESC}[?1049l`], 12, 2), 12, 2);
  assert.equal(t.row(1), ' '.repeat(12 - 1 - 3) + joined('سلام'));
});

test('resizing redraws RTL rows for the new width', () => {
  const r = new Relay({ cols: 12, rows: 2 });
  const a = r.push(Buffer.from(`${cup(1, 1)}سلام`, 'utf8'));
  r.resize(20, 2);
  assert.equal(screen(Buffer.concat([a, r.tick()]), 20, 2).row(1), ' '.repeat(20 - 1 - 3) + joined('سلام'));
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
