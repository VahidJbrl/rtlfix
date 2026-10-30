import { spawn, execFileSync } from 'node:child_process';
import { readSync, writeSync, readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { constants } from 'node:os';
import { isatty } from 'node:tty';
import { Relay, logicalText } from './relay.mjs';

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const USAGE =
  'usage: rtlfix tui <program> [args...]\n' +
  '  e.g. rtlfix tui claude\n' +
  '       rtlfix tui qwen';

export function isClaude(cmd) {
  return cmd.slice(0, 3).some((a) => /(^|[/\\])claude(\.exe|\.js|\.mjs)?$|@anthropic-ai[/\\]claude-code/.test(String(a)));
}

export function childEnv(cmd, env = process.env, platform = process.platform) {
  const out = { ...env, RTLFIX_TUI: '1' };
  if (!isClaude(cmd) || platform === 'win32') return out;
  if (out.TERM_PROGRAM !== 'vscode' && out.WT_SESSION === undefined) return out;
  const inVsCode = out.TERM_PROGRAM === 'vscode';
  delete out.TERM_PROGRAM;
  delete out.TERM_PROGRAM_VERSION;
  delete out.WT_SESSION;
  if (inVsCode) out.CLAUDE_CODE_AUTO_CONNECT_IDE ??= 'true';
  out.CLAUDE_CODE_FORCE_SYNC_OUTPUT ??= '1';
  out.CLAUDE_CODE_FORCE_STRIKETHROUGH ??= '1';
  out.FORCE_HYPERLINK ??= '1';
  return out;
}

export function launcher(cmd) {
  return [
    `set -- ${cmd.map(shQuote).join(' ')}`,
    'if [ -n "${RTLFIX_SHELL+x}" ]; then SHELL=$RTLFIX_SHELL; export SHELL; else unset SHELL; fi',
    'unset RTLFIX_SHELL',
    'if [ -n "${RTLFIX_SIZE+x}" ]; then stty $RTLFIX_SIZE 2>/dev/null; stty iutf8 2>/dev/null; unset RTLFIX_SIZE; fi',
    'command -v "$1" >/dev/null 2>&1 || { echo "rtlfix: $1: command not found" >&2; exit 127; }',
    'set -m',
    'exec 3>&2 2>/dev/null',
    '"$@" 2>&3 3>&-',
    's=$?',
    'while [ "$s" -gt 128 ] && jobs %% >/dev/null; do fg %% >/dev/null; s=$?; done',
    'exit "$s"',
  ].join('\n');
}

export function programArgs(argv) {
  return argv[0] === '--' ? argv.slice(1) : argv;
}

const signalCode = (signal) => 128 + (constants.signals[signal] || 15);

function quiet(file, args) {
  try {
    return execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch (e) {
    return e.code === 'ENOENT' ? null : `${e.stdout || ''}${e.stderr || ''}`;
  }
}

function works(file, args) {
  try {
    execFileSync(file, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function jobsOf(pid) {
  try {
    const leaders = new Set(readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number));
    const groups = new Set();
    for (const name of readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
        const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const pgrp = Number(f[2]);
        const sid = Number(f[3]);
        if (leaders.has(sid) && pgrp !== sid) groups.add(pgrp);
      } catch { }
    }
    return [...groups];
  } catch {
    return [];
  }
}

function ptyOf(pid) {
  try {
    for (const kid of readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)) {
      const tty = readlinkSync(`/proc/${kid}/fd/0`);
      if (tty.startsWith('/dev/pts/')) return tty;
    }
  } catch { }
  return null;
}

function stty(args) {
  return execFileSync('stty', args, { stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
}

export function cursorPosition(timeout = 1000) {
  let saved;
  try { saved = stty(['-g']); } catch { return null; }
  try {
    stty(['raw', '-echo', 'min', '0', 'time', '1']);
    writeSync(1, '\x1b[6n');
    const buf = Buffer.alloc(64);
    let got = '';
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      let n = 0;
      try { n = readSync(0, buf, 0, buf.length, null); } catch (e) { if (e.code !== 'EAGAIN') break; }
      if (n > 0) got += buf.toString('latin1', 0, n);
      const m = got.match(/\x1b\[(\d+);(\d+)R/);
      if (m) return [Number(m[1]) - 1, Number(m[2]) - 1];
    }
    return null;
  } catch {
    return null;
  } finally {
    try { stty([saved]); } catch { }
  }
}

function runDirect(cmd, env = process.env, windows = null) {
  let child;
  if (windows && windows.isBatch(windows.program)) {
    child = spawn(windows.comspec(env), [windows.batchLine(windows.program, cmd.slice(1))], { stdio: 'inherit', env, windowsVerbatimArguments: true });
  } else {
    child = spawn(windows ? windows.program : cmd[0], cmd.slice(1), { stdio: 'inherit', env });
  }
  child.on('error', (e) => {
    console.error(`rtlfix: ${cmd[0]}: ${e.code === 'ENOENT' ? 'command not found' : e.message}`);
    process.exit(127);
  });
  for (const sig of ['SIGINT', 'SIGQUIT', 'SIGBREAK']) process.on(sig, () => { });
  for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  child.on('close', (code, signal) => process.exit(code ?? signalCode(signal)));
}

const NOTE = '\x1b]rtlfix;';
const COPY = '\x1b]52;';
const MOUSE = /\x1b\[<\d+;\d+;\d+[Mm]/g;
const CLIPBOARD = [
  '$d = (New-Object IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)).ReadToEnd() | ConvertFrom-Json',
  '$n = { param($t) if ($null -eq $t) { "" } else { ($t -replace "`r`n", "`n").TrimEnd("`n") } }',
  '$end = (Get-Date).AddSeconds(5)',
  'while ((Get-Date) -lt $end) { if ((& $n (Get-Clipboard -Raw)) -eq (& $n $d.x)) { Set-Clipboard -Value $d.y; break }; Start-Sleep -Milliseconds 100 }',
].join('; ');

function fixClipboard(from, to) {
  try {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(CLIPBOARD, 'utf16le').toString('base64')], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
    ps.on('error', () => { });
    ps.stdin.on('error', () => { });
    ps.stdin.end(JSON.stringify({ x: from, y: to }));
    ps.unref();
  } catch { }
}

function pipeRelay(child, { cursor, hello = false, filter = null, visual = false, markCells = false } = {}) {
  let relay = hello ? null : new Relay({ cols: process.stdout.columns, rows: process.stdout.rows, cursor, visual });
  let head = Buffer.alloc(0);
  let tail = Buffer.alloc(0);
  let failed = false;
  let timer = null;
  const write = (buf) => { if (buf.length) process.stdout.write(buf); };
  const render = (fn, raw) => {
    if (failed || !relay) return write(raw);
    try {
      write(fn());
    } catch {
      failed = true;
      write(raw);
    }
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => render(() => relay.tick(), Buffer.alloc(0)), 40);
  };
  let selecting = false;
  let held = Buffer.alloc(0);
  const input = (buf) => {
    if (visual) {
      const s = buf.toString('latin1');
      if (/\x1b\[<\d+;\d+;\d+m/.test(s)) selecting = true;
      else if (s.replace(MOUSE, '').replace(/\x03/g, '')) selecting = false;
    }
    if (failed || !relay) return buf;
    try { return relay.input(buf); } catch { return buf; }
  };
  const copied = (seq) => {
    const m = /^\x1b\]52;([^;]*);([A-Za-z0-9+/=]+)$/.exec(seq);
    if (!m || !selecting) return seq;
    const from = Buffer.from(m[2], 'base64').toString('utf8');
    const to = logicalText(from);
    if (to === from) return seq;
    if (process.platform === 'win32') fixClipboard(from, to);
    return `${COPY}${m[1]};${Buffer.from(to, 'utf8').toString('base64')}`;
  };
  const fixCopies = (buf) => {
    if (!visual) return buf;
    if (held.length) { buf = Buffer.concat([held, buf]); held = Buffer.alloc(0); }
    const s = buf.toString('latin1');
    let out = '';
    let from = 0;
    for (let at = s.indexOf(COPY); at >= 0; at = s.indexOf(COPY, from)) {
      const bel = s.indexOf('\x07', at);
      const st = s.indexOf('\x1b\\', at);
      const end = bel < 0 ? st : st < 0 ? bel : Math.min(bel, st);
      if (end < 0) {
        held = buf.subarray(at);
        return Buffer.from(out + s.slice(from, at), 'latin1');
      }
      out += s.slice(from, at) + copied(s.slice(at, end));
      from = end;
    }
    const k = s.lastIndexOf('\x1b');
    if (k >= from && COPY.startsWith(s.slice(k))) {
      held = buf.subarray(k);
      return Buffer.from(out + s.slice(from, k), 'latin1');
    }
    return out ? Buffer.from(out + s.slice(from), 'latin1') : buf;
  };
  child.stdout.on('data', (chunk) => {
    if (!relay) {
      head = Buffer.concat([head, chunk]);
      const nl = head.indexOf(0x0a);
      if (nl < 0 && head.length < 256) return;
      const m = /^rtlfix-conpty (\d+) (\d+) (\d+) (\d+)/.exec(head.subarray(0, Math.max(nl, 0)).toString('latin1'));
      relay = new Relay({
        cols: (m && Number(m[3])) || process.stdout.columns,
        rows: (m && Number(m[4])) || process.stdout.rows,
        cursor: m ? [Number(m[1]), Number(m[2])] : null,
        visual,
        markCells,
      });
      chunk = m ? head.subarray(nl + 1) : head;
      head = null;
      if (!chunk.length) return;
    }
    if (filter) {
      chunk = filter(chunk);
      if (!chunk.length) return;
    }
    if (hello) {
      chunk = Buffer.concat([tail, chunk]);
      const text = chunk.toString('latin1');
      let from = 0;
      for (let at = text.indexOf(NOTE); at >= 0; at = text.indexOf(NOTE, from)) {
        const end = text.indexOf('\x07', at);
        if (end < 0) break;
        const [kind, a, b] = text.slice(at + NOTE.length, end).split(';');
        const part = fixCopies(chunk.subarray(from, at));
        if (part.length) render(() => relay.push(part), part);
        if (kind === 'size' && Number(a) > 0 && Number(b) > 0) render(() => { relay.resize(Number(a), Number(b)); return Buffer.alloc(0); }, Buffer.alloc(0));
        if (kind === 'in' && a) child.stdin.write(input(Buffer.from(a, 'hex')));
        from = end + 1;
      }
      let keep = text.lastIndexOf('\x1b');
      const rest = keep < from ? '' : text.slice(keep);
      if (!rest || !(NOTE.startsWith(rest) || (rest.startsWith(NOTE) && !rest.includes('\x07')))) keep = text.length;
      tail = chunk.subarray(keep);
      chunk = chunk.subarray(from, keep);
    }
    chunk = fixCopies(chunk);
    if (chunk.length) render(() => relay.push(chunk), chunk);
    later();
  });
  process.stdout.on('resize', () => {
    if (relay && !failed) relay.resize(process.stdout.columns, process.stdout.rows);
  });
  return {
    input,
    finish: () => {
      clearTimeout(timer);
      const rest = Buffer.concat([held, tail]);
      if (rest.length) render(() => relay.push(rest), rest);
      if (relay && !failed) {
        try { write(relay.tick()); } catch { }
      }
    },
  };
}

async function tuiWindows(cmd, env) {
  const windows = await import('./windows.mjs');
  const program = windows.findProgram(cmd[0], env);
  if (!program) {
    console.error(`rtlfix: ${cmd[0]}: command not found`);
    process.exit(127);
  }
  const direct = { ...windows, program };
  if (!isatty(0) || !isatty(1)) return runDirect(cmd, env, direct);
  if (windows.windowsBuild() < 17763) {
    console.error(`rtlfix tui needs Windows 10 version 1809 or newer; starting ${cmd[0]} without it.`);
    return runDirect(cmd, env, direct);
  }
  let host;
  try {
    host = windows.conptyHost(env);
  } catch (e) {
    console.error(`rtlfix: ${e.message}; starting ${cmd[0]} without it.`);
    return runDirect(cmd, env, direct);
  }
  const hostEnv = { ...env, RTLFIX_COMMAND: windows.commandLine(program, cmd.slice(1), env) };
  const library = windows.editorConpty(env);
  if (library) hostEnv.RTLFIX_CONPTY = library;
  const child = spawn(host, [], { stdio: ['pipe', 'pipe', 'inherit'], env: hostEnv });
  child.stdin.on('error', () => { });
  child.on('error', (e) => {
    console.error(`rtlfix: cannot start the pseudo console helper (${e.message}).`);
    process.exit(1);
  });
  const io = pipeRelay(child, { hello: true, visual: isClaude(cmd), markCells: true });
  process.stdout.on('error', () => child.kill());
  for (const sig of ['SIGINT', 'SIGBREAK', 'SIGHUP', 'SIGTERM']) process.on(sig, () => child.kill());
  child.on('close', (code) => {
    io.finish();
    try { process.stdout.write('\x1b[?9001l\x1b[?1004l'); } catch { }
    process.exit(code ?? 1);
  });
}

export function tuiMain(argv) {
  const cmd = programArgs(argv);
  if (cmd.length === 0 || (argv[0] !== '--' && (cmd[0] === '-h' || cmd[0] === '--help'))) {
    (cmd.length ? console.log : console.error)(USAGE);
    process.exit(cmd.length ? 0 : 1);
  }
  const env = childEnv(cmd);
  if (process.platform === 'win32') {
    if (process.env.RTLFIX_TUI) {
      return import('./windows.mjs').then((windows) => {
        const program = windows.findProgram(cmd[0], env);
        if (!program) {
          console.error(`rtlfix: ${cmd[0]}: command not found`);
          process.exit(127);
        }
        runDirect(cmd, env, { ...windows, program });
      });
    }
    return tuiWindows(cmd, env);
  }
  if (process.env.RTLFIX_TUI) return runDirect(cmd, env);
  if (process.platform !== 'linux') {
    console.error(`rtlfix tui needs Linux, WSL or Windows; starting ${cmd[0]} without it.`);
    return runDirect(cmd, env);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) return runDirect(cmd, env);
  const version = quiet('script', ['--version']);
  if (!version || !version.includes('util-linux')) {
    console.error(`rtlfix tui needs "script" from util-linux${version === null ? '' : ' (this one is not)'}; starting ${cmd[0]} without it.`);
    return runDirect(cmd, env);
  }

  let saved = null;
  try { saved = stty(['-g']); } catch { }
  const cursor = cursorPosition();

  const scriptEnv = { ...env, SHELL: '/bin/sh', RTLFIX_SIZE: `rows ${process.stdout.rows} cols ${process.stdout.columns}` };
  delete scriptEnv.RTLFIX_SHELL;
  if (process.env.SHELL !== undefined) scriptEnv.RTLFIX_SHELL = process.env.SHELL;
  const scriptArgs = ['-q', '-e', '-c', launcher(cmd), '/dev/null'];
  const [file, args] = works('setpriv', ['--pdeathsig', 'TERM', 'true'])
    ? ['setpriv', ['--pdeathsig', 'TERM', 'script', ...scriptArgs]]
    : ['script', scriptArgs];
  const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'inherit'], env: scriptEnv });
  child.on('error', (e) => {
    if (saved) try { stty([saved]); } catch { }
    console.error(`rtlfix tui: cannot start "script" from util-linux (${e.message}).`);
    process.exit(1);
  });
  try { stty(['raw', '-echo']); } catch { }

  let stopping = null;
  const io = pipeRelay(child, {
    cursor,
    filter: (chunk) => {
      if (!stopping) return chunk;
      const text = chunk.toString('latin1').replace(/\r?\n?Session terminated, killing shell\.\.\.|\s*\.\.\.killed\.\r?\n?/g, '');
      return Buffer.from(text, 'latin1');
    },
  });
  process.stdout.on('error', () => child.kill('SIGTERM'));
  child.stdin.on('error', () => { });
  process.stdin.on('data', (data) => child.stdin.write(io.input(data)));
  let tty = null;
  process.stdout.on('resize', () => {
    tty ??= ptyOf(child.pid);
    if (!tty) return;
    try { execFileSync('stty', ['-F', tty, 'rows', String(process.stdout.rows), 'cols', String(process.stdout.columns)], { stdio: 'ignore' }); } catch { }
  });

  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
    process.on(sig, () => {
      const first = !stopping;
      stopping ??= sig;
      let sent = false;
      for (const pgrp of jobsOf(child.pid)) {
        try { process.kill(-pgrp, sig); sent = true; } catch { }
      }
      if (!sent) child.kill('SIGTERM');
      if (first) {
        setTimeout(() => child.kill('SIGTERM'), 3000).unref();
        setTimeout(() => child.kill('SIGKILL'), 6000).unref();
      }
    });
  }
  child.on('close', (code, signal) => {
    io.finish();
    if (saved) {
      try { stty([saved]); } catch { }
    }
    if (stopping) process.exit(signalCode(stopping));
    process.exit(code ?? signalCode(signal));
  });
}
