import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import path from "node:path";

async function exchange(endpoint, frame) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let bytes = Buffer.alloc(0);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(value);
    };
    socket.setTimeout(3000, () =>
      finish(new Error("Native protocol probe timed out")),
    );
    socket.on("error", (error) => finish(error));
    socket.on("connect", () => socket.write(frame));
    socket.on("data", (chunk) => {
      if (bytes.length + chunk.length > 1024 * 1024)
        return finish(new Error("Response exceeded frame bound"));
      bytes = Buffer.concat([bytes, chunk]);
      const newline = bytes.indexOf(10);
      if (newline < 0) return;
      try {
        finish(null, JSON.parse(bytes.subarray(0, newline).toString("utf8")));
      } catch {
        finish(new Error("Native protocol response was not JSON"));
      }
    });
    socket.on("end", () => finish(null, null));
  });
}

export async function probeNativeProtocol(dataDir) {
  const canonical = await realpath(dataDir);
  const endpoint =
    process.platform === "win32"
      ? `\\\\.\\pipe\\drogon-v1-${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`
      : path.join(canonical, "runtime-v1.sock");
  if (process.platform !== "win32") {
    for (const target of [
      canonical,
      endpoint,
      path.join(canonical, "auth.token"),
    ]) {
      const info = await stat(target);
      assert.equal(
        info.mode & 0o077,
        0,
        "Runtime resources must not grant group/other permissions",
      );
      assert.equal(
        info.uid,
        process.getuid(),
        "Runtime resources must belong to the current user",
      );
    }
  }
  const auth = (
    await readFile(path.join(canonical, "auth.token"), "utf8")
  ).trim();
  assert.ok(
    auth.length >= 32,
    "Service token must have sufficient encoded length",
  );
  const frame = {
    protocol: 1,
    requestId: randomUUID(),
    auth,
    method: "status",
    params: {},
  };
  const request = (value) => exchange(endpoint, JSON.stringify(value) + "\n");
  for (const credentials of [
    { auth: "incorrect-probe-token" },
    { auth: undefined },
  ]) {
    const response = await request({ ...frame, ...credentials });
    assert.equal(response?.ok, false);
    assert.equal(response.error.code, "unauthorized");
    assert.ok(
      !JSON.stringify(response).includes(auth),
      "Response leaked authentication material",
    );
  }
  const unsupported = await request({ ...frame, protocol: 2 });
  assert.equal(unsupported?.error?.code, "unsupported_protocol");
  const unknown = await request({ ...frame, method: "probe.unknown" });
  assert.equal(unknown?.error?.code, "method_not_found");
  const additive = await request({
    ...frame,
    futureOptional: { ignored: true },
  });
  assert.equal(additive?.ok, true);
  assert.equal(additive.requestId, frame.requestId);
  assert.ok(
    !JSON.stringify(additive).includes(auth),
    "Status leaked authentication material",
  );
  const malformed = await exchange(endpoint, "{invalid}\n");
  assert.ok(
    malformed === null || malformed.ok === false,
    "Malformed input must not succeed",
  );
  const oversized = await exchange(
    endpoint,
    "x".repeat(1024 * 1024 + 1) + "\n",
  );
  assert.ok(
    oversized === null || oversized.ok === false,
    "Oversized input must not succeed",
  );
  const healthy = await request({ ...frame, requestId: randomUUID() });
  assert.equal(
    healthy?.ok,
    true,
    "Bad clients must not prevent later valid clients",
  );
  return [
    "native-resource-permissions",
    "authentication-and-no-token-leak",
    "version-and-additive-compatibility",
    "malformed-and-oversized-frame-isolation",
  ];
}
