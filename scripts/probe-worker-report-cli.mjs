import assert from "node:assert/strict";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// A fixture harness, never a model: only the real host-provided CLI is executed.
export async function prepareWorkerReportFixture(fixture) {
  if (process.platform === "win32") {
    throw new Error(
      "The synthetic worker harness requires a POSIX execution host",
    );
  }
  const directory = path.join(fixture, "worker-report");
  await mkdir(directory);
  const executable = path.join(directory, "claude");
  await writeFile(
    executable,
    `#!/bin/sh
umask 077
set -eu
out="$NATIVE_REPORT_FIXTURE"
cli="$DROGON_CLI_COMMAND"
"$cli" --json --request-id fixture-final orchestration send --kind final-report --outcome succeeded --subject completed --body 'Synthetic worker, no model inference' --result '{"testsPassed":7}' > "$out/first.json"
"$cli" --json --request-id fixture-final orchestration send --kind final-report --outcome succeeded --subject completed --body 'Synthetic worker, no model inference' --result '{"testsPassed":7}' > "$out/replay.json"
"$cli" --json --request-id fixture-status status > "$out/status.json"
"$cli" --json --request-id fixture-recover orchestration request-show --scope dispatch --request fixture-final > "$out/receipt.json"
"$cli" --json --request-id fixture-duplicate orchestration send --kind final-report --outcome succeeded --subject completed > "$out/duplicate.json"
if "$cli" --json --request-id fixture-conflict orchestration send --kind final-report --outcome failed --subject conflict > "$out/conflict.json"; then exit 81; fi
if "$cli" --json --request-id fixture-check orchestration check --peek > "$out/check.json"; then exit 82; fi
printf 'complete\\n' > "$out/complete"
`,
  );
  await chmod(executable, 0o700);
  return {
    PATH: [directory, process.env.PATH ?? ""].join(path.delimiter),
    NATIVE_REPORT_FIXTURE: directory,
  };
}

export async function probeWorkerReportCli({
  cli,
  rpc,
  eventually,
  workspace,
  sessions,
  fixture,
}) {
  const invoke = async (args, id = randomUUID()) => {
    const response = await cli(["--request-id", id, "orchestration", ...args]);
    assert.equal(response.ok, true);
    return response.result;
  };
  const coordinator = `report-${randomUUID()}`;
  const { run } = await invoke([
    "run-create",
    "--coordinator-id",
    coordinator,
    "--objective",
    "Synthetic report round trip",
  ]);
  const scope = [
    "--run",
    run.runId,
    "--coordinator-id",
    coordinator,
    "--consumer-generation",
    "1",
  ];
  const { task } = await invoke([
    "task-create",
    ...scope,
    "--instructions",
    "Only run the synthetic report fixture",
  ]);
  const startArgs = [
    "worker-start",
    ...scope,
    "--task",
    task.taskId,
    "--workspace",
    workspace.id,
    "--harness",
    "claude",
  ];
  const startId = randomUUID();
  const catalog = (await cli(["harness", "list"])).result;
  const selected = catalog.harnesses.find(
    (item) => item.harnessId === "claude",
  );
  assert.equal(
    await realpath(selected.executable),
    await realpath(path.join(fixture, "worker-report", "claude")),
    "Only the synthetic harness may launch",
  );
  const started = await invoke(startArgs, startId);
  assert.ok(
    started.sessionIdentity?.sessionId,
    "native start must return its exact session",
  );
  sessions.push({
    id: started.sessionIdentity.sessionId,
    incarnation: started.sessionIdentity.incarnation,
  });
  assert.deepEqual(await invoke(startArgs, startId), started);
  const output = path.join(fixture, "worker-report");
  try {
    await eventually(
      () => readFile(path.join(output, "complete"), "utf8"),
      (text) => text.trim() === "complete",
      "Original worker credential report and recovery",
      15000,
    );
  } catch (error) {
    const checks = {};
    for (const name of [
      "first",
      "replay",
      "status",
      "receipt",
      "duplicate",
      "conflict",
      "check",
    ]) {
      try {
        const value = JSON.parse(
          await readFile(path.join(output, `${name}.json`), "utf8"),
        );
        checks[name] = { ok: value.ok, code: value.error?.code };
      } catch {
        checks[name] = "missing-or-incomplete";
      }
    }
    const ring = await rpc("session.read", {
      ...started.sessionIdentity,
      cursor: 0,
    });
    const tail = Buffer.from(ring.dataBase64, "base64")
      .toString("utf8")
      .slice(-2500)
      .replace(/[a-f0-9]{64}/g, "[redacted]");
    throw new Error(
      `${error.message}; fixture checks ${JSON.stringify(checks)}; output ${tail}`,
    );
  }
  const result = async (name) =>
    JSON.parse(await readFile(path.join(output, `${name}.json`), "utf8"));
  const first = await result("first");
  assert.equal(first.ok, true);
  assert.equal(first.result.lifecycle.action, "settled");
  assert.deepEqual((await result("replay")).result, first.result);
  assert.equal((await result("status")).ok, true);
  const recovered = await result("receipt");
  assert.equal(recovered.result.state, "committed");
  assert.deepEqual(recovered.result.receipt.result, first.result);
  assert.equal((await result("duplicate")).result.lifecycle.duplicate, true);
  assert.equal((await result("conflict")).error.code, "report_conflict");
  assert.equal((await result("check")).error.code, "unauthorized");
  const shown = await invoke(["task-show", ...scope, "--task", task.taskId]);
  assert.equal(shown.task.status, "completed");
  const worker = await invoke([
    "worker-show",
    ...scope,
    "--dispatch",
    started.dispatchId,
  ]);
  assert.deepEqual(worker.reportResult, { testsPassed: 7 });
  const mail = await invoke(["check", ...scope, "--all"]);
  assert.equal(mail.messages.length, 1);
  assert.equal(mail.messages[0].messageId, first.result.message.messageId);
  await eventually(
    () => rpc("session.list"),
    (value) =>
      value.sessions.some(
        (s) =>
          s.id === started.sessionIdentity.sessionId && s.verdict === "exited",
      ),
    "Synthetic worker process exit",
  );
  const released = await invoke([
    "worker-release",
    ...scope,
    "--dispatch",
    started.dispatchId,
  ]);
  assert.equal(released.processVerdict, "exited");
  return [
    "native-worker-real-cli-original-credential-report-replay-and-recovery",
    "native-worker-conflict-denial-and-single-mail-settlement",
    "native-worker-owned-release-after-observed-fixture-exit",
  ];
}
