import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { visualText, wrapLine, wrapText } from '../src/text.mjs';
import { preShapeArabic } from '../src/shaping.mjs';
import { strWidth } from '../src/width.mjs';

const CLI = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src', 'cli.mjs');
const cli = (args, input = '') => execFileSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8' });
const rev = (s) => [...s].reverse().join('');

test('visual order per paragraph', () => {
  const out = visualText('سلام دنیا\nاین خط دوم است\n\nhello world').split('\n');
  assert.equal(out[0], `${rev('دنیا')} ${rev('سلام')}`);
  assert.equal(out[1], rev('این خط دوم است'));
  assert.equal(out[3], 'hello world');
});

test('visual order keeps Windows line endings', () => {
  assert.equal(visualText('سلام\r\nدنیا\r\n'), `${rev('سلام')}\r\n${rev('دنیا')}\r\n`);
});

test('text without RTL letters is returned unchanged', () => {
  const s = 'plain (text) with [brackets]\n';
  assert.equal(visualText(s), s);
});

test('wrapping breaks between words', () => {
  const words = ['واژه-بلند', 'کوتاه', 'word', 'دیگر', 'another', 'کلمه'];
  const lines = wrapLine(words.join(' '), 20);
  for (const l of lines) {
    assert.ok(strWidth(l) <= 20, l);
    for (const w of l.split(' ')) assert.ok(words.includes(w), w);
  }
  assert.deepEqual(wrapLine('short', 80), ['short']);
  assert.equal(wrapText('a\nb c\n', 80), 'a\nb c\n');
});

test('a word longer than the width is split', () => {
  const lines = wrapLine('x'.repeat(50) + ' end', 20);
  for (const l of lines) assert.ok(strWidth(l) <= 20, l);
  assert.equal(lines.join(''), 'x'.repeat(50) + ' end');
});

test('cli: joins letters and puts them in visual order', () => {
  const out = cli([], 'سلام (دنیا)\n');
  assert.equal(out, `(${rev(preShapeArabic('دنیا'))}) ${rev(preShapeArabic('سلام'))}\n`);
});

test('cli: text arguments and --logical', () => {
  assert.equal(cli(['سلام']), rev(preShapeArabic('سلام')) + '\n');
  assert.equal(cli(['--logical', 'سلام']), preShapeArabic('سلام') + '\n');
});

test('cli: English output passes through unchanged', () => {
  const s = 'hello world\nsecond line\n';
  assert.equal(cli([], s), s);
});

test('cli: --width and --stream', () => {
  for (const l of cli(['--width', '12'], 'one two three four five six\n').trim().split('\n')) {
    assert.ok(l.length <= 12, l);
  }
  assert.equal(cli(['--stream'], 'لا\nhello\n'), `${String.fromCodePoint(0xfefb)}\nhello\n`);
});

test('cli: help, version, demo and errors', () => {
  assert.match(cli(['--version']).trim(), /^\d+\.\d+\.\d+$/);
  assert.match(cli(['--help']), /rtlfix tui <program>/);
  const demo = cli(['demo']);
  assert.ok(demo.includes('before') && demo.includes('after'));
  const bad = spawnSync(process.execPath, [CLI, '--nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown option --nope/);
});
