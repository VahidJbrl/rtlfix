import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transformLine, wrapLine, newState, hasRtl } from './text.mjs';

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const AGENTS = new Set(['claude', 'qwen']);

const HELP = `rtlfix ${PKG.version}
Readable Persian, Arabic and Hebrew in terminals that cannot draw them
(VS Code's integrated terminal, web terminals).

Usage
  rtlfix claude [args...]          start Claude Code with RTL text drawn correctly
  rtlfix qwen [args...]            the same for Qwen Code
  rtlfix tui <program> [args...]   any other terminal program
  rtlfix demo                      see whether this terminal needs rtlfix
  rtlfix doctor                    check what rtlfix needs
  rtlfix [options] [text...]       print text ready for this terminal
                                   (reads standard input when no text is given)

Text options
  -l, --logical      join letters but keep the logical order
  -w, --width <n>    wrap at n columns, between words where possible

Setup without npm
  rtlfix install     copy rtlfix to ~/.local/share/rtlfix and link ~/.local/bin/rtlfix
  rtlfix uninstall   remove that copy

  -h, --help         show this help
  -v, --version      print the version`;

const SAMPLE = 'سلام! فایل config.py را بررسی کن (نسخه 2.0)';

function demo() {
  const after = transformLine(SAMPLE).text;
  console.log(`
  The same sentence, as programs print it and as rtlfix draws it:

    before │ ${SAMPLE}
    after  │ ${after}

  If "after" reads correctly here and "before" does not, this terminal
  needs rtlfix. Start your agent with:  rtlfix claude  or  rtlfix qwen

  If "before" already reads correctly, this terminal draws RTL text itself
  and you do not need rtlfix here.
`);
}

function fail(msg, code = 1) {
  console.error(`rtlfix: ${msg}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { mode: 'visual', width: 0, texts: [] };
  let rest = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (rest || a === '-' || !a.startsWith('-')) { opts.texts.push(a); continue; }
    if (a === '--') { rest = true; continue; }
    const m = a.match(/^(?:--width=|-w)(\d+)$/);
    if (m) { opts.width = Number(m[1]); continue; }
    switch (a) {
      case '-l': case '--logical': opts.mode = 'logical'; break;
      case '-s': case '--stream': break;
      case '-w': case '--width':
        opts.width = Number(argv[++i]);
        if (!(opts.width > 0) || !Number.isInteger(opts.width)) fail('--width needs a positive whole number');
        break;
      case '-v': case '--version': console.log(PKG.version); process.exit(0); break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      default: fail(`unknown option ${a} (see rtlfix --help)`);
    }
  }
  if (opts.width && !(opts.width > 0)) fail('--width needs a positive whole number');
  return opts;
}

function onPath(name) {
  if (name.includes('/')) return false;
  for (const d of (process.env.PATH || '').split(delimiter)) {
    if (!d) continue;
    try {
      const p = join(d, name);
      if (existsSync(p) && statSync(p).isFile()) return true;
    } catch { }
  }
  return false;
}

function makeWriter() {
  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(0);
    throw e;
  });
  return (s) => { if (s.length) process.stdout.write(s); };
}

function lineTransformer(opts) {
  const state = newState();
  const align = opts.width > 0 ? opts.width : process.stdout.isTTY && opts.mode !== 'logical' ? Math.max(0, (process.stdout.columns || 0) - 1) : 0;
  return (line) => {
    if (opts.width > 0) {
      let level = null;
      return wrapLine(line, opts.width).map((piece) => {
        const r = transformLine(piece, { mode: opts.mode, state, level, align });
        if (r.level !== null) level = r.level;
        return r.text;
      }).join('\n');
    }
    return transformLine(line, { mode: opts.mode, state, align }).text;
  };
}

function streamStdin(opts, write) {
  const transform = lineTransformer(opts);
  const decoder = new TextDecoder('utf-8');
  let rest = Buffer.alloc(0);
  const handle = (line, nl) => {
    if (line.length && line.some((b) => b >= 0x80 || b === 0x1b)) {
      const text = decoder.decode(line);
      if (hasRtl(text) || text.includes('\x1b')) {
        const out = transform(text);
        return out === text ? Buffer.concat([line, nl]) : Buffer.from(out + nl.toString('latin1'), 'utf8');
      }
    }
    return opts.width > 0 ? Buffer.from(transform(decoder.decode(line)) + nl.toString('latin1'), 'utf8') : Buffer.concat([line, nl]);
  };
  const NL = Buffer.from('\n');
  const EMPTY = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
    const parts = [];
    let start = 0;
    let idx;
    while ((idx = buf.indexOf(0x0a, start)) !== -1) {
      parts.push(handle(buf.subarray(start, idx), NL));
      start = idx + 1;
    }
    rest = Buffer.from(buf.subarray(start));
    if (parts.length) write(Buffer.concat(parts));
  });
  process.stdin.on('end', () => {
    if (rest.length) write(handle(rest, EMPTY));
  });
}

export async function main(argv) {
  const cmd = argv[0];
  if (cmd === 'tui') return (await import('./tui.mjs')).tuiMain(argv.slice(1));
  if (AGENTS.has(cmd)) return (await import('./tui.mjs')).tuiMain(argv);
  if (cmd === 'demo') return demo();
  if (cmd === 'doctor' || cmd === 'install' || cmd === 'uninstall') return (await import('./setup.mjs'))[cmd](argv.slice(1));
  if (cmd === 'help' && argv.length === 1) { console.log(HELP); return; }
  if (cmd === 'version' && argv.length === 1) { console.log(PKG.version); return; }
  const opts = parseArgs(argv);
  const write = makeWriter();
  if (opts.texts.length > 0) {
    const text = opts.texts.join(' ');
    if (opts.texts.length === 1 && !hasRtl(text) && /^[\w.+-]+$/.test(text) && process.stdout.isTTY && onPath(text)) {
      fail(`to run ${text} with RTL text drawn correctly, use: rtlfix tui ${text}`, 2);
    }
    const transform = lineTransformer(opts);
    write(text.split('\n').map(transform).join('\n') + '\n');
  } else if (process.stdin.isTTY) {
    console.log(HELP);
  } else {
    streamStdin(opts, write);
  }
}

const invoked = (() => {
  try { return process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url; } catch { return false; }
})();
if (invoked) main(process.argv.slice(2));
