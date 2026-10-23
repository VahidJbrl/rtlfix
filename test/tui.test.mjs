import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { childEnv, launcher } from '../src/tui.mjs';

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
  const own = childEnv(['/opt/bin/claude'], { TERM_PROGRAM: 'vscode', CLAUDE_CODE_AUTO_CONNECT_IDE: 'false' });
  assert.equal(own.CLAUDE_CODE_AUTO_CONNECT_IDE, 'false');
});

test('other programs and other terminals are left alone', () => {
  const vs = { TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.100.0' };
  assert.deepEqual(childEnv(['qwen'], vs), vs);
  assert.deepEqual(childEnv(['claude'], { TERM_PROGRAM: 'WezTerm' }), { TERM_PROGRAM: 'WezTerm' });
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
  const cli = new URL('../src/cli.mjs', import.meta.url).pathname;
  const r = spawnSync(process.execPath, [cli, 'tui', 'sh', '-c', 'echo hi; exit 5'], { encoding: 'utf8', input: '' });
  assert.equal(r.status, 5);
  assert.equal(r.stdout, 'hi\n');
});
