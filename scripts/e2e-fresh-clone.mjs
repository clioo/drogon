#!/usr/bin/env node
// Fresh-clone rehearsal: prove a clean machine gets a working build by
// following the README literally. Two modes:
//   node scripts/e2e-fresh-clone.mjs --check   fast static probes (runs in gates)
//   node scripts/e2e-fresh-clone.mjs --full    real clone + isolated caches +
//     pnpm install, cargo build, daemon smoke, typecheck (needs network)
// Safety: --full only writes under a tmpdir work root and never touches
// /Applications, ~/Applications, the real Homebrew prefix, or the user's
// Drogon data. Every spawned daemon is reaped and its exit verified.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preflight } from "./check-toolchains.mjs";

export const PUBLIC_REPO = "https://github.com/clioo/drogon.git";
export const PORTABLE_GATES = [
  "pnpm install --frozen-lockfile",
  "cargo build --workspace --locked",
  "pnpm typecheck",
];

// Frozen evidence and vendored text are byte-exact by design; the hygiene
// scanner owns the secret/token rules, this probe owns machine paths.
export const MACHINE_PATH_ALLOW_PREFIXES = ["tests/parity/", ".preflight/"];
// The macOS Homebrew prefix, spelled two ways to dodge self-matching.
const BREW_BIN = ["/opt", "homebrew", "bin"].join("/");
export const MACHINE_PATH_ALLOW_FILES = new Set([
  "AGENTS.md",
  "scripts/check-toolchains.test.mjs",
  "scripts/check-repo-hygiene.test.mjs",
  "scripts/demo-fixture.mjs",
  "scripts/e2e-fresh-clone.test.mjs",
  // Maintainer-only acceptance: prepends the Homebrew prefix so Homebrew
  // git/gh resolve on Apple Silicon. Absent dirs are ignored elsewhere, and
  // these scripts never run on a fresh-clone user's path (they need a
  // packaged app plus installed harnesses).
  "scripts/accept-orchestrator-modes.mjs",
  "scripts/accept-bot-monitors.mjs",
  "scripts/e2e-orchestration-real.mjs",
  "scripts/probe-packaged-surfaces.mjs",
  // Reproduces the production PATH shape of a past incident; fixture data.
  "scripts/recipe-toolchain.e2e.test.mjs",
  // Product PATH construction: spawned sessions must find Homebrew harnesses
  // on Apple Silicon Macs. Harmless when absent; changing it is desktop scope.
  "apps/desktop/src/main/daemon-path.ts",
  "apps/desktop/src/main/daemon-path.test.ts",
  // Rust CLI unit-test fixtures using a realistic Apple Silicon harness path
  // inside #[cfg(test)] modules and integration tests. Pure string assertions,
  // platform-independent; the crates are outside this worker's scope.
  "crates/drogon-cli/src/client.rs",
  "crates/drogon-cli/src/output.rs",
  "crates/drogon-cli/tests/integration.rs",
]);

// Verbatim README commands a clean machine must be able to run, in order.
// Kept as data so the test can diff it against the README fence.
export const README_COMMANDS = [
  "git clone https://github.com/clioo/drogon.git",
  "cd drogon",
  "pnpm install --frozen-lockfile",
  "cargo build --workspace --locked",
  "./target/debug/drogond --data-dir /tmp/drogon-dev",
  "DROGON_DATA_DIR=/tmp/drogon-dev pnpm --filter @drogon/desktop dev",
];

export function extractShFences(markdown) {
  const fences = [];
  for (const match of markdown.matchAll(/```sh\n(.*?)```/gs)) fences.push(match[1]);
  return fences;
}

export function readmeCoversCommands(readme) {
  const text = extractShFences(readme).join("\n");
  return README_COMMANDS.filter((cmd) => !text.includes(cmd));
}

export function ownerPattern(username = userInfo().username) {
  return new RegExp(`/Users/${username.replace(/[^\w.-]/g, "")}`, "g");
}

export function probeMachinePaths(root, username = userInfo().username) {
  const skipDirs = new Set([".git", "node_modules", "target", "dist", "out", ".preflight", ".qa"]);
  const owner = ownerPattern(username);
  const brew = new RegExp(BREW_BIN.replace(/\//g, "\\/"), "g");
  const findings = [];
  const scan = (rel, text, pattern, rule) => {
    for (const match of text.matchAll(pattern)) {
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const lineEnd = text.indexOf("\n", match.index);
      findings.push({
        rule,
        path: rel,
        match: match[0],
        line: text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().slice(0, 160),
      });
      if (findings.length >= 20) return false;
    }
    return true;
  };
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const rel = relative(root, full);
        // Worktree/submodule gitlinks are environment metadata, not content.
        if (entry.name === ".git") continue;
        if (MACHINE_PATH_ALLOW_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (MACHINE_PATH_ALLOW_FILES.has(rel)) continue;
        if (/\.(png|jpg|ico|icns|woff2?|zip|node|lock)$/.test(rel)) continue;
        let text;
        try {
          const buffer = readFileSync(full);
          if (buffer.length > 1024 * 1024 || buffer.includes(0)) continue;
          text = buffer.toString("utf8");
        } catch {
          continue;
        }
        // The auditor's own home directory anywhere is a leak of this machine
        // (synthetic /Users/x fixtures never match a real username).
        if (!scan(rel, text, owner, "owner-path")) return findings;
        if (!scan(rel, text, brew, "brew-path")) return findings;
      }
    }
  };
  walk(root);
  return findings;
}

export function assertSafeWorkRoot(workRoot) {
  assert.ok(isAbsolute(workRoot), "work root must be absolute");
  const resolved = resolve(workRoot);
  const home = resolve(process.env.HOME ?? "~");
  assert.ok(
    resolved === resolve(join(tmpdir(), ".")) || resolved.startsWith(tmpdir() + "/"),
    `work root must live under the system tmpdir, got ${resolved}`,
  );
  assert.ok(!resolved.startsWith("/Applications"), "refusing to work under /Applications");
  assert.ok(resolved !== home, "refusing to use $HOME as a work root");
  return resolved;
}

export function checkGate(root) {
  const failures = [];
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const missing = readmeCoversCommands(readme);
  if (missing.length > 0) failures.push(`README no longer documents: ${missing.join("; ")}`);
  const tools = preflight(root);
  if (!tools.ok) {
    failures.push(
      `toolchain preflight fails: ${tools.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ")}`,
    );
  }
  const machinePaths = probeMachinePaths(root);
  if (machinePaths.length > 0) {
    failures.push(
      `machine-specific paths on the user path: ${machinePaths.map((f) => `${f.path}: ${f.line}`).join(" | ")}`,
    );
  }
  return { schema: "drogon.fresh-clone-check/1", ok: failures.length === 0, failures };
}

async function runFull(root, workRoot) {
  const safe = assertSafeWorkRoot(workRoot || join(tmpdir(), "drogon-fresh-clone-"));
  const base = mkdtempSync(join(safe.replace(/-$/, ""), "run-"));
  const iso = join(base, "iso");
  for (const dir of ["pnpm-store", "npm-cache", "cargo-home", "tmp", "data"]) mkdirSync(join(iso, dir), { recursive: true });
  const env = {
    ...process.env,
    PNPM_STORE_PATH: join(iso, "pnpm-store"),
    npm_config_cache: join(iso, "npm-cache"),
    CARGO_HOME: join(iso, "cargo-home"),
    RUSTUP_HOME: join(iso, "rustup"),
    TMPDIR: join(iso, "tmp"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const repo = join(base, "drogon");
  const step = (name, cmd, args, opts = {}) => {
    console.log(`--- ${name}: ${cmd} ${args.join(" ")}`);
    execFileSync(cmd, args, { stdio: "inherit", env, timeout: 20 * 60 * 1000, ...opts });
  };
  let daemon;
  try {
    step("clone", "git", ["clone", PUBLIC_REPO, repo]);
    step("pnpm-install", "pnpm", ["install", "--frozen-lockfile"], { cwd: repo });
    step("cargo-build", "cargo", ["build", "--workspace", "--locked"], { cwd: repo });
    const dataDir = join(iso, "data");
    daemon = spawn(join(repo, "target/debug/drogond"), ["--data-dir", dataDir], { stdio: "ignore" });
    const cli = join(repo, "target/debug/drogon-cli");
    let ready = false;
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        execFileSync(cli, ["status"], { stdio: "pipe", env, timeout: 10000 });
        ready = true;
        break;
      } catch {}
    }
    assert.ok(ready, "fresh-built daemon never became ready");
    console.log("--- daemon smoke: status ok");
    step("typecheck", "pnpm", ["typecheck"], { cwd: repo });
    console.log(`FULL PASS: fresh clone works from ${PUBLIC_REPO} (work retained at ${base})`);
  } finally {
    if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
      daemon.kill("SIGTERM");
      const deadline = Date.now() + 10000;
      while (daemon.exitCode === null && daemon.signalCode === null && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGKILL");
    }
    if (daemon) {
      try {
        process.kill(daemon.pid, 0);
        console.error(`daemon pid ${daemon.pid} survived teardown; left running, work retained at ${base}`);
        process.exitCode = 1;
      } catch {
        console.log("--- daemon reaped");
      }
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  if (args.includes("--full")) {
    const workRoot = args[args.indexOf("--full") + 1]?.startsWith("--") === false
      ? args[args.indexOf("--full") + 1]
      : undefined;
    await runFull(root, workRoot).catch((error) => {
      console.error(`FULL FAIL: ${error.message}`);
      process.exitCode = 1;
    });
  } else {
    const result = checkGate(root);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  }
}
