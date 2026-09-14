#!/usr/bin/env node
/**
 * Real daemon/CLI proof for the default Mentu-less installation.
 *
 * The fixture harness is deliberately local and exits without model inference.
 * Each case owns its daemon, child sessions, HOME, data directory and PATH
 * fixtures, then proves that all of them are gone before its temporary root is
 * removed.
 */

import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const daemonPath = path.join(repo, "target", "debug", "drogond");
const cliPath = path.join(repo, "target", "debug", "drogon-cli");
const nodeDirectory = path.dirname(process.execPath);
const commandTimeoutMs = 15_000;

function quoteForMessage(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

async function runGit(root, args) {
  await execFile("git", ["-C", root, ...args], {
    timeout: commandTimeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
}

function caseEnvironment(root, fixtureBin, networkMode) {
  const env = {
    ...process.env,
    HOME: path.join(root, "home"),
    XDG_CONFIG_HOME: path.join(root, "xdg-config"),
    XDG_CACHE_HOME: path.join(root, "xdg-cache"),
    XDG_DATA_HOME: path.join(root, "xdg-data"),
    DROGON_DATA_DIR: path.join(root, "data"),
    DROGON_ELECTRON_PROFILE: path.join(root, "electron-profile"),
    DROGON_BACKGROUND_WINDOW: "1",
    DROGON_E2E_NETWORK_MODE: networkMode,
    PATH: [fixtureBin, nodeDirectory, path.join(repo, "target", "debug"), "/usr/bin", "/bin"].join(":"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  // A fresh Mentu-less host must not inherit a developer's runtime override.
  delete env.DROGON_MENTU_RUNTIME;
  return env;
}

async function cliJson(env, dataDir, args) {
  const { stdout, stderr } = await execFile(
    cliPath,
    ["--data-dir", dataDir, "--json", ...args],
    { env, timeout: commandTimeoutMs, maxBuffer: 8 * 1024 * 1024 },
  );
  let envelope;
  try {
    envelope = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `drogon-cli ${args.join(" ")} returned non-JSON output: ${quoteForMessage(stdout)}${stderr ? ` stderr=${stderr}` : ""}`,
      { cause: error },
    );
  }
  assert.equal(envelope.ok, true, `drogon-cli ${args.join(" ")} failed: ${quoteForMessage(envelope)}`);
  return envelope.result;
}

async function psRecord(pid) {
  try {
    const { stdout } = await execFile("ps", ["-p", String(pid), "-o", "pid=,ppid=,command="], {
      timeout: 2_000,
      maxBuffer: 256 * 1024,
    });
    const line = stdout.trim();
    if (!line) return null;
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return match
      ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }
      : null;
  } catch {
    return null;
  }
}

async function processTree(rootPid) {
  let listing;
  try {
    ({ stdout: listing } = await execFile("ps", ["-axo", "pid=,ppid=,command="], {
      timeout: 2_000,
      maxBuffer: 2 * 1024 * 1024,
    }));
  } catch {
    return [];
  }
  const rows = [];
  for (const line of listing.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] });
  }
  const descendants = [];
  let parents = new Set([rootPid]);
  while (parents.size) {
    const next = new Set();
    for (const row of rows) {
      if (parents.has(row.ppid) && row.pid !== rootPid) {
        descendants.push(row);
        next.add(row.pid);
      }
    }
    parents = next;
  }
  return descendants;
}

async function waitForPidGone(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await psRecord(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !(await psRecord(pid));
}

async function terminateOwnedProcess(record) {
  const current = await psRecord(record.pid);
  if (!current) return;
  // Never signal a reused PID. The daemon command contains this case's
  // private root, which is stronger than an executable-name check.
  if (current.command !== record.command) {
    throw new Error(`process ${record.pid} was reused; survivor is unverifiable`);
  }
  process.kill(record.pid, "SIGTERM");
  if (await waitForPidGone(record.pid, 5_000)) return;
  const stillOwned = await psRecord(record.pid);
  if (!stillOwned || stillOwned.command !== record.command) {
    throw new Error(`process ${record.pid} became unverifiable during cleanup`);
  }
  process.kill(record.pid, "SIGKILL");
  if (!(await waitForPidGone(record.pid, 5_000))) {
    throw new Error(`test-owned process ${record.pid} survived SIGKILL`);
  }
}

async function startDaemon(root, env) {
  const dataDir = path.join(root, "data");
  await mkdir(path.join(root, "home"), { recursive: true });
  const child = spawn(daemonPath, ["--data-dir", dataDir], {
    cwd: repo,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderrText = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrText += chunk;
  });
  const command = `${daemonPath} --data-dir ${dataDir}`;
  const record = { pid: child.pid, command };
  let lastError;
  try {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`drogond exited before becoming ready (code=${child.exitCode}, signal=${child.signalCode})`);
      }
      try {
        await cliJson(env, dataDir, ["status"]);
        return {
          child,
          record,
          dataDir,
          get stderr() {
            return stderrText;
          },
        };
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error(
      `drogond did not become ready within 6 seconds (exit=${child.exitCode}, signal=${child.signalCode})${lastError ? `: ${lastError.message} code=${lastError.code ?? ""} stderr=${lastError.stderr ?? ""} stdout=${lastError.stdout ?? ""}` : ""}${stderrText ? `; stderr=${stderrText}` : ""}`,
    );
  } catch (error) {
    await terminateOwnedProcess(record);
    throw error;
  }
}

async function noMentuPaths(root) {
  const found = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (/mentu/i.test(entry.name)) found.push(full);
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(full);
    }
  }
  await walk(root);
  return found;
}

async function makeFixtureBin(root, marker) {
  const fixtureBin = path.join(root, "fixture-bin");
  await mkdir(fixtureBin, { recursive: true });
  await writeFile(
    path.join(fixtureBin, "opencode"),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("opencode fixture 1.0"); process.exit(0); }
if (args[0] === "models") { console.log("fixture/main"); process.exit(0); }
if (args[0] !== "run") process.exit(20);
console.log("fixture complete");
`,
    { mode: 0o755 },
  );
  // Any implicit download or PATH fallback leaves an undeniable marker and
  // fails the case. No product code is allowed to use these commands here.
  for (const executable of ["curl", "wget", "mentu-recipes"]) {
    await writeFile(
      path.join(fixtureBin, executable),
      `#!/bin/sh
printf '%s\\n' '${executable}' >> '${marker}'
exit 97
`,
      { mode: 0o755 },
    );
  }
  return fixtureBin;
}

async function runCase(networkMode) {
  // macOS AF_UNIX sockets have a short path limit; keep this test root
  // intentionally compact while all of its sibling directories stay isolated.
  const root = await mkdtemp(path.join(tmpdir(), "d-"));
  const marker = path.join(root, "implicit-install-attempts.log");
  const fixtureBin = await makeFixtureBin(root, marker);
  const env = caseEnvironment(root, fixtureBin, networkMode);
  const dataDir = path.join(root, "data");
  let daemon;
  let terminal;
  let cleanupError;
  try {
    daemon = await startDaemon(root, env);
    const status = await cliJson(env, dataDir, ["status"]);
    const requiredCapabilities = ["mentu.v1", "graph.v1", "workspace.v1", "harness.launch.v1"];
    for (const capability of requiredCapabilities)
      assert.ok(status.capabilities.includes(capability), `missing capability ${capability}`);

    const repoPath = path.join(root, "fixture-repo");
    await mkdir(repoPath, { recursive: true });
    await runGit(repoPath, ["init", "-q", "-b", "main"]);
    await runGit(repoPath, ["config", "user.email", "drogon-e2e@example.invalid"]);
    await runGit(repoPath, ["config", "user.name", "Drogon E2E"]);
    await writeFile(path.join(repoPath, "README.md"), "Mentu-less core journey\n");
    await runGit(repoPath, ["add", "README.md"]);
    await runGit(repoPath, ["commit", "-qm", "fixture"]);

    const project = await cliJson(env, dataDir, ["project", "add", repoPath, "--name", "fixture-project"]);
    const workspace = await cliJson(env, dataDir, ["workspace", "add", repoPath, "--name", "fixture-workspace"]);
    const worktree = await cliJson(env, dataDir, [
      "worktree",
      "create",
      "--project",
      project.id,
      "--name",
      `fixture-${networkMode}`,
      "--no-parent",
    ]);
    assert.ok(worktree.workspaceId);

    terminal = await cliJson(env, dataDir, [
      "terminal",
      "create",
      "--workspace",
      workspace.id,
      "--",
      "/bin/echo",
      "Mentu-less terminal works",
    ]);
    await cliJson(env, dataDir, ["terminal", "list", "--workspace", workspace.id]);
    await cliJson(env, dataDir, [
      "terminal",
      "wait",
      "--session",
      terminal.id,
      "--incarnation",
      terminal.incarnation,
      "--for",
      "output",
      "--timeout-ms",
      "5_000".replaceAll("_", ""),
    ]);

    const mentu = await cliJson(env, dataDir, ["mentu", "status", "--workspace", workspace.id]);
    assert.equal(mentu.verdict, "not_installed");
    assert.equal(mentu.runtime.available, false);
    assert.equal(mentu.runtime.lockMatches, false);
    assert.equal(mentu.runtime.message, "Mentu Recipes is unavailable on the execution host.");

    const graph = await cliJson(env, dataDir, ["graph", "read", "--workspace", workspace.id]);
    assert.deepEqual(graph.graph.intent.nodes, []);

    const nodePath = path.join(root, "main-node.json");
    await writeFile(
      nodePath,
      `${JSON.stringify({
        id: "orchestrator-main",
        title: "Mentu-less main",
        harness: "opencode",
        model: "fixture/main",
        dependsOn: [],
        enabled: true,
        prompt: "complete the fixture task without model inference",
      })}\n`,
    );
    await cliJson(env, dataDir, [
      "graph",
      "orchestrator-start",
      "--workspace",
      workspace.id,
      "--file",
      nodePath,
    ]);
    let workflow;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const result = await cliJson(env, dataDir, ["graph", "orchestrator-status", "--workspace", workspace.id]);
      workflow = result.run;
      if (workflow.status === "passed") break;
      if (workflow.status === "failed") throw new Error(`fixture orchestrator failed: ${quoteForMessage(workflow)}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(workflow?.status, "passed", "native Work Graph node did not finish");
    assert.equal(workflow.steps[0].status, "succeeded");

    await cliJson(env, dataDir, ["worktree", "rm", worktree.id, "--force"]);

    const mentuPaths = await noMentuPaths(dataDir);
    assert.deepEqual(mentuPaths, [], `Mentu paths were touched: ${mentuPaths.join(", ")}`);
    assert.equal(await fileExists(marker), false, "an implicit download/runtime command was attempted");
    assert.doesNotMatch(daemon.stderr, /mentu runtime auto-install|runtime_install|download failed/i);

    return {
      mode: networkMode,
      status: "passed",
      capabilities: requiredCapabilities,
      mentu: "unavailable (recipe execution skipped)",
      core: ["project", "workspace", "worktree", "terminal", "graph-read", "native-orchestrator"],
      installAttempts: 0,
      mentuPaths: mentuPaths.length,
    };
  } finally {
    if (terminal && daemon) {
      try {
        await cliJson(env, dataDir, [
          "terminal",
          "close",
          "--session",
          terminal.id,
          "--incarnation",
          terminal.incarnation,
        ]);
      } catch {
        // The daemon shutdown below is authoritative for this test-owned PTY.
      }
    }
    if (daemon) {
      const descendants = await processTree(daemon.record.pid);
      try {
        await terminateOwnedProcess(daemon.record);
        for (const child of descendants.reverse()) await terminateOwnedProcess(child);
        for (const child of descendants) {
          assert.equal(await psRecord(child.pid), null, `child process ${child.pid} survived cleanup`);
        }
        assert.equal(await psRecord(daemon.record.pid), null, "drogond survived cleanup");
      } catch (error) {
        cleanupError = error;
      }
    }
    try {
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw new Error(`cleanup failed for ${networkMode}: ${cleanupError.message}`, { cause: cleanupError });
  }
}

async function fileExists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

const cases = [];
try {
  for (const networkMode of ["available", "blocked"]) cases.push(await runCase(networkMode));
  console.log(JSON.stringify({ status: "passed", script: "e2e-mentu-absent", cases }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : String(error), cases }, null, 2));
  process.exitCode = 1;
}
