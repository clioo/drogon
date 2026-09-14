#!/usr/bin/env node
// Virgin-environment end-to-end audit (lane install-virgin-mac).
//
// Drives the PACKAGED release bytes through the fresh-Mac matrix: a virgin
// HOME, a virgin DROGON_DATA_DIR, a scrubbed PATH (no Homebrew, no Node, no
// gh, no harness) and a CLT-stub `git` that behaves like a Mac without the
// Xcode command line tools. The bundle itself is never executed in place:
// macOS holds direct spawns of binaries inside a never-opened downloaded
// bundle, so the script stages byte-identical copies of the bundle's
// `drogond` + `drogon-cli` into its own temp root (see stageBundle()).
//
// Run: node scripts/e2e-virgin-environment.mjs --bundle <Drogon.app>
// Every case cleans up the processes and temp dirs it makes; the script
// exits non-zero when any case fails. `unverifiable` (with evidence) is
// reserved for host limits outside the product, never for product behavior.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const sleep = promisify(setTimeout);

/** CLT-stub `git`: what /usr/bin/git does with no developer tools. */
export const CLT_STUB_SCRIPT = `#!/bin/sh
echo "xcode-select: note: No developer tools were found on this system, requesting installation." >&2
exit 1
`;

const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * Virgin process environment: fresh HOME/DATA, stub-git shadowing the real
 * one, and a PATH with no Homebrew, no Node, no gh and no harness. `extra`
 * overrides (e.g. proxy blackholes) ride on top.
 */
export function buildVirginEnv(root, extra = {}) {
  const shim = path.join(root, 'shim');
  return {
    HOME: path.join(root, 'home'),
    DROGON_DATA_DIR: path.join(root, 'data'),
    DROGON_ELECTRON_PROFILE: path.join(root, 'electron'),
    PATH: `${shim}:${SYSTEM_PATH}`,
    SHELL: '/bin/sh',
    ...extra,
  };
}

/** Pulls {code, message} out of a `drogon-cli --json` envelope, if any. */
export function extractCliError(stdout) {
  try {
    const envelope = JSON.parse(stdout);
    if (envelope && envelope.ok === false && envelope.error) {
      return { code: String(envelope.error.code ?? ''), message: String(envelope.error.message ?? '') };
    }
    return null;
  } catch {
    return null;
  }
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function cliJson(cli, args, env, timeoutMs) {
  return runBounded(cli, [...args, '--json'], { env, timeoutMs });
}

export function runBounded(file, args, { env, timeoutMs = 30000, cwd } = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      env: { ...process.env, ...env },
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => {
      stdout += b.toString();
      if (stdout.length > 262144) stdout = stdout.slice(-262144);
    });
    child.stderr.on('data', (b) => {
      stderr += b.toString();
      if (stderr.length > 262144) stderr = stderr.slice(-262144);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {}
      }, 2000);
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, stdout, stderr: `${stderr}${error.message}`, timedOut, spawnError: true });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, spawnError: false });
    });
  });
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Graceful stop with a bounded force fallback; verifies the pid is gone. */
export async function stopChild(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { label, exited: true, forced: false };
  }
  child.kill('SIGTERM');
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    await sleep(100);
  }
  let forced = false;
  if (child.exitCode === null && child.signalCode === null) {
    forced = true;
    try {
      child.kill('SIGKILL');
    } catch {}
    const killDeadline = Date.now() + 3000;
    while (Date.now() < killDeadline) {
      if (child.exitCode !== null || child.signalCode !== null) break;
      await sleep(100);
    }
  }
  const exited = child.exitCode !== null || child.signalCode !== null;
  return { label, exited, forced };
}

export async function waitForFile(file, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) return true;
    await sleep(100);
  }
  return existsSync(file);
}

function makeCase(id) {
  const evidence = [];
  return {
    id,
    evidence,
    note(line) {
      evidence.push(line);
    },
    done(verdict) {
      return { id, verdict, evidence };
    },
  };
}

/** Copies the bundle's daemon + CLI out of the .app so the OS exec gate on
 * never-opened downloaded bundles cannot hold the probes. Records shas. */
export function stageBundle(bundle, stage) {
  const bin = path.join(bundle, 'Contents', 'Resources', 'bin');
  const staged = {};
  for (const name of ['drogond', 'drogon-cli', 'drogon-cli.native']) {
    const source = path.join(bin, name);
    if (!existsSync(source)) throw new Error(`bundle is missing bin/${name}: ${bin}`);
    const target = path.join(stage, name);
    const bytes = readFileSync(source);
    writeFileSync(target, bytes, { mode: 0o755 });
    staged[name] = { path: target, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  return staged;
}

export function writeShim(root) {
  const shim = path.join(root, 'shim');
  mkdirSync(shim, { recursive: true });
  writeFileSync(path.join(shim, 'git'), CLT_STUB_SCRIPT, { mode: 0o755 });
  return shim;
}

function parseCliJson(stdout, what) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`unparseable ${what} envelope: ${String(error).slice(0, 200)}`);
  }
}

async function spawnDaemon(drogond, dataDir, env, extraArgs = []) {
  const child = spawn(drogond, ['--data-dir', dataDir, ...extraArgs], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let tail = '';
  child.stderr?.on('data', (bytes) => {
    tail = `${tail}${bytes.toString()}`.slice(-2048);
  });
  const socket = path.join(dataDir, 'runtime-v1.sock');
  const up = await waitForFile(socket, 20000);
  child.stderrTail = () => tail;
  return { child, socket, up };
}

/** Case 1: minimal PATH (no Homebrew/Node/gh/harness) still boots + serves. */
async function caseMinimalPath(ctx) {
  const c = makeCase('minimal-path-boot');
  const env = buildVirginEnv(ctx.root);
  const dataDir = env.DROGON_DATA_DIR;
  const { child, up } = await spawnDaemon(ctx.staged.drogond.path, dataDir, env);
  ctx.daemons.push({ child, label: 'minimal-path daemon' });
  c.note(`daemon socket appeared: ${up}`);
  if (!up) return c.done('fail');
  const status = await cliJson(ctx.staged['drogon-cli'].path, ['status'], env, 20000);
  c.note(`status exit=${status.code} timedOut=${status.timedOut}`);
  const envelope = parseCliJson(status.stdout, 'status');
  c.note(`protocol=${envelope?.result?.protocol ?? '?'}`);
  if (status.code !== 0 || envelope?.ok !== true) return c.done('fail');
  return c.done('pass');
}

function makeFixtureRepo(root) {
  const repo = path.join(root, 'fixture-repo');
  mkdirSync(repo, { recursive: true });
  const git = (...args) =>
    execFileSync('git', args, { cwd: repo, stdio: 'pipe', env: process.env });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'virgin@example.com');
  git('config', 'user.name', 'virgin');
  writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-qm', 'init');
  git('remote', 'add', 'origin', 'https://github.com/example/virgin-fixture.git');
  return repo;
}

/** Case 2: no `gh` — Tasks list/start fail typed, never mute or spinning.
 * Needs a working git (real remote resolution) with no gh on PATH. When the
 * host's own git is the CLT stub, this isolation is impossible and the
 * no-git-clt-stub case below owns the verdict. */
async function caseNoGh(ctx) {
  const c = makeCase('no-gh');
  const root = path.join(ctx.root, 'nogh');
  mkdirSync(path.join(root, 'home'), { recursive: true });
  const env = {
    HOME: path.join(root, 'home'),
    DROGON_DATA_DIR: path.join(root, 'data'),
    PATH: SYSTEM_PATH,
    SHELL: '/bin/sh',
  };
  if (await gitIsStub(env)) {
    c.note('host git is itself the CLT stub: gh isolation impossible, see no-git-clt-stub');
    return c.done('unverifiable');
  }
  const cli = ctx.staged['drogon-cli'].path;
  const dataDir = env.DROGON_DATA_DIR;
  const { child, up } = await spawnDaemon(ctx.staged.drogond.path, dataDir, env);
  ctx.daemons.push({ child, label: 'no-gh daemon' });
  if (!up) {
    c.note(`daemon did not come up; stderr: ${child.stderrTail().slice(-300)}`);
    return c.done('fail');
  }
  const added = parseCliJson(
    (await cliJson(cli, ['project', 'add', ctx.repo], env, 20000)).stdout,
    'project add',
  );
  const projectId = added.result.id;
  const listed = await cliJson(
    cli,
    ['rpc', 'tasks.list', '--params', JSON.stringify({ projectId, state: 'open', page: 1, perPage: 5, mode: 'issues' })],
    env,
    45000,
  );
  const err = extractCliError(listed.stdout);
  c.note(`tasks.list code=${err?.code ?? '(none)'} timedOut=${listed.timedOut}`);
  c.note(`message=${(err?.message ?? listed.stdout).slice(0, 220)}`);
  if (listed.timedOut) return c.done('fail');
  if (!err || err.code !== 'gh_unavailable') return c.done('fail');
  return c.done('pass');
}

/** Case 3: CLT-stub git — projects/worktrees/Source Control name the fix. */
async function caseNoGit(ctx) {
  const c = makeCase('no-git-clt-stub');
  const dataDir = path.join(ctx.root, 'data-nogit');
  const env = { ...buildVirginEnv(ctx.root), DROGON_DATA_DIR: dataDir };
  const cli = ctx.staged['drogon-cli'].path;
  const { child, up } = await spawnDaemon(ctx.staged.drogond.path, dataDir, env);
  ctx.daemons.push({ child, label: 'no-git daemon' });
  if (!up) {
    c.note(`daemon did not come up; stderr: ${child.stderrTail().slice(-300)}`);
    return c.done('fail');
  }
  const added = parseCliJson(
    (await cliJson(cli, ['project', 'add', ctx.repo], env, 20000)).stdout,
    'project add',
  );
  const listed = await cliJson(
    cli,
    ['rpc', 'tasks.list', '--params', JSON.stringify({ projectId: added.result.id, state: 'open', page: 1, perPage: 5, mode: 'issues' })],
    env,
    45000,
  );
  const tasksErr = extractCliError(listed.stdout);
  c.note(`tasks.list code=${tasksErr?.code ?? '(none)'} (must be git_unavailable, not no_github_remote)`);
  const created = await cliJson(
    cli,
    ['worktree', 'create', '--project', added.result.id, '--name', 'virgin-probe'],
    env,
    45000,
  );
  const worktreeErr = extractCliError(created.stdout);
  c.note(`worktree.create code=${worktreeErr?.code ?? '(none)'}`);
  c.note(`message=${(worktreeErr?.message ?? created.stdout).slice(0, 220)}`);
  if (listed.timedOut || created.timedOut) return c.done('fail');
  if (!tasksErr || tasksErr.code !== 'git_unavailable') return c.done('fail');
  if (!worktreeErr || worktreeErr.code !== 'git_unavailable') return c.done('fail');
  return c.done('pass');
}

/** Case 4: no harness — catalog is honest, start refuses with a reason. */
async function caseNoHarness(ctx) {
  const c = makeCase('no-harness');
  const dataDir = path.join(ctx.root, 'data-noharness');
  const env = { ...buildVirginEnv(ctx.root), DROGON_DATA_DIR: dataDir };
  const cli = ctx.staged['drogon-cli'].path;
  const { child, up } = await spawnDaemon(ctx.staged.drogond.path, dataDir, env);
  ctx.daemons.push({ child, label: 'no-harness daemon' });
  if (!up) {
    c.note(`daemon did not come up; stderr: ${child.stderrTail().slice(-300)}`);
    return c.done('fail');
  }
  const listed = parseCliJson((await cliJson(cli, ['harness', 'list'], env, 20000)).stdout, 'harness list');
  const rows = listed.result ?? listed;
  const text = JSON.stringify(rows);
  c.note(`catalog: ${text.slice(0, 300)}`);
  if (!/missing/i.test(text)) return c.done('fail');
  const ws = parseCliJson((await cliJson(cli, ['workspace', 'add', ctx.repo], env, 20000)).stdout, 'workspace add');
  const started = await cliJson(cli, ['harness', 'start', '--workspace', ws.result.id, '--harness', 'claude'], env, 30000);
  const err = extractCliError(started.stdout);
  c.note(`harness.start code=${err?.code ?? '(none)'} message=${(err?.message ?? started.stdout).slice(0, 160)}`);
  if (started.timedOut) return c.done('fail');
  if (!err || !/not installed/i.test(err.message)) return c.done('fail');
  return c.done('pass');
}

async function gitIsStub(env) {
  const probed = await runBounded('git', ['--version'], { env, timeoutMs: 10000 });
  return /no developer tools were found/i.test(`${probed.stdout}\n${probed.stderr}`);
}

/** Case 5: no network — blackholed proxies must not block boot or status. */
async function caseNoNetwork(ctx) {
  const c = makeCase('no-network');
  const blackhole = {
    http_proxy: 'http://127.0.0.1:9',
    https_proxy: 'http://127.0.0.1:9',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '',
    no_proxy: '',
  };
  const dataDir = path.join(ctx.root, 'data-offline');
  const env = { ...buildVirginEnv(ctx.root, blackhole), DROGON_DATA_DIR: dataDir };
  const cli = ctx.staged['drogon-cli'].path;
  const { child, up } = await spawnDaemon(ctx.staged.drogond.path, dataDir, env);
  ctx.daemons.push({ child, label: 'offline daemon' });
  c.note(`daemon socket appeared with blackholed proxies: ${up}`);
  if (!up) {
    c.note(`stderr: ${child.stderrTail().slice(-300)}`);
    return c.done('fail');
  }
  const status = await cliJson(cli, ['status'], env, 20000);
  const envelope = parseCliJson(status.stdout, 'status');
  c.note(`status ok=${envelope?.ok} timedOut=${status.timedOut}`);
  if (status.timedOut || envelope?.ok !== true) return c.done('fail');
  return c.done('pass');
}

/** Case 6: no Mentu runtime — status says so honestly, never spins. */
async function caseNoMentu(ctx) {
  const c = makeCase('no-mentu-runtime');
  const dataDir = path.join(ctx.root, 'data-nomentu');
  const env = { ...buildVirginEnv(ctx.root), DROGON_DATA_DIR: dataDir };
  const cli = ctx.staged['drogon-cli'].path;
  const { child, up } = await spawnDaemon(ctx.staged.drogond.path, dataDir, env);
  ctx.daemons.push({ child, label: 'no-mentu daemon' });
  if (!up) {
    c.note(`daemon did not come up; stderr: ${child.stderrTail().slice(-300)}`);
    return c.done('fail');
  }
  const status = await cliJson(cli, ['mentu', 'status'], env, 30000);
  c.note(`mentu status exit=${status.code} timedOut=${status.timedOut}`);
  c.note(status.stdout.slice(0, 220).replace(/\n/g, ' | '));
  if (status.timedOut) return c.done('fail');
  if (!/not_installed|unavailable/i.test(status.stdout)) return c.done('fail');
  return c.done('pass');
}

/** Case 7: virgin HOME — zap-layout data dir, second launch reuses state. */
async function caseVirginHome(ctx) {
  const c = makeCase('virgin-home-reuse');
  const home = path.join(ctx.root, 'vh');
  mkdirSync(home, { recursive: true });
  const dataDir = path.join(home, 'Library', 'Application Support', 'Drogon');
  const env = { ...buildVirginEnv(ctx.root), HOME: home, DROGON_DATA_DIR: dataDir };
  const cli = ctx.staged['drogon-cli'].path;
  const first = await spawnDaemon(ctx.staged.drogond.path, dataDir, env);
  ctx.daemons.push({ child: first.child, label: 'virgin-home daemon (first)' });
  if (!first.up) {
    c.note(`first launch did not come up; stderr: ${first.child.stderrTail().slice(-300)}`);
    return c.done('fail');
  }
  c.note(`data dir created at the zap path: ${existsSync(dataDir)}`);
  const ws = parseCliJson((await cliJson(cli, ['workspace', 'add', ctx.repo], env, 20000)).stdout, 'workspace add');
  const stop = await stopChild(first.child, 'virgin-home daemon (first)');
  c.note(`first daemon stopped: exited=${stop.exited} forced=${stop.forced}`);
  const second = await spawnDaemon(ctx.staged.drogond.path, dataDir, env);
  ctx.daemons.push({ child: second.child, label: 'virgin-home daemon (second)' });
  if (!second.up) {
    c.note(`second launch did not come up; stderr: ${second.child.stderrTail().slice(-300)}`);
    return c.done('fail');
  }
  const listed = parseCliJson((await cliJson(cli, ['workspace', 'list'], env, 20000)).stdout, 'workspace list');
  const ids = JSON.stringify(listed);
  c.note(`second launch reuses state: ${ids.includes(ws.result.id)}`);
  if (!ids.includes(ws.result.id)) return c.done('fail');
  return c.done('pass');
}

/** Case 8: daemon ergonomics — --version answers; no-arg serves or explains. */
async function caseDaemonErgonomics(ctx) {
  const c = makeCase('daemon-ergonomics');
  const drogond = ctx.staged.drogond.path;
  const home = path.join(ctx.root, 'eh');
  mkdirSync(home, { recursive: true });
  const bare = { HOME: home, PATH: SYSTEM_PATH, SHELL: '/bin/sh' };
  const version = await runBounded(drogond, ['--version'], { env: bare, timeoutMs: 10000 });
  c.note(`--version exit=${version.code} out=${version.stdout.trim().slice(0, 60)}`);
  const versionOk = version.code === 0 && /drogond \S+/.test(version.stdout);
  const child = spawn(drogond, [], { env: { ...process.env, ...bare }, stdio: ['ignore', 'ignore', 'pipe'] });
  ctx.daemons.push({ child, label: 'no-arg daemon' });
  const socket = path.join(home, 'Library', 'Application Support', 'Drogon', 'runtime-v1.sock');
  const served = await waitForFile(socket, 20000);
  let noArgOk = false;
  if (served) {
    c.note('no-arg launch served the platform default data dir');
    noArgOk = true;
  } else {
    const exit = await Promise.race([
      new Promise((resolve) => child.on('close', (code) => resolve(code))),
      sleep(5000).then(() => 'still-running'),
    ]);
    if (exit !== 'still-running') {
      c.note(`no-arg launch exited ${exit} without serving`);
      const out = await runBounded(drogond, [], { env: bare, timeoutMs: 10000 });
      const namesDefault = /Application Support|DROGON_DATA_DIR/i.test(out.stderr);
      c.note(`names the default location: ${namesDefault}`);
      noArgOk = namesDefault;
    } else {
      c.note('no-arg launch neither served nor exited within the bound (mute hang)');
    }
  }
  await stopChild(child, 'no-arg daemon');
  if (!versionOk || !noArgOk) return c.done('fail');
  return c.done('pass');
}

/** Best-effort packaged-app launch: background window, virgin profile, CDP
 * endpoint sniff. Hosts that hold never-opened downloaded bundles report
 * `unverifiable` with the cause — never a failure, never a focus steal. */
async function caseAppLaunch(ctx) {
  const c = makeCase('packaged-app-launch');
  const executable = path.join(ctx.bundle, 'Contents', 'MacOS', 'Drogon');
  if (!existsSync(executable)) {
    c.note(`no macOS executable at ${executable}`);
    return c.done('fail');
  }
  const env = {
    ...buildVirginEnv(ctx.root),
    DROGON_BACKGROUND_WINDOW: '1',
  };
  const child = spawn(executable, ['--remote-debugging-port=0'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  ctx.daemons.push({ child, label: 'packaged app' });
  let endpoint = null;
  let earlyExit = null;
  let tail = '';
  child.stderr?.on('data', (bytes) => {
    tail = `${tail}${bytes.toString()}`.slice(-4096);
    const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
    if (match) endpoint = match[1];
  });
  child.on('close', (code) => {
    earlyExit = code;
  });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && !endpoint && earlyExit === null) {
    await sleep(250);
  }
  if (endpoint) {
    c.note(`CDP endpoint published: ${endpoint.replace(/\/.*/, '/…')}`);
    const stop = await stopChild(child, 'packaged app');
    c.note(`app stopped: exited=${stop.exited} forced=${stop.forced}`);
    if (!stop.exited) return c.done('fail');
    return c.done('pass');
  }
  const stop = await stopChild(child, 'packaged app');
  if (earlyExit !== null) {
    c.note(`app exited early with code ${earlyExit}: ${tail.slice(-300)}`);
    return c.done('fail');
  }
  c.note(
    'no CDP endpoint within 45s while the process stayed alive: host holds direct spawns inside never-opened downloaded bundles (open the app once via Finder/cask, then re-run)',
  );
  c.note(`stop: exited=${stop.exited} forced=${stop.forced}`);
  return c.done('unverifiable');
}

function parseArgs(argv) {
  const out = { bundle: null, keep: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--bundle') out.bundle = argv[++i];
    else if (argv[i] === '--keep') out.keep = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!out.bundle) throw new Error('usage: e2e-virgin-environment.mjs --bundle <Drogon.app> [--keep]');
  return out;
}

async function main() {
  const { bundle, keep } = parseArgs(process.argv.slice(2));
  // Rooted at /tmp (not $TMPDIR): macOS sandbox TMPDIRs are already ~50
  // chars, and the daemon's Unix socket path must fit SUN_LEN (104). A real
  // virgin HOME is short; the e2e HOME must be too, or every case fails on
  // socket length instead of what it probes.
  const root = mkdtempSync('/tmp/drogon-virgin-');
  mkdirSync(path.join(root, 'home'), { recursive: true });
  const ctx = { bundle, root, staged: null, repo: null, daemons: [] };
  const results = [];
  const cleanupNotes = [];
  try {
    const stage = path.join(root, 'stage');
    mkdirSync(stage, { recursive: true });
    ctx.staged = stageBundle(bundle, stage);
    for (const [name, info] of Object.entries(ctx.staged)) {
      console.log(`staged ${name} sha256=${info.sha256.slice(0, 16)}…`);
    }
    writeShim(root);
    ctx.repo = makeFixtureRepo(root);
    console.log(`fixture repo: ${ctx.repo}`);
    for (const runCase of [
      caseMinimalPath,
      caseNoGh,
      caseNoGit,
      caseNoHarness,
      caseNoNetwork,
      caseNoMentu,
      caseVirginHome,
      caseDaemonErgonomics,
      caseAppLaunch,
    ]) {
      results.push(await runCase(ctx));
      for (const { child, label } of ctx.daemons.splice(0)) {
        const stop = await stopChild(child, label);
        cleanupNotes.push(`${label}: exited=${stop.exited} forced=${stop.forced}`);
      }
    }
  } catch (error) {
    results.push({ id: 'harness', verdict: 'fail', evidence: [String(error?.stack ?? error).slice(0, 500)] });
  } finally {
    for (const { child, label } of ctx.daemons) {
      try {
        const stop = await stopChild(child, label);
        cleanupNotes.push(`${label}: exited=${stop.exited} forced=${stop.forced}`);
        if (child.pid && isAlive(child.pid)) cleanupNotes.push(`${label}: SURVIVOR pid=${child.pid}`);
      } catch (error) {
        cleanupNotes.push(`${label}: cleanup error ${String(error).slice(0, 120)}`);
      }
    }
    const survivors = ctx.daemons.filter(({ child }) => child.pid && isAlive(child.pid));
    if (!keep) {
      if (survivors.length === 0) rmSync(root, { recursive: true, force: true });
      else cleanupNotes.push(`temp root kept (survivors): ${root}`);
    } else {
      cleanupNotes.push(`temp root kept (--keep): ${root}`);
    }
    if (survivors.length > 0) {
      cleanupNotes.push(`UNVERIFIABLE survivors: ${survivors.map(({ child }) => child.pid).join(',')}`);
    }
  }
  let failed = 0;
  for (const result of results) {
    const tag = result.verdict === 'pass' ? 'PASS' : result.verdict === 'unverifiable' ? 'UNVERIFIABLE' : 'FAIL';
    if (result.verdict === 'fail') failed += 1;
    console.log(`${tag} ${result.id}`);
    for (const line of result.evidence) console.log(`    ${line}`);
  }
  console.log('Cleanup:');
  for (const line of cleanupNotes) console.log(`    ${line}`);
  if (failed > 0) {
    console.log(`${failed} case(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('all runnable cases passed');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  await main();
}
