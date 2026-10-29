import { spawn, execFileSync } from 'node:child_process';
import { readSync, writeSync, readFileSync, readdirSync } from 'node:fs';
import { constants } from 'node:os';
import { Relay } from './relay.mjs';

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const USAGE =
  'usage: rtlfix tui <program> [args...]\n' +
  '  e.g. rtlfix tui claude\n' +
  '       rtlfix tui qwen';

export function isClaude(cmd) {
  return cmd.slice(0, 3).some((a) => /(^|[/\\])claude(\.exe|\.js|\.mjs)?$|@anthropic-ai[/\\]claude-code/.test(String(a)));
}

export function childEnv(cmd, env = process.env) {
  const out = { ...env, RTLFIX_TUI: '1' };
  if (!isClaude(cmd)) return out;
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

function runDirect(cmd, env = process.env) {
  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', env });
  child.on('error', (e) => {
    console.error(`rtlfix: ${cmd[0]}: ${e.code === 'ENOENT' ? 'command not found' : e.message}`);
    process.exit(127);
  });
  for (const sig of ['SIGINT', 'SIGQUIT']) process.on(sig, () => { });
  for (const sig of ['SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
  child.on('close', (code, signal) => process.exit(code ?? signalCode(signal)));
}

export function tuiMain(argv) {
  const cmd = programArgs(argv);
  if (cmd.length === 0 || (argv[0] !== '--' && (cmd[0] === '-h' || cmd[0] === '--help'))) {
    (cmd.length ? console.log : console.error)(USAGE);
    process.exit(cmd.length ? 0 : 1);
  }
  const env = childEnv(cmd);
  if (process.env.RTLFIX_TUI) return runDirect(cmd, env);
  if (process.platform !== 'linux') {
    console.error(`rtlfix tui needs Linux or WSL; starting ${cmd[0]} without it.`);
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

  const scriptEnv = { ...env, SHELL: '/bin/sh' };
  delete scriptEnv.RTLFIX_SHELL;
  if (process.env.SHELL !== undefined) scriptEnv.RTLFIX_SHELL = process.env.SHELL;
  const scriptArgs = ['-q', '-e', '-c', launcher(cmd), '/dev/null'];
  const [file, args] = works('setpriv', ['--pdeathsig', 'TERM', 'true'])
    ? ['setpriv', ['--pdeathsig', 'TERM', 'script', ...scriptArgs]]
    : ['script', scriptArgs];
  const child = spawn(file, args, { stdio: ['inherit', 'pipe', 'inherit'], env: scriptEnv });
  child.on('error', (e) => {
    console.error(`rtlfix tui: cannot start "script" from util-linux (${e.message}).`);
    process.exit(1);
  });

  const relay = new Relay({ cols: process.stdout.columns, rows: process.stdout.rows, cursor });
  let failed = false;
  let stopping = null;
  const write = (buf) => { if (buf.length) process.stdout.write(buf); };
  const render = (fn, raw) => {
    if (failed) return write(raw);
    try {
      write(fn());
    } catch {
      failed = true;
      write(raw);
    }
  };

  let timer = null;
  child.stdout.on('data', (chunk) => {
    if (stopping) {
      const text = chunk.toString('latin1').replace(/\r?\n?Session terminated, killing shell\.\.\.|\s*\.\.\.killed\.\r?\n?/g, '');
      if (!text) return;
      chunk = Buffer.from(text, 'latin1');
    }
    render(() => relay.push(chunk), chunk);
    clearTimeout(timer);
    timer = setTimeout(() => render(() => relay.tick(), Buffer.alloc(0)), 40);
  });
  process.stdout.on('resize', () => {
    if (!failed) relay.resize(process.stdout.columns, process.stdout.rows);
  });
  process.stdout.on('error', () => child.kill('SIGTERM'));

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
    clearTimeout(timer);
    if (!failed) {
      try { write(relay.tick()); } catch { }
    }
    if ((signal || stopping) && saved) {
      try { stty([saved]); } catch { }
    }
    if (stopping) process.exit(signalCode(stopping));
    process.exit(code ?? signalCode(signal));
  });
}
