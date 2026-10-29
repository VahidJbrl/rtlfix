import {
  existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, chmodSync, rmSync, renameSync,
  symlinkSync, lstatSync, readlinkSync, realpathSync, readdirSync, rmdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, delimiter, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
const ENTRIES = ['package.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'src', 'bin'];
const MARKER = '.rtlfix.json';
const LAUNCHER = 'rtlfix';

const installDir = () => resolve(process.env.RTLFIX_HOME || join(homedir(), '.local', 'share', 'rtlfix'));
const binDir = () => resolve(process.env.RTLFIX_BIN || join(homedir(), '.local', 'bin'));
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const strip = (p) => p.replace(/\/+$/, '') || '/';

function lstatSafe(p) {
  try { return lstatSync(p); } catch { return null; }
}

function real(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

function which(name) {
  for (const d of (process.env.PATH || '').split(delimiter)) {
    const p = join(d, name);
    if (d && existsSync(p)) return p;
  }
  return null;
}

function rejectArgs(cmd, argv) {
  if (argv.length) {
    console.error(`rtlfix ${cmd}: unexpected argument ${argv[0]}`);
    process.exit(1);
  }
}

function ownsDir(dir) {
  return existsSync(join(dir, MARKER));
}

function rcHint(bin) {
  const shell = basename(process.env.SHELL || '');
  const line = `export PATH="${bin}:$PATH"`;
  if (shell === 'fish') return `fish_add_path ${bin}`;
  const rc = shell === 'zsh' ? '~/.zshrc' : shell === 'bash' ? '~/.bashrc' : '~/.profile';
  return `echo '${line}' >> ${rc} && . ${rc}`;
}

function launcherScript(dir) {
  const entry = join(dir, 'bin', 'rtlfix.cjs');
  return [
    '#!/bin/sh',
    `node=${shQuote(process.execPath)}`,
    '[ -x "$node" ] || node=$(command -v node) || {',
    `  echo "rtlfix: Node.js was not found. Install Node.js 18 or newer, then run: node ${entry} install" >&2`,
    '  exit 127',
    '}',
    `exec "$node" ${shQuote(entry)} "$@"`,
    '',
  ].join('\n');
}

export function install(argv = []) {
  rejectArgs('install', argv);
  if (process.platform === 'win32') {
    console.error('rtlfix install sets rtlfix up on Linux. On Windows, install it with npm:');
    console.error('  npm install -g github:VahidJbrl/rtlfix');
    process.exit(1);
  }
  const dir = installDir();
  const bin = binDir();
  const link = join(bin, 'rtlfix');
  const launcher = join(dir, LAUNCHER);

  const st = lstatSafe(link);
  if (st && !(st.isSymbolicLink() && resolve(dirname(link), readlinkSync(link)).startsWith(dir + '/'))) {
    console.error(`rtlfix install: ${link} already exists and was not created by rtlfix install`);
    console.error('(perhaps by npm). Remove it first, or keep using that installation.');
    process.exit(1);
  }
  if (existsSync(dir) && !ownsDir(dir) && readdirSync(dir).length > 0) {
    console.error(`rtlfix install: ${dir} is not empty and does not look like an rtlfix install; refusing to write there.`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  if (real(PKG_DIR) !== real(dir)) {
    for (const name of ENTRIES) {
      const from = join(PKG_DIR, name);
      if (!existsSync(from)) continue;
      const to = join(dir, name);
      const next = `${to}.new-${process.pid}`;
      const old = `${to}.old-${process.pid}`;
      rmSync(next, { recursive: true, force: true });
      cpSync(from, next, { recursive: true });
      if (existsSync(to)) renameSync(to, old);
      renameSync(next, to);
      rmSync(old, { recursive: true, force: true });
    }
  }
  writeFileSync(launcher, launcherScript(dir));
  chmodSync(launcher, 0o755);
  writeFileSync(join(dir, MARKER), JSON.stringify({ version: PKG.version, entries: [...ENTRIES, LAUNCHER] }) + '\n');

  mkdirSync(bin, { recursive: true });
  if (lstatSafe(link)) rmSync(link, { force: true });
  symlinkSync(launcher, link);

  console.log(`rtlfix ${PKG.version} installed`);
  console.log(`  files:   ${dir}`);
  console.log(`  command: ${link}`);
  const onPath = (process.env.PATH || '').split(delimiter).some((p) => p && strip(p) === strip(bin));
  if (!onPath) {
    console.log(`\n  ${bin} is not on your PATH yet. Add it with:`);
    console.log(`    ${rcHint(bin)}`);
  }
  console.log('\n  Next: rtlfix claude   or   rtlfix qwen');
}

export function uninstall(argv = []) {
  rejectArgs('uninstall', argv);
  const dir = installDir();
  const link = join(binDir(), 'rtlfix');
  const st = lstatSafe(link);
  if (st?.isSymbolicLink() && resolve(dirname(link), readlinkSync(link)).startsWith(dir + '/')) {
    rmSync(link, { force: true });
    console.log(`removed ${link}`);
  }
  if (!ownsDir(dir)) {
    console.log(`nothing installed in ${dir}`);
    return;
  }
  let entries = [...ENTRIES, LAUNCHER];
  try { entries = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')).entries || entries; } catch { }
  for (const name of entries) {
    if (typeof name === 'string' && name && !name.includes('/') && !name.startsWith('.')) {
      rmSync(join(dir, name), { recursive: true, force: true });
    }
  }
  rmSync(join(dir, MARKER), { force: true });
  try {
    rmdirSync(dir);
    console.log(`removed ${dir}`);
  } catch {
    console.log(`removed rtlfix from ${dir} (other files there were left alone)`);
  }
}

export async function doctor(argv = []) {
  rejectArgs('doctor', argv);
  let bad = 0;
  const ok = (good, label, detail) => {
    if (!good) bad++;
    console.log(`  ${good ? '✓' : '✗'} ${label.padEnd(10)} ${detail}`);
  };
  const info = (label, detail) => console.log(`  • ${label.padEnd(10)} ${detail}`);
  console.log(`rtlfix ${PKG.version}\n`);
  const major = Number(process.versions.node.split('.')[0]);
  ok(major >= 18, 'node', `${process.version}${major >= 18 ? '' : ' (needs 18 or newer)'}`);
  let find = which;
  if (process.platform === 'win32') {
    const windows = await import('./windows.mjs');
    const build = windows.windowsBuild();
    ok(build >= 17763, 'system', `Windows build ${build}${build >= 17763 ? '' : ' (rtlfix tui needs Windows 10 version 1809 or newer)'}`);
    const csc = windows.compiler();
    ok(Boolean(csc), 'compiler', csc || 'not found (rtlfix tui needs .NET Framework 4, which Windows includes)');
    const editor = windows.editorConpty();
    info('console', editor ? `from the editor, ${dirname(editor)}` : 'the one built into Windows');
    find = (name) => windows.findProgram(name);
  } else {
    const linux = process.platform === 'linux';
    ok(linux, 'system', linux ? 'Linux' : `${process.platform} (rtlfix tui needs Linux, WSL or Windows)`);
    let script = null;
    try {
      script = execFileSync('script', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch { }
    ok(Boolean(script && script.includes('util-linux')), 'script', script || 'not found (install util-linux)');
  }
  info('terminal', process.env.TERM_PROGRAM || process.env.TERMINAL_EMULATOR || process.env.TERM || 'unknown');
  if (process.env.RTLFIX_TUI) info('session', 'already running inside rtlfix');
  for (const name of ['claude', 'qwen']) info(name, find(name) || 'not found');
  console.log('\n  Run `rtlfix demo` to see whether this terminal needs rtlfix.');
  if (bad) process.exitCode = 1;
}
