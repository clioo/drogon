import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// This optional probe starts the installed Pi TUI without a prompt or inference request.
export async function probeHarnessLaunch({
  rpc,
  eventually,
  workspace,
  sessions,
}) {
  const status = await rpc("status");
  assert.ok(status.capabilities.includes("harness.catalog.v1"));
  assert.ok(status.capabilities.includes("harness.launch.v1"));
  const catalog = await rpc("harness.list");
  assert.equal(catalog.hostId, status.hostId);
  const pi = catalog.harnesses.find((item) => item.harnessId === "pi");
  assert.equal(
    pi?.availability,
    "available",
    "Pi must be installed for this explicit probe",
  );
  const requestId = randomUUID();
  const params = {
    workspaceId: workspace.id,
    harnessId: "pi",
    permissionMode: "unattended",
    cols: 100,
    rows: 32,
  };
  const session = await rpc("harness.start", params, requestId);
  sessions.push(session);
  assert.equal(session.hostId, status.hostId);
  assert.equal(session.workspaceId, workspace.id);
  assert.equal(session.command, pi.executable);
  assert.ok(session.args.includes("--approve"));
  const replay = await rpc("harness.start", params, requestId);
  assert.equal(replay.id, session.id);
  assert.equal(replay.incarnation, session.incarnation);
  const identity = { sessionId: session.id, incarnation: session.incarnation };
  await eventually(
    () => rpc("session.read", { ...identity, cursor: 0 }),
    (result) => {
      assert.equal(
        result.session.verdict,
        "live",
        "Pi exited before its startup output",
      );
      const output = Buffer.from(result.dataBase64, "base64").toString("utf8");
      return output.length > 40 && /pi|ctrl|model/i.test(output);
    },
    "Installed Pi startup through Drogon's own service",
    15000,
  );
  assert.equal((await rpc("session.stop", identity)).verdict, "exited");
  return [
    "native-harness-discovery-on-execution-host",
    "installed-pi-tui-launch-replay-and-exact-stop-without-inference",
  ];
}
