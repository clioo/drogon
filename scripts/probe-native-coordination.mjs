import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Real typed CLI and daemon; this probe never launches an agent or model.
export async function probeNativeCoordination({ cli }) {
  const invoke = async (args, requestId = randomUUID(), pending = false) => {
    let response;
    try {
      response = await cli([
        "--request-id",
        requestId,
        "orchestration",
        ...args,
      ]);
    } catch (error) {
      if (pending && error.code === 1) {
        response = JSON.parse(error.stdout);
        assert.equal(response.ok, true);
        assert.equal(response.result.wait.outcome, "pending");
        assert.equal(response.requestId, requestId);
        return response.result;
      }
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
  const sendId = randomUUID();
  const send = ["send", ...scope, "--kind", "guidance", "--subject", "Literal $PATH; guidance"];
  const sent = await invoke(send, sendId);
  assert.deepEqual(await invoke(send, sendId), sent);
  const batch = await invoke(["check", ...scope]);
  assert.equal(batch.messages.length, 1);
  assert.equal(batch.messages[0].messageId, sent.message.messageId);
  assert.deepEqual((await invoke(["check", ...scope])).delivery, batch.delivery);
  const acked = await invoke(["check", ...scope, "--ack", batch.delivery.deliveryId]);
  assert.equal(acked.acknowledged.deliveryId, batch.delivery.deliveryId);
  assert.equal(acked.messages.length, 0);
  const askId = randomUUID();
  const ask = ["ask", ...scope, "--question", "Proceed literally?", "--timeout-ms", "1"];
  const question = await invoke(ask, askId, true);
  assert.equal((await invoke(ask, askId, true)).questionMessageId, question.questionMessageId);
  const answer = await invoke(["reply", ...scope, "--question", question.questionMessageId, "--body", "Yes — $PATH stays literal"]);
  assert.equal(answer.questionMessageId, question.questionMessageId);
  const resumed = await invoke(["ask", ...scope, "--resume", question.questionMessageId, "--timeout-ms", "1"]);
  assert.equal(resumed.wait.outcome, "answered");
  assert.equal(resumed.answer.body, "Yes — $PATH stays literal");
  const mail = await invoke(["check", ...scope, "--all"]);
  assert.equal(mail.messages.length, 3);
  return [
    "native-typed-cli-run-replay-and-bootstrap-receipt",
    "native-typed-cli-task-replay-literal-text-and-actor-receipt",
    "native-typed-cli-empty-inspection-and-absent-receipt",
    "native-typed-cli-send-replay-fifo-and-whole-batch-ack",
    "native-typed-cli-question-timeout-replay-reply-and-resume",
  ];
}
