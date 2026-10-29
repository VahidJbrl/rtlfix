import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/rtlfix.cjs', import.meta.url));

function sandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rtlfix-test-')));
  const env = { ...process.env, RTLFIX_HOME: join(root, 'share', 'rtlfix'), RTLFIX_BIN: join(root, 'bin'), PATH: `${join(root, 'bin')}:${process.env.PATH}` };
  const run = (file, args, extra = {}) => spawnSync(file, args, { encoding: 'utf8', env: { ...env, ...extra } });
  return { root, env, run, home: env.RTLFIX_HOME, link: join(env.RTLFIX_BIN, 'rtlfix'), done: () => rmSync(root, { recursive: true, force: true }) };
}

test('install, reinstall from the installed copy, and uninstall', () => {
  const s = sandbox();
  try {
    assert.equal(s.run(process.execPath, [BIN, 'install']).status, 0);
    assert.match(s.run(s.link, ['--version']).stdout, /^\d+\.\d+\.\d+\n$/);
    const again = s.run(s.link, ['install']);
    assert.equal(again.status, 0, again.stderr);
    assert.match(s.run(s.link, ['--version']).stdout, /^\d+\.\d+\.\d+\n$/);
    writeFileSync(join(s.home, 'notes.txt'), 'mine');
    assert.equal(s.run(s.link, ['uninstall', '--help']).status, 1);
    assert.ok(existsSync(join(s.home, 'src')));
    assert.equal(s.run(process.execPath, [BIN, 'uninstall']).status, 0);
    assert.ok(!existsSync(s.link));
    assert.ok(!existsSync(join(s.home, 'src')));
    assert.equal(readFileSync(join(s.home, 'notes.txt'), 'utf8'), 'mine');
  } finally {
    s.done();
  }
});

test('the installed command still works after the recorded Node.js is gone', () => {
  const s = sandbox();
  try {
    assert.equal(s.run(process.execPath, [BIN, 'install']).status, 0);
    const launcher = join(s.home, 'rtlfix');
    writeFileSync(launcher, readFileSync(launcher, 'utf8').replace(/^node=.*$/m, "node='/nonexistent/node'"));
    const r = s.run(s.link, ['--version'], { PATH: `${join(process.execPath, '..')}:/usr/bin:/bin` });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    s.done();
  }
});

test('install refuses to overwrite things it does not own', () => {
  const s = sandbox();
  try {
    mkdirSync(join(s.root, 'bin'), { recursive: true });
    symlinkSync('/usr/bin/true', s.link);
    const r = s.run(process.execPath, [BIN, 'install']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not created by rtlfix install/);
    rmSync(s.link);
    mkdirSync(s.home, { recursive: true });
    writeFileSync(join(s.home, 'important'), 'x');
    const q = s.run(process.execPath, [BIN, 'install']);
    assert.equal(q.status, 1);
    assert.match(q.stderr, /refusing/);
  } finally {
    s.done();
  }
});

test('doctor reports problems in its exit status', () => {
  const s = sandbox();
  try {
    const ok = s.run(process.execPath, [BIN, 'doctor']);
    assert.match(ok.stdout, /node/);
    const bad = s.run(process.execPath, [BIN, 'doctor'], { PATH: '/nonexistent' });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /✗ script/);
  } finally {
    s.done();
  }
});
