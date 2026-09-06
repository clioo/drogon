import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function probeSessionBoundaries({
  rpc,
  expectsRpcError,
  eventually,
  workspace,
  sessions,
}) {
  const start = async (program) => {
    const session = await rpc("session.start", {
      workspaceId: workspace.id,
      command: process.execPath,
      args: ["-e", program],
      cols: 80,
      rows: 24,
    });
    sessions.push(session);
    return { sessionId: session.id, incarnation: session.incarnation };
  };

  const fast = await start(
    'process.stdout.write("FAST_EXIT_EVIDENCE\\n");process.exitCode=7',
  );
  await eventually(
    () => rpc("session.list", { workspaceId: workspace.id }),
    ({ sessions: rows }) =>
      rows.some(
        (row) =>
          row.id === fast.sessionId &&
          row.verdict === "exited" &&
          row.exitCode === 7,
      ),
    "Fast child exit persisted",
  );
  assert.equal((await rpc("session.stop", fast)).verdict, "exited");
  const retained = await eventually(
    () => rpc("session.read", { ...fast, cursor: 0 }),
    (value) =>
      Buffer.from(value.dataBase64, "base64")
        .toString()
        .includes("FAST_EXIT_EVIDENCE"),
    "Exited output drain",
  );
  assert.equal(retained.session.verdict, "exited");
  assert.ok(
    Buffer.from(retained.dataBase64, "base64")
      .toString()
      .includes("FAST_EXIT_EVIDENCE"),
  );
  const resized = await rpc("session.resize", {
    ...fast,
    cols: 91,
    rows: 25,
  }).catch((error) => {
    assert.equal(error.code, 1);
    assert.ok(
      ["unverifiable", "invalid_argument"].includes(
        JSON.parse(error.stdout).error.code,
      ),
    );
    return null;
  });
  if (resized)
    assert.equal(
      resized.verdict,
      "exited",
      "Resize cannot revive an exited session",
    );

  for (const malformed of [
    { cursor: -1 },
    { cursor: "0" },
    { limitBytes: null },
    { limitBytes: 0 },
  ]) {
    await expectsRpcError(
      "session.read",
      { ...fast, cursor: 0, ...malformed },
      "invalid_argument",
    );
  }
  await expectsRpcError(
    "session.list",
    { workspaceId: 123 },
    "invalid_argument",
  );
  await expectsRpcError(
    "session.start",
    {
      workspaceId: workspace.id,
      command: process.execPath,
      args: "not-an-array",
    },
    "invalid_argument",
  );

  const large = await start(
    'process.stdout.write("Z".repeat(1200000),()=>{process.stdout.write("RING_END_MARKER");setTimeout(()=>process.exit(0),10000)})',
  );
  await eventually(
    () => rpc("session.read", { ...large, cursor: 0 }),
    (value) => value.truncated && value.startCursor > 0,
    "Real PTY ring truncation",
  );
  let cursor = 0;
  let sawMarker = false;
  let sawTruncation = false;
  let tail = "";
  for (let page = 0; page < 64 && !sawMarker; page += 1) {
    const output = await rpc("session.read", {
      ...large,
      cursor,
      limitBytes: 65536,
    });
    const bytes = Buffer.from(output.dataBase64, "base64");
    assert.equal(output.nextCursor - output.startCursor, bytes.length);
    assert.ok(bytes.length <= 65536);
    sawTruncation ||= output.truncated;
    tail = tail + bytes.toString();
    sawMarker ||= tail.includes("RING_END_MARKER");
    tail = tail.slice(-32);
    cursor = output.nextCursor;
    if (!bytes.length) await delay(50);
  }
  assert.ok(
    sawTruncation && sawMarker,
    "Truncated output must remain pageable to its actual tail",
  );
  assert.equal((await rpc("session.stop", large)).verdict, "exited");

  if (process.platform !== "win32") {
    const readyFile = path.join(workspace.path, `closed-stdio-${randomUUID()}`);
    const eof = await start(
      `const fs=require("node:fs");for(const fd of [0,1,2])fs.closeSync(fd);fs.writeFileSync(${JSON.stringify(readyFile)},"ready");setTimeout(()=>process.exit(0),8000)`,
    );
    await eventually(
      async () => {
        await access(readyFile);
        return true;
      },
      Boolean,
      "Child confirms stdio closed",
      3000,
    );
    await delay(100);
    const began = Date.now();
    const stopped = await rpc("session.stop", eof);
    assert.equal(stopped.verdict, "exited");
    assert.ok(
      Date.now() - began < 3000,
      "PTY EOF must not block stop until the child exits by itself",
    );
  }
  return [
    "fast-exit-and-stopped-output-retention",
    "malformed-optional-arguments-refused",
    "real-pty-ring-truncation-and-paging",
    "pty-eof-does-not-block-owned-stop",
  ];
}
