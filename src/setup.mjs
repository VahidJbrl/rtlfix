import {
  existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, chmodSync, rmSync,
  symlinkSync, lstatSync, readlinkSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PKG = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));

const installDir = () => process.env.RTLFIX_HOME || join(homedir(), '.local', 'share', 'rtlfix');
const binDir = () => process.env.RTLFIX_BIN || join(homedir(), '.local', 'bin');

function lstatSafe(p) {
  try { return lstatSync(p); } catch { return null; }
}

function which(name) {
  for (const d of (process.env.PATH || '').split(delimiter)) {
    const p = join(d, name);
    if (d && existsSync(p)) return p;
  }
  return null;
}

export function install(argv = []) {
  if (argv.length) {
    console.error(`rtlfix install: unexpected argument ${argv[0]}`);
    process.exit(1);
  }
  const dir = installDir();
  mkdirSync(dir, { recursive: true });
  rmSync(join(dir, 'src'), { recursive: true, force: true });
  for (const f of ['package.json', 'README.md', 'LICENSE', 'src']) {
    const src = join(PKG_DIR, f);
    if (existsSync(src)) cpSync(src, join(dir, f), { recursive: true });
  }
  const cli = join(dir, 'src', 'cli.mjs');
  writeFileSync(cli, readFileSync(cli, 'utf8').replace(/^#!.*\r?\n/, `#!${process.execPath}\n`));
  chmodSync(cli, 0o755);
  writeFileSync(join(dir, '.rtlfix.json'), JSON.stringify({ version: PKG.version }) + '\n');

  const bin = binDir();
  mkdirSync(bin, { recursive: true });
  const link = join(bin, 'rtlfix');
  if (lstatSafe(link)) rmSync(link, { force: true });
  symlinkSync(cli, link);

  console.log(`rtlfix ${PKG.version} installed`);
  console.log(`  files: ${dir}`);
  console.log(`  command: ${link}`);
  if (!(process.env.PATH || '').split(delimiter).includes(bin)) {
    console.log(`\n  ${bin} is not on your PATH yet. Add it with:`);
    console.log(`    echo 'export PATH="${bin}:$PATH"' >> ~/.bashrc && source ~/.bashrc`);
  }
  console.log('\n  Next: rtlfix tui claude   or   rtlfix tui qwen');
}

export function uninstall() {
  const dir = installDir();
  const link = join(binDir(), 'rtlfix');
  const st = lstatSafe(link);
  if (st?.isSymbolicLink() && readlinkSync(link).startsWith(dir)) {
    rmSync(link, { force: true });
    console.log(`removed ${link}`);
  }
  if (existsSync(join(dir, '.rtlfix.json'))) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`removed ${dir}`);
  } else {
    console.log(`nothing installed in ${dir}`);
  }
}

export function doctor() {
  const ok = (good, label, detail) => console.log(`  ${good ? '✓' : '✗'} ${label.padEnd(10)} ${detail}`);
  console.log(`rtlfix ${PKG.version}\n`);
  const major = Number(process.versions.node.split('.')[0]);
  ok(major >= 18, 'node', `${process.version}${major >= 18 ? '' : ' (needs 18 or newer)'}`);
  const linux = process.platform === 'linux';
  ok(linux, 'system', linux ? 'Linux' : `${process.platform} (rtlfix tui needs Linux or WSL)`);
  let script = null;
  try {
    script = execFileSync('script', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { }
  ok(Boolean(script && script.includes('util-linux')), 'script', script || 'not found (install util-linux)');
  const term = process.env.TERM_PROGRAM || process.env.TERMINAL_EMULATOR || process.env.TERM || 'unknown';
  console.log(`  • terminal   ${term}`);
  for (const name of ['claude', 'qwen']) {
    const p = which(name);
    console.log(`  • ${name.padEnd(10)} ${p || 'not found'}`);
  }
  console.log('\n  Run `rtlfix demo` to see whether this terminal needs rtlfix.');
}
