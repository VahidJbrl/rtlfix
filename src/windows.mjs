import { existsSync, statSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { homedir, release } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SOURCE = new URL('./conpty.cs', import.meta.url);
const META = /([()\][%!^"`<>&|;, *?])/g;

const envGet = (env, name) => {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
};

export function findProgram(name, env = process.env) {
  const exts = (envGet(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase());
  const ext = extname(name).toLowerCase();
  const withPath = /[\\/]/.test(name);
  const dirs = withPath ? [''] : (envGet(env, 'PATH') || '').split(';').filter(Boolean);
  for (const dir of dirs) {
    const base = withPath ? name : join(dir, name);
    for (const candidate of exts.includes(ext) ? [base] : exts.map((e) => base + e)) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch { }
    }
  }
  return null;
}

export function quoteArg(arg) {
  if (arg !== '' && !/[\s"]/.test(arg)) return arg;
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      slashes++;
    } else if (ch === '"') {
      out += '\\'.repeat(slashes * 2 + 1) + '"';
      slashes = 0;
    } else {
      out += '\\'.repeat(slashes) + ch;
      slashes = 0;
    }
  }
  return out + '\\'.repeat(slashes * 2) + '"';
}

function cmdArg(arg) {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(META, '^$1').replace(META, '^$1');
}

export function isBatch(program) {
  return /\.(cmd|bat)$/i.test(program);
}

export function comspec(env = process.env) {
  return envGet(env, 'COMSPEC') || join(envGet(env, 'SYSTEMROOT') || 'C:\\Windows', 'System32', 'cmd.exe');
}

export function batchLine(program, args) {
  return `/d /s /c "${[program.replace(META, '^$1'), ...args.map(cmdArg)].join(' ')}"`;
}

export function commandLine(program, args, env = process.env) {
  if (isBatch(program)) return `${quoteArg(comspec(env))} ${batchLine(program, args)}`;
  return [program, ...args].map(quoteArg).join(' ');
}

export function compiler(env = process.env) {
  const root = envGet(env, 'SYSTEMROOT') || envGet(env, 'WINDIR') || 'C:\\Windows';
  for (const framework of ['Framework64', 'FrameworkArm64', 'Framework']) {
    const csc = join(root, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe');
    if (existsSync(csc)) return csc;
  }
  return null;
}

export function cacheDir(env = process.env) {
  return envGet(env, 'RTLFIX_CACHE') || join(envGet(env, 'LOCALAPPDATA') || join(homedir(), 'AppData', 'Local'), 'rtlfix');
}

export function conptyHost(env = process.env) {
  const source = readFileSync(SOURCE);
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const dir = cacheDir(env);
  const exe = join(dir, `conpty-${hash}.exe`);
  if (!existsSync(exe)) build(source, dir, exe, env);
  for (const name of readdirSync(dir)) {
    if (!/^conpty-[0-9a-f]{12}\.exe$/.test(name) || join(dir, name) === exe) continue;
    try { rmSync(join(dir, name), { force: true }); } catch { }
  }
  return exe;
}

function build(source, dir, exe, env) {
  const csc = compiler(env);
  if (!csc) throw new Error('the C# compiler that comes with Windows (.NET Framework 4) was not found');
  mkdirSync(dir, { recursive: true });
  const stem = exe.slice(0, -4);
  const cs = `${stem}-${process.pid}.cs`;
  const tmp = `${stem}-${process.pid}.exe`;
  writeFileSync(cs, source);
  try {
    execFileSync(csc, ['/nologo', '/optimize+', '/target:exe', `/out:${tmp}`, cs], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  } catch (e) {
    rmSync(tmp, { force: true });
    throw new Error(`compiling the pseudo console helper failed: ${String(e.stdout || e.message).trim().split('\n')[0]}`);
  } finally {
    rmSync(cs, { force: true });
  }
  try {
    renameSync(tmp, exe);
  } catch {
    rmSync(tmp, { force: true });
    if (!existsSync(exe)) throw new Error('could not store the pseudo console helper');
  }
}

export function editorConpty(env = process.env) {
  if (envGet(env, 'TERM_PROGRAM') !== 'vscode') return null;
  const roots = [];
  const askpass = envGet(env, 'VSCODE_GIT_ASKPASS_NODE');
  if (askpass) roots.push(dirname(askpass));
  const local = envGet(env, 'LOCALAPPDATA');
  const programs = [envGet(env, 'PROGRAMFILES'), local && join(local, 'Programs')].filter(Boolean);
  for (const base of programs) {
    for (const name of ['Microsoft VS Code', 'Microsoft VS Code Insiders', 'cursor', 'Windsurf', 'VSCodium']) roots.push(join(base, name));
  }
  for (const root of roots) {
    for (const modules of ['node_modules', 'node_modules.asar.unpacked']) {
      const dir = join(root, 'resources', 'app', modules, 'node-pty', 'build', 'Release', 'conpty');
      if (existsSync(join(dir, 'conpty.dll')) && existsSync(join(dir, 'OpenConsole.exe'))) return join(dir, 'conpty.dll');
    }
  }
  return null;
}

export function windowsBuild() {
  const m = /^10\.0\.(\d+)/.exec(release());
  return m ? Number(m[1]) : 0;
}
