import test from 'node:test';
import assert from 'node:assert/strict';
import { preShapeArabic, shapeCps } from '../src/shaping.mjs';

const cps = (s) => [...s].map((c) => c.codePointAt(0));

test('lam-alef becomes one ligature', () => {
  assert.deepEqual(cps(preShapeArabic('لا')), [0xfefb]);
  assert.deepEqual(cps(preShapeArabic('سلام')), [0xfeb3, 0xfefc, 0xfee1]);
});

test('initial, medial, final and isolated forms', () => {
  assert.deepEqual(cps(preShapeArabic('فایل')), [0xfed3, 0xfe8e, 0xfbfe, 0xfede]);
  assert.deepEqual(cps(preShapeArabic('المن')), [0xfe8d, 0xfedf, 0xfee4, 0xfee6]);
  assert.deepEqual(cps(preShapeArabic('كلام')), [0xfedb, 0xfefc, 0xfee1]);
});

test('the Persian half-space (ZWNJ) blocks joining and is kept', () => {
  assert.deepEqual(cps(preShapeArabic('می‌نویسم')), [0xfee3, 0xfbfd, 0x200c, 0xfee7, 0xfeee, 0xfbfe, 0xfeb4, 0xfee2]);
});

test('text that is not Arabic-script is untouched', () => {
  const s = 'hello world — server.py v2.0 (100%)';
  assert.equal(preShapeArabic(s), s);
  const out = preShapeArabic('سلام، فایل server.py را بررسی کن و نسخه 2.0 را دانلود کن');
  assert.ok(out.includes('server.py') && out.includes('2.0') && out.includes('،'));
  assert.ok(!/[ء-يپچژکگی]/.test(out));
});

test('shaping is idempotent', () => {
  for (const s of ['سلام', 'فایل server.py', 'می‌نویسم', 'لا', 'المن']) {
    const once = preShapeArabic(s);
    assert.equal(preShapeArabic(once), once);
  }
});

test('shapeCps keeps positions and marks the absorbed alef', () => {
  const out = shapeCps(cps('سلام'));
  assert.equal(out.length, 4);
  assert.equal(out[2], -1);
});
