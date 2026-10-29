import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { visualText, wrapLine, wrapText, lineWidth } from '../src/text.mjs';
import { preShapeArabic } from '../src/shaping.mjs';

const BIN = join(dirname(dirname(fileURLToPath(import.meta.url))), 'bin', 'rtlfix.cjs');
const cli = (args, input = '') => execFileSync(process.execPath, [BIN, ...args], { input, encoding: 'utf8' });
const cliRaw = (args, input) => execFileSync(process.execPath, [BIN, ...args], { input });
const vis = (s) => [...preShapeArabic(s)].reverse().join('');

test('every line takes its own direction', () => {
  const out = visualText('این دستور را اجرا کنید:\n```bash\nexport PATH="$HOME/bin:$PATH";\n```\nhello world').split('\n');
  assert.equal(out[0], `:${vis('کنید')} ${vis('اجرا')} ${vis('را')} ${vis('دستور')} ${vis('این')}`);
  assert.equal(out[1], '```bash');
  assert.equal(out[2], 'export PATH="$HOME/bin:$PATH";');
  assert.equal(out[4], 'hello world');
});

test('Windows line endings and text without RTL letters are kept', () => {
  assert.equal(visualText('سلام\r\nدنیا\r\n'), `${vis('سلام')}\r\n${vis('دنیا')}\r\n`);
  const s = 'plain (text) with [brackets]\n';
  assert.equal(visualText(s), s);
});

test('colours stay on the words they belong to', () => {
  const out = visualText('\x1b[31mسلام\x1b[0m world');
  assert.equal(out, `world \x1b[0m\x1b[31m${vis('سلام')}\x1b[0m`);
  assert.ok(!out.replace(/\x1b\[[0-9;]*m/g, '').includes('\x1b'));
});

test('harakat stay on their letters', () => {
  const shaped = [...preShapeArabic('بَد')];
  assert.equal(visualText('بَد'), shaped[2] + shaped[0] + shaped[1]);
});

test('wrapping breaks between words and keeps line endings', () => {
  const words = ['واژه-بلند', 'کوتاه', 'word', 'دیگر', 'another', 'کلمه'];
  const lines = wrapLine(words.join(' '), 20);
  for (const l of lines) {
    assert.ok(lineWidth(l) <= 20, l);
    for (const w of l.split(' ')) assert.ok(words.includes(w), w);
  }
  assert.deepEqual(wrapLine('short', 80), ['short']);
  assert.equal(wrapText('a\nb c\n', 80), 'a\nb c\n');
  assert.deepEqual(wrapLine('aaa bbb ccc\r', 7), ['aaa bbb\r', 'ccc\r']);
  assert.equal(lineWidth('a\tb'), 9);
});

test('a word longer than the width is split', () => {
  const lines = wrapLine('x'.repeat(50) + ' end', 20);
  for (const l of lines) assert.ok(lineWidth(l) <= 20, l);
  assert.equal(lines.join(''), 'x'.repeat(50) + ' end');
});

test('cli: joins letters and puts them in visual order', () => {
  assert.equal(cli([], 'سلام (دنیا)\n'), `(${vis('دنیا')}) ${vis('سلام')}\n`);
  assert.equal(cli(['سلام']), vis('سلام') + '\n');
  assert.equal(cli(['--logical', 'سلام']), preShapeArabic('سلام') + '\n');
  assert.equal(cli(['--', '-x']), '-x\n');
});

test('cli: other bytes pass through unchanged', () => {
  const s = 'hello world\nsecond line\n';
  assert.equal(cli([], s), s);
  const bad = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
  assert.deepEqual(cliRaw([], bad), bad);
  assert.equal(cli([], 'no newline'), 'no newline');
});

test('cli: --width right-aligns RTL lines', () => {
  for (const l of cli(['--width', '12'], 'one two three four five six\n').trim().split('\n')) {
    assert.ok(l.length <= 12, l);
  }
  const line = `${vis('دنیا')} ${vis('سلام')}`;
  assert.equal(cli(['-w12'], 'سلام دنیا\n'), `${' '.repeat(12 - [...line].length)}${line}\n`);
  assert.equal(cli(['--width=12', '--stream'], 'لا\nhello\n'), `${' '.repeat(11)}${String.fromCodePoint(0xfefb)}\nhello\n`);
});

test('cli: help, version, demo and errors', () => {
  assert.match(cli(['--version']).trim(), /^\d+\.\d+\.\d+$/);
  assert.equal(cli(['version']), cli(['--version']));
  assert.match(cli(['--help']), /rtlfix claude/);
  assert.match(cli(['help']), /rtlfix tui <program>/);
  const demo = cli(['demo']);
  assert.ok(demo.includes('before') && demo.includes('after'));
  const bad = spawnSync(process.execPath, [BIN, '--nope'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown option --nope/);
  const head = spawnSync('sh', ['-c', `yes 'سلام دنیا' | head -50000 | "${process.execPath}" "${BIN}" | head -1`], { encoding: 'utf8' });
  assert.equal(head.stderr, '');
  assert.equal(head.stdout, `${vis('دنیا')} ${vis('سلام')}\n`);
});
