import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** Private QA data, never a measurement of the user's provider accounts. */
export async function writeAcceptanceUsageFixture(directory, now = Date.now()) {
  assert.ok(Number.isSafeInteger(now) && now >= 0, "invalid fixture timestamp");
  const provider = (name, usedPercent) => ({
    provider: name,
    session: { usedPercent, windowMinutes: 300, resetsAt: null, resetDescription: "Offline acceptance fixture" },
    weekly: null,
    fableWeekly: null,
    updatedAt: now,
    error: null,
    status: "ok",
  });
  const snapshot = {
    claude: provider("claude", 38),
    codex: provider("codex", 24),
    memory: { rssBytes: null, processCount: null, unavailableReason: "Not measured by the offline usage fixture." },
    ports: { listening: [], unavailableReason: "Not measured by the offline usage fixture." },
  };
  const file = path.join(directory, "usage-fixture.json");
  const bytes = `${JSON.stringify(snapshot)}\n`;
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  return { path: file, sha256: createHash("sha256").update(bytes).digest("hex"), snapshot };
}

export function verifyAcceptanceUsageSnapshot(reading, expected) {
  assert.equal(reading?.ok, true, "usage IPC did not return a snapshot");
  for (const field of ["claude", "codex", "memory", "ports"]) {
    assert.deepEqual(reading.result?.[field], expected[field], `usage fixture mismatch: ${field}`);
  }
}

export function verifyAcceptanceUsageFallback(reading) {
  assert.equal(reading?.ok, true, "usage IPC did not return a snapshot");
  for (const provider of ["claude", "codex"]) {
    const actual = reading.result?.[provider];
    assert.equal(actual?.status, "unavailable", `${provider} did not stay unavailable`);
    assert.equal(actual.error, `${provider === "claude" ? "Claude" : "Codex"} is unavailable (forced for testing).`);
  }
}

async function refreshUsage(page) {
  const handle = await page.waitForFunction(
    () => window.drogon.usage.refresh(), null, { timeout: 10000 },
  );
  try { return await handle.jsonValue(); } finally { await handle.dispose(); }
}

/** Validate real file/schema/IPC behavior, including fail-closed fallback. */
export async function verifyRenderedUsageFixture(page, fixture, checks) {
  await page.waitForFunction(async (expected) => {
    const reading = await window.drogon.usage.snapshot();
    return reading.ok && ["claude", "codex"].every((provider) => {
      const actual = reading.result[provider];
      return actual.status === "ok"
        && actual.updatedAt === expected[provider].updatedAt
        && actual.session?.usedPercent === expected[provider].session.usedPercent;
    });
  }, fixture.snapshot, { timeout: 10000 });
  verifyAcceptanceUsageSnapshot(
    await page.evaluate(() => window.drogon.usage.snapshot()),
    fixture.snapshot,
  );
  checks.push("private-offline-usage-fixture-served-through-product-ipc");
  const original = await readFile(fixture.path);
  let originalError;
  try {
    await writeFile(fixture.path, "{ invalid fixture");
    verifyAcceptanceUsageFallback(await refreshUsage(page));
    checks.push("invalid-usage-fixture-falls-back-to-forced-unavailable");
    await unlink(fixture.path);
    verifyAcceptanceUsageFallback(await refreshUsage(page));
    checks.push("missing-usage-fixture-falls-back-to-forced-unavailable");
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    try { await writeFile(fixture.path, original, { mode: 0o600 }); }
    catch (error) {
      if (originalError) throw new AggregateError([originalError, error], "usage fixture validation and restoration failed");
      throw error;
    }
  }
  verifyAcceptanceUsageSnapshot(await refreshUsage(page), fixture.snapshot);
  assert.equal(createHash("sha256").update(await readFile(fixture.path)).digest("hex"), fixture.sha256);
  checks.push("offline-usage-fixture-restored-for-rendered-provider-journeys");
}
