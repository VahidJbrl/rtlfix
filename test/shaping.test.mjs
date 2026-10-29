import test from 'node:test';
import assert from 'node:assert/strict';
import { preShapeArabic, shapeCps } from '../src/shaping.mjs';
import { cpWidth, strWidth } from '../src/width.mjs';

const cps = (s) => [...s].map((c) => c.codePointAt(0));

test('lam-alef becomes one ligature', () => {
  assert.deepEqual(cps(preShapeArabic('لا')), [0xfefb]);
  assert.deepEqual(cps(preShapeArabic('سلام')), [0xfeb3, 0xfefc, 0xfee1]);
  assert.deepEqual(cps(preShapeArabic('لى')), [0xfedf, 0xfef0]);
});

test('initial, medial, final and isolated forms', () => {
  assert.deepEqual(cps(preShapeArabic('فایل')), [0xfed3, 0xfe8e, 0xfbfe, 0xfede]);
  assert.deepEqual(cps(preShapeArabic('المن')), [0xfe8d, 0xfedf, 0xfee4, 0xfee6]);
  assert.deepEqual(cps(preShapeArabic('كلام')), [0xfedb, 0xfefc, 0xfee1]);
});

test('the Persian half-space (ZWNJ) blocks joining and is kept', () => {
  assert.deepEqual(cps(preShapeArabic('می\u200cنویسم')), [0xfee3, 0xfbfd, 0x200c, 0xfee7, 0xfeee, 0xfbfe, 0xfeb4, 0xfee2]);
});

test('tatweel and ZWJ make their neighbours join', () => {
  assert.deepEqual(cps(preShapeArabic('بـ')), [0xfe91, 0x0640]);
  assert.deepEqual(cps(preShapeArabic('ـب')), [0x0640, 0xfe90]);
  assert.deepEqual(cps(preShapeArabic('ه\u200d')), [0xfeeb, 0x200d]);
});

test('marks between letters do not break joining', () => {
  assert.deepEqual(cps(preShapeArabic('بَب')), [0xfe91, 0x064e, 0xfe90]);
  assert.deepEqual(cps(preShapeArabic('ب\u200fب')), [0xfe91, 0x200f, 0xfe90]);
});

test('text that is not Arabic-script is untouched', () => {
  const s = 'hello world — server.py v2.0 (100%)';
  assert.equal(preShapeArabic(s), s);
  const out = preShapeArabic('سلام، فایل server.py را بررسی کن و نسخه 2.0 را دانلود کن');
  assert.ok(out.includes('server.py') && out.includes('2.0') && out.includes('،'));
  assert.ok(!/[ء-يپچژکگی]/.test(out));
});

test('shaping is idempotent', () => {
  for (const s of ['سلام', 'فایل server.py', 'می\u200cنویسم', 'لا', 'المن']) {
    const once = preShapeArabic(s);
    assert.equal(preShapeArabic(once), once);
  }
});

test('shapeCps keeps positions and marks the absorbed alef', () => {
  const out = shapeCps(cps('سلام'));
  assert.equal(out.length, 4);
  assert.equal(out[2], -1);
});

test('character widths match xterm.js', () => {
  assert.equal(cpWidth(0x200f), 0);
  assert.equal(cpWidth(0x200e), 0);
  assert.equal(cpWidth(0x0600), 0);
  assert.equal(cpWidth(0x0903), 1);
  assert.equal(cpWidth(0x4e2d), 2);
  assert.equal(cpWidth(0x1f600), 2);
  assert.equal(cpWidth(0xfeb3), 1);
  assert.equal(strWidth('سلام\u200f 中'), 7);
});
