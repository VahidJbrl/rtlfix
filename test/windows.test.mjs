import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { quoteArg, batchLine, commandLine, findProgram, editorConpty, privateConpty, cacheDir, conptyHost } from '../src/windows.mjs';

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

test('a VS Code that keeps its app in a versioned folder is found, newest version first', () => {
  const dir = join('resources', 'app', 'node_modules.asar.unpacked', 'node-pty', 'build', 'Release', 'conpty');
  const files = (version) => [join('Code', version, dir, 'conpty.dll'), join('Code', version, dir, 'OpenConsole.exe')];
  const t = tree([join('Code', 'Code.exe'), ...files('e646868227'), ...files('c4453f8ea4')]);
  try {
    utimesSync(join(t.root, 'Code', 'e646868227'), 1000, 1000);
    const env = { TERM_PROGRAM: 'vscode', VSCODE_GIT_ASKPASS_NODE: join(t.root, 'Code', 'Code.exe') };
    assert.equal(editorConpty(env), join(t.root, 'Code', 'c4453f8ea4', dir, 'conpty.dll'));
  } finally {
    t.done();
  }
});

test('an editor console host is used from a private copy, so the editor stays free to update itself', () => {
  const t = tree(['editor/conpty.dll', 'editor/OpenConsole.exe', 'cache/console-0123456789ab/conpty.dll', 'cache/keep.txt']);
  try {
    const env = { RTLFIX_CACHE: join(t.root, 'cache') };
    const from = join(t.root, 'editor', 'conpty.dll');
    const copy = privateConpty(from, env);
    assert.notEqual(copy, from);
    assert.equal(dirname(dirname(copy)), join(t.root, 'cache'));
    assert.ok(existsSync(copy) && existsSync(join(dirname(copy), 'OpenConsole.exe')));
    assert.ok(!existsSync(join(t.root, 'cache', 'console-0123456789ab')));
    assert.ok(existsSync(join(t.root, 'cache', 'keep.txt')));
    assert.equal(privateConpty(from, env), copy);
    const missing = join(t.root, 'gone', 'conpty.dll');
    assert.equal(privateConpty(missing, env), missing);
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
    assert.match(r.stdout, /^rtlfix-conpty \d+ \d+ \d+ \d+ [01]\n/);
    assert.match(r.stdout, /rtlfix-ok/);
    assert.equal(conptyHost(env), host);
  } finally {
    t.done();
  }
});

test('a process the program leaves running in the background outlives it', { skip: process.platform !== 'win32' }, async () => {
  const t = tree([]);
  try {
    const env = { ...process.env, RTLFIX_CACHE: t.root };
    const mark = join(t.root, 'mark.txt');
    const later = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(mark)}, 'ok'), 1500)`;
    const start = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(later)}], { detached: true, stdio: 'ignore', windowsHide: true }).unref()`;
    const r = spawnSync(conptyHost(env), [], {
      encoding: 'utf8',
      input: '\x1b[1;1R',
      timeout: 60000,
      env: { ...env, RTLFIX_COMMAND: commandLine(process.execPath, ['-e', start], env) },
    });
    assert.equal(r.status, 0, r.stderr);
    await new Promise((done) => setTimeout(done, 3000));
    assert.ok(existsSync(mark));
  } finally {
    t.done();
  }
});
