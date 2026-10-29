import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv, launcher, programArgs, isClaude } from '../src/tui.mjs';

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
  const env = childEnv(['claude'], { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.100.0', PATH: '/bin' });
  assert.equal(env.TERM_PROGRAM, undefined);
  assert.equal(env.TERM_PROGRAM_VERSION, undefined);
  assert.equal(env.CLAUDE_CODE_AUTO_CONNECT_IDE, 'true');
  assert.equal(env.CLAUDE_CODE_FORCE_SYNC_OUTPUT, '1');
  assert.equal(env.CLAUDE_CODE_FORCE_STRIKETHROUGH, '1');
  assert.equal(env.FORCE_HYPERLINK, '1');
  assert.equal(env.PATH, '/bin');
  assert.equal(env.RTLFIX_TUI, '1');
  const own = childEnv(['/opt/bin/claude'], { TERM_PROGRAM: 'vscode', CLAUDE_CODE_AUTO_CONNECT_IDE: 'false' });
  assert.equal(own.CLAUDE_CODE_AUTO_CONNECT_IDE, 'false');
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

test('without a terminal the program simply runs', () => {
  const r = spawnSync(process.execPath, [BIN, 'tui', 'sh', '-c', 'echo hi "$@"; exit 5', 'x', '--', 'a'], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 5);
  assert.equal(r.stdout, 'hi -- a\n');
  const k = spawnSync(process.execPath, [BIN, 'tui', 'sh', '-c', 'kill -TERM $$'], { encoding: 'utf8', input: '' });
  assert.equal(k.status, 143);
  assert.equal(spawnSync(process.execPath, [BIN, 'tui', '--help'], { encoding: 'utf8' }).status, 0);
});

test('inside rtlfix, rtlfix runs the program directly', () => {
  const r = spawnSync(process.execPath, [BIN, 'tui', 'sh', '-c', 'echo "$RTLFIX_TUI"'], { encoding: 'utf8', input: '', env: { ...process.env, RTLFIX_TUI: '1' } });
  assert.equal(r.stdout, '1\n');
});
