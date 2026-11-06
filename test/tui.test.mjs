import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv, launcher, programArgs, isClaude } from '../src/tui.mjs';
import { preShapeArabic } from '../src/shaping.mjs';

const BIN = fileURLToPath(new URL('../bin/rtlfix.cjs', import.meta.url));
const hasScript = process.platform === 'linux' &&
  spawnSync('script', ['--version'], { encoding: 'utf8' }).stdout?.includes('util-linux');

function runLauncher(cmd) {
  return spawnSync('script', ['-q', '-e', '-c', launcher(cmd), '/dev/null'], {
    encoding: 'utf8',
    env: { ...process.env, SHELL: '/bin/sh', RTLFIX_SHELL: '/bin/bash' },
    input: '',
  });
}

test('Claude Code in VS Code starts without its own bidi', () => {
  const env = childEnv(['claude'], { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.100.0', PATH: '/bin' }, 'linux');
  assert.equal(env.TERM_PROGRAM, undefined);
  assert.equal(env.TERM_PROGRAM_VERSION, undefined);
  assert.equal(env.CLAUDE_CODE_AUTO_CONNECT_IDE, 'true');
  assert.equal(env.CLAUDE_CODE_FORCE_SYNC_OUTPUT, '1');
  assert.equal(env.CLAUDE_CODE_FORCE_STRIKETHROUGH, '1');
  assert.equal(env.FORCE_HYPERLINK, '1');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.RTLFIX_TUI, '1');
  const own = childEnv(['/opt/bin/claude'], { TERM_PROGRAM: 'vscode', CLAUDE_CODE_AUTO_CONNECT_IDE: 'false' }, 'linux');
  assert.equal(own.CLAUDE_CODE_AUTO_CONNECT_IDE, 'false');
});

test('on Windows Claude Code keeps its editor settings, since it reorders text there anyway', () => {
  const vs = { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.100.0' };
  assert.deepEqual(childEnv(['claude'], vs, 'win32'), { ...vs, RTLFIX_TUI: '1' });
});

test('Claude Code is recognised however it is started', () => {
  for (const cmd of [['claude'], ['/usr/local/bin/claude', '-c'], ['npx', '@anthropic-ai/claude-code'], ['node', '/x/node_modules/@anthropic-ai/claude-code/cli.js'], ['bash', '-c', 'claude']]) {
    assert.ok(isClaude(cmd), cmd.join(' '));
  }
  for (const cmd of [['qwen'], ['bash'], ['vim', 'claude.txt'], ['claude-monitor']]) assert.ok(!isClaude(cmd), cmd.join(' '));
});

test('other programs and other terminals are left alone', () => {
  const vs = { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.100.0' };
  assert.deepEqual(childEnv(['qwen'], vs), { ...vs, RTLFIX_TUI: '1' });
  assert.deepEqual(childEnv(['claude'], { TERM_PROGRAM: 'WezTerm' }), { TERM_PROGRAM: 'WezTerm', RTLFIX_TUI: '1' });
});

test('only a leading -- is removed from the program arguments', () => {
  assert.deepEqual(programArgs(['--', 'sh', '-c', 'x', '--', 'y']), ['sh', '-c', 'x', '--', 'y']);
  assert.deepEqual(programArgs(['npm', 'run', 'dev', '--', '--port', '3']), ['npm', 'run', 'dev', '--', '--port', '3']);
});

test('the launcher passes on the exit status and restores SHELL', { skip: !hasScript }, () => {
  const r = runLauncher(['sh', '-c', 'echo "shell=$SHELL"; exit 7']);
  assert.equal(r.status, 7);
  assert.match(r.stdout, /shell=\/bin\/bash/);
});

test('the launcher resumes a program that suspends itself', { skip: !hasScript }, () => {
  const r = runLauncher(['sh', '-c', 'echo before; kill -TSTP $$; echo after; exit 3']);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /before[\s\S]*after/);
});

test('the launcher reports a missing program', { skip: !hasScript }, () => {
  const r = runLauncher(['no-such-program-rtlfix']);
  assert.equal(r.status, 127);
  assert.match(r.stdout, /no-such-program-rtlfix: command not found/);
});

test('without a terminal the program simply runs', { skip: process.platform === 'win32' }, () => {
  const r = spawnSync(process.execPath, [BIN, 'tui', 'sh', '-c', 'echo hi "$@"; exit 5', 'x', '--', 'a'], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 5);
  assert.equal(r.stdout, 'hi -- a\n');
  const k = spawnSync(process.execPath, [BIN, 'tui', 'sh', '-c', 'kill -TERM $$'], { encoding: 'utf8', input: '' });
  assert.equal(k.status, 143);
  assert.equal(spawnSync(process.execPath, [BIN, 'tui', '--help'], { encoding: 'utf8' }).status, 0);
});

test('without a terminal a program found by its path runs with its arguments', () => {
  const r = spawnSync(process.execPath, [BIN, 'tui', process.execPath, '-e', 'console.log(process.argv.slice(1).join("|")); process.exit(5)', 'x', 'a b', '"q"'], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 5);
  assert.equal(r.stdout.trim(), 'x|a b|"q"');
});

test('inside rtlfix, rtlfix runs the program directly', () => {
  const r = spawnSync(process.execPath, [BIN, 'tui', process.execPath, '-e', 'console.log(process.env.RTLFIX_TUI)'], { encoding: 'utf8', input: '', env: { ...process.env, RTLFIX_TUI: '1' } });
  assert.equal(r.stdout.trim(), '1');
});

function inPty(command) {
  const args = process.platform === 'darwin' ? ['-q', '/dev/null', '/bin/sh', '-c', command] : ['-q', '-e', '-c', command, '/dev/null'];
  return new Promise((resolve) => {
    const p = spawn('script', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SHELL: '/bin/sh', RTLFIX_TEST: 'سلام' } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => p.kill('SIGKILL'), 30000);
    p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

test('in a terminal the program gets its own pseudo-terminal and Persian is drawn', { skip: !(hasScript || process.platform === 'darwin') }, async () => {
  const r = await inPty(`stty rows 24 cols 80; "${process.execPath}" "${BIN}" tui sh -c 'stty size; printf "%s\\n" "$RTLFIX_TEST"; exit 3'`);
  assert.equal(r.status, 3, `${r.stderr}\n${r.stdout}`);
  assert.match(r.stdout, /24 80/);
  assert.ok(r.stdout.includes([...preShapeArabic('سلام')].reverse().join('')), r.stdout);
  assert.ok(!r.stdout.includes('rtlfix;tty'));
});

test('a program that suspends itself gives the terminal back to the shell, and fg brings it back', { skip: !(hasScript || process.platform === 'darwin') }, async () => {
  const [file, args] = process.platform === 'darwin'
    ? ['/bin/bash', ['-c', 'exec script -q /dev/null /bin/bash --norc --noprofile -i < <(exec cat)']]
    : ['script', ['-q', '-e', '-c', 'bash --norc --noprofile -i', '/dev/null']];
  const p = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, SHELL: '/bin/sh', PS1: 'ready> ', RTLFIX_TUI: '' } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  const closed = new Promise((done) => p.on('close', done));
  const shows = async (re) => {
    for (let i = 0; i < 400 && !re.test(out); i++) await new Promise((done) => setTimeout(done, 50));
    assert.match(out, re);
  };
  try {
    p.stdin.write(`"${process.execPath}" "${BIN}" tui sh -c 'echo BE""FORE; kill -TSTP $$; echo AF""TER; exit 3'\n`);
    await shows(/BEFORE/);
    await shows(/Stopped/);
    p.stdin.write('echo IN""SHELL\n');
    await shows(/INSHELL/);
    assert.doesNotMatch(out, /AFTER/);
    p.stdin.write('fg\n');
    await shows(/AFTER/);
    p.stdin.write('echo status=$?\n');
    await shows(/status=3/);
    p.stdin.write('exit\n');
    await closed;
  } finally {
    p.kill('SIGKILL');
  }
});
