import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reorderLine, resolveLevels, resolveClasses, bidiClass, isRtlLetter, paragraphLevel, mirrorOf,
  R, AL, L, EN, AN, ON, BN, CLASS_NAMES,
} from '../src/bidi.mjs';

const levels = (s, pl, opts) => [...resolveLevels([...s].map((c) => c.codePointAt(0)), pl, opts)];
const cls = (names) => Uint8Array.from(names.split(' ').map((n) => CLASS_NAMES.indexOf(n)));

test('RTL paragraph: Persian reversed, English and numbers stay left-to-right', () => {
  assert.equal(reorderLine('سلام world 123'), 'world 123 مالس');
  assert.equal(reorderLine('فایل server.py را ببین.'), '.نیبب ار server.py لیاف');
  assert.equal(reorderLine('نسخه ۲٫۰ آماده است'), 'تسا هدامآ ۲٫۰ هخسن');
});

test('LTR paragraph: only the right-to-left run is reversed', () => {
  assert.equal(reorderLine('Python یک زبان است'), 'Python تسا نابز کی');
  assert.equal(reorderLine('abc שלום def'), 'abc םולש def');
  assert.equal(reorderLine('hello سلام 123 world'), 'hello 123 مالس world');
});

test('a sentence that starts with a number is still right-to-left', () => {
  assert.equal(paragraphLevel([...'۳ فایل تغییر کرد'].map((c) => c.codePointAt(0))), 1);
  assert.equal(paragraphLevel([...'2026 سال خوبی بود'].map((c) => c.codePointAt(0))), 1);
  assert.equal(reorderLine('۳ فایل'), 'لیاف ۳');
});

test('brackets are mirrored only at right-to-left levels', () => {
  assert.equal(reorderLine('سلام (دنیا) test خوب'), 'بوخ test (ایند) مالس');
  assert.equal(reorderLine('سلام foo(bar) خوب'), 'بوخ foo(bar) مالس');
  assert.equal(reorderLine('test (سلام) test'), 'test (مالس) test');
  assert.equal(reorderLine('«سلام» گفت'), 'تفگ «مالس»');
  assert.equal(mirrorOf('≤'.codePointAt(0)), '≥'.codePointAt(0));
});

test('an empty call pair stays with its function name', () => {
  assert.equal(reorderLine('از dict.get() استفاده کن'), 'نک هدافتسا dict.get() زا');
  assert.equal(reorderLine('از sorted() یا list.sort() استفاده کن'), 'نک هدافتسا list.sort() ای sorted() زا');
  assert.equal(reorderLine('سلام () خوب'), 'بوخ () مالس');
  assert.deepEqual(levels('از f() کن', 1, { glue: false }), [1, 1, 1, 2, 1, 1, 1, 1, 1]);
});

test('explicit marks, embeddings and isolates', () => {
  assert.deepEqual(levels('ab\u200fcd', 0), [0, 0, 1, 0, 0]);
  assert.deepEqual(levels('\u2067ab\u2069 x', 0), [0, 2, 2, 0, 0, 0]);
  assert.deepEqual([...resolveClasses(cls('L RLE L PDF L'), 0)], [0, 0, 2, 2, 0]);
  assert.deepEqual([...resolveClasses(cls('AN RLE NSM'), 0)], [2, 2, 1]);
  assert.deepEqual([...resolveClasses(cls('R LRO R R PDF'), 1)], [1, 1, 2, 2, 1]);
});

test('character classes come from the Unicode data', () => {
  assert.equal(bidiClass('a'.codePointAt(0)), L);
  assert.equal(bidiClass('س'.codePointAt(0)), AL);
  assert.equal(bidiClass('ש'.codePointAt(0)), R);
  assert.equal(bidiClass(0x0661), AN);
  assert.equal(bidiClass(0x06f1), EN);
  assert.equal(bidiClass(0x061c), AL);
  assert.equal(bidiClass(0x00bd), ON);
  assert.equal(bidiClass(0x200d), BN);
  for (const cp of [0xfb50, 0xfdf2, 0xfe70, 0xfefc]) assert.ok(isRtlLetter(cp), cp.toString(16));
  assert.equal(isRtlLetter('۱'.codePointAt(0)), false);
  assert.equal(isRtlLetter(0xfdff), false);
});
