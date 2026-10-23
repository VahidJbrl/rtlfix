#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { visualText, wrapText } from './text.mjs';
import { preShapeArabic } from './shaping.mjs';

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const HELP = `rtlfix ${PKG.version}
Readable Persian, Arabic and Hebrew in terminals that cannot draw them
(VS Code's integrated terminal, web terminals).

Usage
  rtlfix tui <program> [args...]   run a terminal program with RTL text drawn correctly
                                   e.g. rtlfix tui claude, rtlfix tui qwen
  rtlfix demo                      see whether this terminal needs rtlfix
  rtlfix doctor                    check what rtlfix needs
  rtlfix [options] [text...]       print text ready for this terminal
                                   (reads standard input when no text is given)

Text options
  -l, --logical      join letters but keep the logical order
  -w, --width <n>    wrap at n columns, never inside a word
  -s, --stream       process standard input line by line

Setup without npm
  rtlfix install     copy rtlfix to ~/.local/share/rtlfix and link ~/.local/bin/rtlfix
  rtlfix uninstall   remove that copy

  -h, --help         show this help
  -v, --version      print the version`;

const SAMPLE = 'سلام! فایل config.py را بررسی کن (نسخه 2.0)';

function demo() {
  const after = visualText(preShapeArabic(SAMPLE));
  console.log(`
  The same sentence, as programs print it and as rtlfix draws it:

    before │ ${SAMPLE}
    after  │ ${after}

  If "after" reads correctly here and "before" does not, this terminal
  needs rtlfix. Start your agent with:  rtlfix tui claude  or  rtlfix tui qwen

  If "before" already reads correctly, this terminal draws RTL text itself
  and you do not need rtlfix here.
`);
}

function parseArgs(argv) {
  const opts = { mode: 'visual', width: 0, stream: false, texts: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-l': case '--logical': opts.mode = 'logical'; break;
      case '-s': case '--stream': opts.stream = true; break;
      case '-w': case '--width':
        opts.width = parseInt(argv[++i], 10);
        if (!(opts.width > 0)) fail('--width needs a positive number');
        break;
      case '-v': case '--version': console.log(PKG.version); process.exit(0); break;
      case '-h': case '--help': console.log(HELP); process.exit(0); break;
      default:
        if (a.startsWith('-') && a !== '-') fail(`unknown option ${a} (see rtlfix --help)`);
        opts.texts.push(a);
    }
  }
  return opts;
}

function fail(msg) {
  console.error(`rtlfix: ${msg}`);
  process.exit(1);
}

function transform(text, opts) {
  const wrapped = opts.width > 0 ? wrapText(text, opts.width) : text;
  const shaped = preShapeArabic(wrapped);
  return opts.mode === 'logical' ? shaped : visualText(shaped);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => resolve(data));
  });
}

function streamStdin(opts) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      process.stdout.write(transform(line, opts) + '\n');
    }
  });
  process.stdin.on('end', () => {
    if (buf !== '') process.stdout.write(transform(buf, opts) + '\n');
  });
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (cmd === 'tui') {
  const { tuiMain } = await import('./tui.mjs');
  tuiMain(argv.slice(1));
} else if (cmd === 'demo') {
  demo();
} else if (cmd === 'doctor' || cmd === 'install' || cmd === 'uninstall') {
  const setup = await import('./setup.mjs');
  setup[cmd](argv.slice(1));
} else {
  const opts = parseArgs(argv);
  if (opts.stream) {
    streamStdin(opts);
  } else if (opts.texts.length > 0) {
    process.stdout.write(transform(opts.texts.join(' '), opts) + '\n');
  } else if (process.stdin.isTTY) {
    console.log(HELP);
  } else {
    process.stdout.write(transform(await readStdin(), opts));
  }
}
