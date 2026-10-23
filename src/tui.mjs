import { spawn, execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { Relay } from './relay.mjs';

const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export function childEnv(cmd, env = process.env) {
  const out = { ...env };
  if (basename(cmd[0]) !== 'claude') return out;
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

function hasPdeathsig() {
  try {
    execFileSync('setpriv', ['--pdeathsig', 'TERM', 'true'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function stty(args) {
  return execFileSync('stty', args, { stdio: ['inherit', 'pipe', 'ignore'], encoding: 'utf8' }).trim();
}

function runDirect(cmd) {
  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit' });
  child.on('error', (e) => {
    console.error(`rtlfix: ${cmd[0]}: ${e.code === 'ENOENT' ? 'command not found' : e.message}`);
    process.exit(127);
  });
  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(sig, () => child.kill(sig));
  child.on('close', (code, signal) => process.exit(code ?? 128 + 15));
}

export function tuiMain(argv) {
  const cmd = argv.filter((a) => a !== '--');
  if (cmd.length === 0) {
    console.error(
      'usage: rtlfix tui <program> [args...]\n' +
      '  e.g. rtlfix tui claude\n' +
      '       rtlfix tui qwen',
    );
    process.exit(1);
  }
  if (process.platform !== 'linux') {
    console.error(`rtlfix tui needs Linux or WSL; starting ${cmd[0]} without it.`);
    return runDirect(cmd);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) return runDirect(cmd);

  let saved = null;
  try { saved = stty(['-g']); } catch { }

  const env = { ...childEnv(cmd), SHELL: '/bin/sh' };
  delete env.RTLFIX_SHELL;
  if (process.env.SHELL !== undefined) env.RTLFIX_SHELL = process.env.SHELL;
  const scriptArgs = ['-q', '-e', '-c', launcher(cmd), '/dev/null'];
  const [file, args] = hasPdeathsig()
    ? ['setpriv', ['--pdeathsig', 'TERM', 'script', ...scriptArgs]]
    : ['script', scriptArgs];
  const child = spawn(file, args, { stdio: ['inherit', 'pipe', 'inherit'], env });
  child.on('error', (e) => {
    console.error(`rtlfix tui: cannot start "script" from util-linux (${e.message}).`);
    process.exit(1);
  });

  const relay = new Relay({ cols: process.stdout.columns, rows: process.stdout.rows });
  let failed = false;
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
    render(() => relay.push(chunk), chunk);
    clearTimeout(timer);
    timer = setTimeout(() => render(() => relay.tick(), Buffer.alloc(0)), 40);
  });
  process.stdout.on('resize', () => {
    if (!failed) relay.resize(process.stdout.columns, process.stdout.rows);
  });
  process.stdout.on('error', () => child.kill('SIGTERM'));

  for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
    process.on(sig, () => child.kill('SIGTERM'));
  }
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    if (!failed) {
      try { write(relay.tick()); } catch { }
    }
    if (signal && saved) {
      try { stty([saved]); } catch { }
    }
    process.exit(code ?? 128 + 15);
  });
}
