import { WIDTH } from './unicode-tables.mjs';

export function cpWidth(cp) {
  if (cp < 0xa0) return cp >= 0x20 && cp < 0x7f ? 1 : 0;
  let lo = 0;
  let hi = WIDTH.length / 3 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const k = mid * 3;
    if (cp < WIDTH[k]) hi = mid - 1;
    else if (cp > WIDTH[k + 1]) lo = mid + 1;
    else return WIDTH[k + 2];
  }
  return 1;
}

export function strWidth(s) {
  let w = 0;
  for (const ch of s) w += cpWidth(ch.codePointAt(0));
  return w;
}
