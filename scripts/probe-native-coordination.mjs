import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Real typed CLI and daemon; this probe never launches an agent or model.
export async function probeNativeCoordination({ cli }) {
  const invoke = async (args, requestId = randomUUID()) => {
    let response;
    try {
      response = await cli([
        "--request-id",
        requestId,
        "orchestration",
        ...args,
      ]);
    } catch (error) {
      let code = "no_valid_envelope";
      try {
        code = JSON.parse(error.stdout).error.code;
      } catch {}
      throw new Error(`Native CLI ${args[0]} failed: ${code}`, {
        cause: error,
      });
    }
    assert.equal(response.ok, true);
    assert.equal(response.requestId, requestId);
    return response.result;
  };
  const coordinator = `accept-${randomUUID()}`;
  const createId = randomUUID();
  const create = [
    "run-create",
    "--coordinator-id",
    coordinator,
    "--objective",
    "Synthetic native coordination acceptance",
  ];
  const { run } = await invoke(create, createId);
  assert.equal(run.coordinatorId, coordinator);
  assert.equal(run.consumerGeneration, 1);
  assert.deepEqual((await invoke(create, createId)).run, run);
  const bootstrap = await invoke([
    "request-show",
    "--scope",
    "bootstrap",
    "--request",
    createId,
    "--bootstrap-coordinator-id",
    coordinator,
  ]);
  assert.equal(bootstrap.state, "committed");
  assert.equal(bootstrap.receipt.result.run.runId, run.runId);
  const scope = [
    "--run",
    run.runId,
    "--coordinator-id",
    coordinator,
    "--consumer-generation",
    "1",
  ];
  const instructions = "Keep literal task text: $PATH; `not a command` 🐉";
  const taskId = randomUUID();
  const createTask = ["task-create", ...scope, "--instructions", instructions];
  const { task } = await invoke(createTask, taskId);
  assert.equal(task.status, "ready");
  assert.deepEqual((await invoke(createTask, taskId)).task, task);
  const detail = await invoke(["task-show", ...scope, "--task", task.taskId]);
  assert.equal(detail.spec.instructions, instructions);
  const listed = await invoke(["task-list", ...scope]);
  assert.equal(listed.tasks.length, 1);
  assert.equal(listed.tasks[0].taskId, task.taskId);
  const saved = await invoke([
    "request-show",
    ...scope,
    "--scope",
    "coordinator",
    "--request",
    taskId,
  ]);
  assert.equal(saved.state, "committed");
  assert.equal(saved.receipt.result.task.taskId, task.taskId);
  const empty = await invoke(["check", ...scope, "--peek"]);
  assert.equal(empty.messages.length, 0);
  assert.ok(empty.delivery == null);
  const absent = await invoke([
    "request-show",
    ...scope,
    "--scope",
    "coordinator",
    "--request",
    randomUUID(),
  ]);
  assert.equal(absent.state, "absent");
  assert.ok(absent.receipt == null);
  return [
    "native-typed-cli-run-replay-and-bootstrap-receipt",
    "native-typed-cli-task-replay-literal-text-and-actor-receipt",
    "native-typed-cli-empty-inspection-and-absent-receipt",
  ];
}
