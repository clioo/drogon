import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  access,
  mkdtemp,
  mkdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import {
  runAcceptanceProcess,
  startAcceptanceProcess,
} from "./acceptance-process.mjs";
import { probeNativeProtocol } from "./probe-native-protocol.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const suffix = process.platform === "win32" ? ".exe" : "";
const daemonPath = path.join(root, "target", "debug", `drogond${suffix}`);
const cliPath = path.join(root, "target", "debug", `drogon-cli${suffix}`);
await Promise.all([access(daemonPath), access(cliPath)]);
const fixture = await mkdtemp(path.join(tmpdir(), "dg-"));
const dataDir = path.join(fixture, "data");
const workspacePath = path.join(fixture, "folder");
await mkdir(workspacePath);
const report = {
  startedAt: new Date().toISOString(),
  platform: process.platform,
  status: "FAILED",
  checks: [],
  cleanup: [],
};
const sessions = [];
let daemon;
let daemonError;
let failure;
const reportDir = path.join(root, ".preflight", "acceptance");

async function cli(args) {
  const { stdout } = await runAcceptanceProcess(
    cliPath,
    ["--data-dir", dataDir, "--json", ...args],
    { cwd: root },
  );
  return JSON.parse(stdout);
}

async function rpc(method, params = {}, requestId = randomUUID()) {
  const response = await cli([
    "rpc",
    method,
    "--params",
    JSON.stringify(params),
    "--request-id",
    requestId,
  ]);
  assert.equal(response.ok, true);
  assert.equal(response.requestId, requestId);
  return response.result;
}

async function eventually(action, predicate, label, timeout = 8000) {
  const until = Date.now() + timeout;
  let lastError;
  do {
    try {
      const result = await action();
      if (predicate(result)) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(75);
  } while (Date.now() < until);
  throw new Error(
    `${label} did not settle${lastError ? `: ${lastError.message}` : ""}`,
  );
}

async function expectsRpcError(method, params, code, requestId = randomUUID()) {
  let response;
  try {
    await cli([
      "rpc",
      method,
      "--params",
      JSON.stringify(params),
      "--request-id",
      requestId,
    ]);
    assert.fail(`Expected ${code}`);
  } catch (error) {
    assert.equal(
      error.code,
      1,
      `Expected CLI operation exit code 1, received ${error.code}`,
    );
    response = JSON.parse(error.stdout);
  }
  assert.equal(response.ok, false);
  assert.equal(response.error.code, code);
}

try {
  daemon = startAcceptanceProcess(daemonPath, ["--data-dir", dataDir], {
    cwd: root,
    stdio: ["ignore", "ignore", "ignore"],
  });
  daemon.on("error", (error) => {
    daemonError = error;
  });
  await eventually(
    () => cli(["status"]),
    (value) => value.ok === true,
    "Service startup",
  );
  if (daemonError) throw daemonError;
  report.checks.push("daemon-start-and-cli-status");
  report.checks.push(...(await probeNativeProtocol(dataDir)));
  const addResponse = await cli([
    "workspace",
    "add",
    workspacePath,
    "--name",
    "Acceptance folder",
  ]);
  assert.equal(addResponse.ok, true);
  const workspace = addResponse.result;
  assert.equal(workspace.kind, "folder");
  assert.equal(workspace.path, await realpath(workspacePath));
  const listed = await cli(["workspace", "list"]);
  assert.ok(listed.result.workspaces.some((item) => item.id === workspace.id));
  report.checks.push("non-git-folder-registration-and-list");

  const command = process.execPath;
  const program =
    'process.stdout.write("READY\\n");process.stdin.setEncoding("utf8");process.stdin.on("data",s=>process.stdout.write("ACK:"+s));setTimeout(()=>process.exit(0),30000)';
  const params = {
    workspaceId: workspace.id,
    command,
    args: ["-e", program],
    cols: 80,
    rows: 24,
  };
  const requestId = randomUUID();
  const admissions = await Promise.allSettled([
    rpc("session.start", params, requestId),
    rpc("session.start", params, requestId),
  ]);
  for (const admission of admissions) {
    if (
      admission.status === "fulfilled" &&
      !sessions.some((item) => item.id === admission.value.id)
    )
      sessions.push(admission.value);
  }
  const rejected = admissions.find(
    (admission) => admission.status === "rejected",
  );
  if (rejected) throw rejected.reason;
  const [first, duplicate] = admissions.map((admission) => admission.value);
  assert.equal(first.id, duplicate.id);
  assert.equal(first.incarnation, duplicate.incarnation);
  assert.equal(first.verdict, "live");
  assert.equal((await rpc("session.list")).sessions.length, 1);
  await expectsRpcError(
    "session.start",
    { ...params, cols: 90 },
    "request_conflict",
    requestId,
  );
  report.checks.push("concurrent-admission-replay-and-conflicting-request-id");

  const identity = { sessionId: first.id, incarnation: first.incarnation };
  await eventually(
    () => rpc("session.read", { ...identity, cursor: 0 }),
    (value) =>
      Buffer.from(value.dataBase64, "base64").toString().includes("READY"),
    "PTY startup output",
  );
  const payload = `payload-${randomUUID()}`;
  const sent = await cli([
    "terminal",
    "send",
    "--session",
    first.id,
    "--incarnation",
    first.incarnation,
    "--text",
    payload + "\n",
  ]);
  assert.equal(sent.ok, true);
  await eventually(
    () => rpc("session.read", { ...identity, cursor: 0 }),
    (value) =>
      Buffer.from(value.dataBase64, "base64")
        .toString()
        .includes(`ACK:${payload}`),
    "Real child input/output round trip",
  );
  report.checks.push("pty-input-output-across-independent-cli-connections");

  const resized = await rpc("session.resize", {
    ...identity,
    cols: 100,
    rows: 32,
  });
  assert.equal(resized.cols, 100);
  assert.equal(resized.rows, 32);
  await expectsRpcError(
    "session.stop",
    { ...identity, incarnation: randomUUID() },
    "stale_incarnation",
  );
  assert.equal(
    (await rpc("session.read", { ...identity, cursor: 0 })).session.verdict,
    "live",
  );
  report.checks.push("resize-and-stale-incarnation-refusal");

  const second = await rpc("session.start", params);
  sessions.push(second);
  const stopped = await rpc("session.stop", identity);
  assert.equal(stopped.verdict, "exited");
  assert.equal(
    (
      await rpc("session.read", {
        sessionId: second.id,
        incarnation: second.incarnation,
        cursor: 0,
      })
    ).session.verdict,
    "live",
  );
  report.checks.push("exact-session-cancellation-preserves-sibling");
  const secondStop = await rpc("session.stop", {
    sessionId: second.id,
    incarnation: second.incarnation,
  });
  assert.equal(secondStop.verdict, "exited");
  report.status = "PASSED";
} catch (error) {
  failure = error;
  report.error = error.message;
} finally {
  for (const session of sessions) {
    try {
      const stopped = await rpc("session.stop", {
        sessionId: session.id,
        incarnation: session.incarnation,
      });
      assert.equal(stopped.verdict, "exited");
      report.cleanup.push({ sessionId: session.id, verdict: stopped.verdict });
    } catch (error) {
      report.status = "FAILED";
      report.cleanup.push({
        sessionId: session.id,
        verdict: "unverifiable",
        error: error.message,
      });
    }
  }
  if (
    daemon &&
    daemon.pid &&
    daemon.exitCode === null &&
    daemon.signalCode === null
  ) {
    const exited = once(daemon, "exit");
    daemon.kill("SIGTERM");
    const settled = await Promise.race([
      exited.then(() => true),
      delay(5000).then(() => false),
    ]);
    if (!settled) {
      daemon.kill("SIGKILL");
      await Promise.race([exited, delay(2000)]);
      report.status = "FAILED";
      report.cleanup.push({ service: "forced-exit-after-timeout" });
    }
  }
  const serviceExited =
    !daemon?.pid || daemon.exitCode !== null || daemon.signalCode !== null;
  if (!serviceExited) report.status = "FAILED";
  report.cleanup.push({ service: serviceExited ? "exited" : "unverifiable" });
  if (
    serviceExited &&
    report.cleanup.every((item) => item.verdict !== "unverifiable")
  ) {
    await rm(fixture, { recursive: true });
    report.cleanup.push({ fixture: "removed" });
  } else report.cleanup.push({ fixture: "retained", path: fixture });
  report.finishedAt = new Date().toISOString();
  await mkdir(reportDir, { recursive: true });
  const output = path.join(
    reportDir,
    `core-cli-${Date.now()}-${randomUUID()}.json`,
  );
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.checks,
      report: output,
    }),
  );
}
if (failure) console.error(failure.message);
if (report.status !== "PASSED") process.exitCode = 1;
