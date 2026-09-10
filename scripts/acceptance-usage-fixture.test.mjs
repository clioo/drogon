import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyAcceptanceUsageFallback, verifyAcceptanceUsageSnapshot, writeAcceptanceUsageFixture } from "./acceptance-usage-fixture.mjs";

async function withDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "drogon-usage-fixture-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true }); }
}

test("writes exclusive private offline provider data and its exact digest", async () => {
  await withDirectory(async (directory) => {
    const fixture = await writeAcceptanceUsageFixture(directory, 1234);
    const bytes = await readFile(fixture.path);
    assert.deepEqual(JSON.parse(bytes), fixture.snapshot);
    assert.equal(fixture.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(fixture.snapshot.claude.session.usedPercent, 38);
    assert.equal(fixture.snapshot.codex.session.usedPercent, 24);
    assert.equal(fixture.snapshot.claude.updatedAt, 1234);
    if (process.platform !== "win32") assert.equal((await stat(fixture.path)).mode & 0o777, 0o600);
  });
});

test("does not invent resource measurements or overwrite an existing file", async () => {
  await withDirectory(async (directory) => {
    const fixture = await writeAcceptanceUsageFixture(directory, 1234);
    assert.equal(fixture.snapshot.memory.rssBytes, null);
    assert.equal(fixture.snapshot.memory.processCount, null);
    assert.ok(fixture.snapshot.ports.unavailableReason);
    await writeFile(fixture.path, "keep this evidence");
    await assert.rejects(writeAcceptanceUsageFixture(directory), { code: "EEXIST" });
    assert.equal(await readFile(fixture.path, "utf8"), "keep this evidence");
  });
});

test("invalid timestamps fail before creating fixture data", async () => {
  await withDirectory(async (directory) => {
    for (const now of [-1, NaN, Infinity, 1.5]) {
      await assert.rejects(writeAcceptanceUsageFixture(directory, now), /timestamp/);
    }
    await assert.rejects(stat(path.join(directory, "usage-fixture.json")), { code: "ENOENT" });
  });
});

test("fallback requires the explicit offline guard, not merely a signed-out state", () => {
  const reading = { ok: true, result: {
    claude: { status: "unavailable", error: "Claude is unavailable (forced for testing)." },
    codex: { status: "unavailable", error: "Codex is unavailable (forced for testing)." },
  } };
  verifyAcceptanceUsageFallback(reading);
  assert.throws(() => verifyAcceptanceUsageFallback({ ok: false }), /usage IPC/);
  for (const provider of ["claude", "codex"]) {
    const altered = structuredClone(reading);
    altered.result[provider].error = "Not signed in.";
    assert.throws(() => verifyAcceptanceUsageFallback(altered));
    altered.result[provider].status = "ok";
    assert.throws(() => verifyAcceptanceUsageFallback(altered), /did not stay unavailable/);
  }
});

// Validator contracts only; actual file/schema/IPC behavior is checked in the app.
test("snapshot verification rejects IPC failures and any mismatched section", async () => {
  await withDirectory(async (directory) => {
    const { snapshot } = await writeAcceptanceUsageFixture(directory, 1234);
    verifyAcceptanceUsageSnapshot({ ok: true, result: snapshot }, snapshot);
    assert.throws(() => verifyAcceptanceUsageSnapshot({ ok: false }, snapshot), /usage IPC/);
    for (const field of ["claude", "codex", "memory", "ports"]) {
      const result = { ...snapshot, [field]: null };
      assert.throws(() => verifyAcceptanceUsageSnapshot({ ok: true, result }, snapshot), /mismatch/);
    }
  });
});
