import { isRtlLetter, firstStrongLevel, reorderLine } from './bidi.mjs';
import { cpWidth, strWidth } from './width.mjs';

function hasRtl(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x590 && isRtlLetter(cp)) return true;
  }
  return false;
}

export function visualText(text) {
  if (!hasRtl(text)) return text;
  let level = null;
  return text
    .split('\n')
    .map((line) => {
      if (line.trim() === '') {
        level = null;
        return line;
      }
      const cr = line.endsWith('\r');
      const body = cr ? line.slice(0, -1) : line;
      if (level === null) level = firstStrongLevel([...body].map((c) => c.codePointAt(0)));
      return reorderLine(body, level) + (cr ? '\r' : '');
    })
    .join('\n');
}

export function wrapLine(line, width) {
  if (width <= 0 || strWidth(line) <= width) return [line];
  const lines = [];
  let cur = '';
  let curW = 0;
  let pend = '';
  for (const t of line.split(/( +)/)) {
    if (t === '') continue;
    if (/^ +$/.test(t)) {
      pend += t;
      continue;
    }
    const tw = strWidth(t);
    if (tw > width) {
      if (cur !== '') lines.push(cur);
      cur = '';
      curW = 0;
      pend = '';
      for (const ch of t) {
        const cw = cpWidth(ch.codePointAt(0));
        if (curW + cw > width) {
          lines.push(cur);
          cur = '';
          curW = 0;
        }
        cur += ch;
        curW += cw;
      }
    } else if (curW > 0 && curW + pend.length + tw > width) {
      lines.push(cur);
      cur = t;
      curW = tw;
      pend = '';
    } else {
      cur += pend + t;
      curW += pend.length + tw;
      pend = '';
    }
  }
  if (cur !== '' || lines.length === 0) lines.push(cur);
  return lines;
}

export function wrapText(text, width) {
  if (width <= 0) return text;
  return text.split('\n').flatMap((l) => wrapLine(l, width)).join('\n');
}
