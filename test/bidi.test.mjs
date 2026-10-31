import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reorderLine, resolveLevels, resolveClasses, bidiClass, isRtlLetter, paragraphLevel, mirrorOf, fromVisual, visualOrder, leansRtl,
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

const rev = (s) => [...s].reverse().join('');
const shown = (s, pl) => {
  const cps = [...s].map((c) => c.codePointAt(0));
  return String.fromCodePoint(...visualOrder(resolveLevels(cps, pl, { glue: false })).map((k) => cps[k]));
};
const readBack = (s, pl) => {
  const cps = [...s].map((c) => c.codePointAt(0));
  const r = fromVisual(cps, pl);
  return { text: String.fromCodePoint(...visualOrder(r.levels).map((k) => cps[k])), ok: r.ok, pen: r.pen };
};
const worse = (a, b) => !a.ok || a.pen > b.pen;

test('a line put in display order without mirrored brackets is read back', () => {
  const lines = [
    [`Goodreads 4.3 · )The Hobbit، 1937( ${rev('کتاب')}`, `${'کتاب'} (The Hobbit، 1937) · Goodreads 4.3`],
    [`.${rev('هم هستند')} )95%`, '95%) هم هستند.'],
    [`${rev('دنیا')} %95 ${rev('سلام')}`, 'سلام 95% دنیا'],
    [`${rev('بعدی')} و )RT 92% / 96% ،2025( 2 ${rev('نسخه')}`, 'نسخه 2 (2025، RT 92% / 96%) و بعدی'],
    [`${rev('است')} 100$ ${rev('قیمت')}`, 'قیمت $100 است'],
  ];
  for (const [visual, logical] of lines) {
    assert.equal(shown(logical, 1), visual);
    const back = readBack(visual, 1);
    assert.deepEqual([back.text, back.ok], [logical, true]);
    assert.ok(worse(readBack(visual, 0), back), visual);
  }
});

test('an English line keeps its order when read back', () => {
  const visual = `The Hobbit (1937 ،${rev('هابیت')}) · 5 ${rev('از')} 4.3 ${rev('امتیاز')}`;
  const logical = 'The Hobbit (هابیت، 1937) · امتیاز 4.3 از 5';
  assert.equal(shown(logical, 0), visual);
  const back = readBack(visual, 0);
  assert.deepEqual([back.text, back.ok], [logical, true]);
  assert.ok(worse(readBack(visual, 1), back));
});

test('a number between English and Persian is read back where it belongs', () => {
  const lines = [
    [`Mary Smith 2025 ${rev('در')} Python ${rev('را یاد گرفت')}.`, 'Mary Smith در 2025 Python را یاد گرفت.', 0],
    [`PDF 10 ${rev('قسط')} ${rev('آخرین')} ،${rev('فاکتور')} June 2026`, 'PDF فاکتور، آخرین قسط 10 June 2026', 0],
    [`Python 3.12 ${rev('بهتر از')} Java ${rev('است')}`, 'Python 3.12 بهتر از Java است', 0],
    [`UTF-8 ${rev('را همین حالا فعال کنید')}.`, 'UTF-8 را همین حالا فعال کنید.', 0],
    [`.${rev('برسد')} Nov 30 ${rev('بسته باید تا')}`, 'بسته باید تا Nov 30 برسد.', 1],
    [`${rev('را ببینید')} E Main St 12 ${rev('آدرس')}`, 'آدرس 12 E Main St را ببینید', 1],
    [`${rev('است')} Green Lot 1 ${rev('پارکینگ')}`, 'پارکینگ Green Lot 1 است', 1],
    [`.Misc ۴ و Notes ۱، Photos ۲ ،۱ ${rev('پوشه اصلی')}`, 'پوشه اصلی ۱، Notes ۱، Photos ۲ و Misc ۴.', 1],
    [`.${rev('آمد')} Linux ${rev('برای')} Windows 11 ${rev('نسخه')}`, 'نسخه Windows 11 برای Linux آمد.', 1],
  ];
  for (const [visual, logical, pl] of lines) {
    assert.equal(shown(logical, pl), visual);
    const back = readBack(visual, pl);
    assert.deepEqual([back.text, back.ok], [logical, true]);
  }
});

test('a Persian line that starts with an English word leans right to left, English and code do not', () => {
  const lean = (s) => leansRtl([...s].map((c) => c.codePointAt(0)));
  for (const s of ['Python یک زبان ساده است', 'Node 18 برای Linux Mint الان Stable است.', 'VS Code ممکن است کند شود:']) assert.ok(lean(s), s);
  for (const s of ['The word for hello is سلام', 'Hello سلام world', 'print("سلام دنیا")', 'x = 1  # مقدار اولیه']) assert.ok(!lean(s), s);
});
