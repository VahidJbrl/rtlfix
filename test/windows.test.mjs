import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { quoteArg, batchLine, commandLine, findProgram, editorConpty, cacheDir, conptyHost } from '../src/windows.mjs';

function tree(files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rtlfix-win-')));
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}

test('arguments are quoted the way Windows programs split them', () => {
  assert.equal(quoteArg(''), '""');
  assert.equal(quoteArg('abc'), 'abc');
  assert.equal(quoteArg('a b'), '"a b"');
  assert.equal(quoteArg('a"b'), '"a\\"b"');
  assert.equal(quoteArg('a\\'), 'a\\');
  assert.equal(quoteArg('a b\\'), '"a b\\\\"');
  assert.equal(quoteArg('a\\"b'), '"a\\\\\\"b"');
  assert.equal(
    commandLine('C:\\Program Files\\nodejs\\node.exe', ['-e', 'console.log("hi")', ''], {}),
    '"C:\\Program Files\\nodejs\\node.exe" -e "console.log(\\"hi\\")" ""',
  );
});

test('batch files run through cmd.exe with every special character escaped', () => {
  assert.equal(
    batchLine('C:\\npm\\claude.cmd', ['a&b', 'c"d', '100%']),
    '/d /s /c "C:\\npm\\claude.cmd ^^^"a^^^&b^^^" ^^^"c\\^^^"d^^^" ^^^"100^^^%^^^""',
  );
  assert.equal(
    commandLine('C:\\npm\\claude.cmd', ['-c'], { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }),
    'C:\\Windows\\system32\\cmd.exe /d /s /c "C:\\npm\\claude.cmd ^^^"-c^^^""',
  );
});

test('programs are found on PATH with PATHEXT, as cmd.exe finds them', () => {
  const t = tree(['bin/tool.cmd', 'bin/other.exe', 'here/tool.exe']);
  try {
    const env = { Path: join(t.root, 'bin'), PATHEXT: '.EXE;.CMD' };
    assert.equal(findProgram('tool', env), join(t.root, 'bin', 'tool.cmd'));
    assert.equal(findProgram('tool.cmd', env), join(t.root, 'bin', 'tool.cmd'));
    assert.equal(findProgram(join(t.root, 'bin', 'other'), env), join(t.root, 'bin', 'other.exe'));
    assert.equal(findProgram('missing', env), null);
  } finally {
    t.done();
  }
});

test('the console host that VS Code and similar editors ship is used when it is there', () => {
  const dir = join('resources', 'app', 'node_modules', 'node-pty', 'build', 'Release', 'conpty');
  const t = tree([join('Code', dir, 'conpty.dll'), join('Code', dir, 'OpenConsole.exe'), join('Half', dir, 'conpty.dll')]);
  try {
    const env = { TERM_PROGRAM: 'vscode', VSCODE_GIT_ASKPASS_NODE: join(t.root, 'Code', 'Code.exe') };
    assert.equal(editorConpty(env), join(t.root, 'Code', dir, 'conpty.dll'));
    assert.equal(editorConpty({ ...env, TERM_PROGRAM: 'WezTerm' }), null);
    assert.equal(editorConpty({ TERM_PROGRAM: 'vscode', VSCODE_GIT_ASKPASS_NODE: join(t.root, 'Half', 'Code.exe') }), null);
  } finally {
    t.done();
  }
});

test('the helper is kept in the local app data folder unless told otherwise', () => {
  assert.equal(cacheDir({ RTLFIX_CACHE: join('x', 'cache') }), join('x', 'cache'));
  assert.equal(cacheDir({ LOCALAPPDATA: join('x', 'Local') }), join('x', 'Local', 'rtlfix'));
});

test('the pseudo console helper builds, runs a program and passes on its exit code', { skip: process.platform !== 'win32' }, () => {
  const t = tree([]);
  try {
    const env = { ...process.env, RTLFIX_CACHE: t.root };
    const host = conptyHost(env);
    const r = spawnSync(host, [], {
      encoding: 'utf8',
      input: '\x1b[1;1R',
      timeout: 60000,
      env: { ...env, RTLFIX_COMMAND: commandLine(process.execPath, ['-e', 'console.log("rtlfix-ok"); process.exit(3)'], env) },
    });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /^rtlfix-conpty \d+ \d+ \d+ \d+\n/);
    assert.match(r.stdout, /rtlfix-ok/);
    assert.equal(conptyHost(env), host);
  } finally {
    t.done();
  }
});
