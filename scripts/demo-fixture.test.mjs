import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DEMO_MARKER_NAME, teardownFixture } from "./demo-fixture.mjs";

test("demo fixture teardown is idempotent and only removes marked state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drogon-demo-teardown-"));
  const manifestPath = path.join(root, "manifest.json");
  const markerNonce = "test-marker-nonce";
  await writeFile(
    path.join(root, DEMO_MARKER_NAME),
    JSON.stringify({
      format: 1,
      owner: "drogon-demo-fixture",
      root,
      nonce: markerNonce,
    }),
  );
  await writeFile(
    manifestPath,
    JSON.stringify({
      format: 1,
      owner: "drogon-demo-fixture",
      root,
      markerNonce,
      dataDir: "/tmp/drogon-demo-test-data",
      hostId: "host-1",
      projectId: "project-1",
      worktreeId: "worktree-1",
      workspaceId: "workspace-1",
      worktreePath: "/tmp/drogon-demo-test-data/workspaces/demo/demo-fix",
      botId: "bot-1",
      responsibilityId: "responsibility-1",
      responsibilityAutomationId: "bot-automation-1",
      automationId: "automation-1",
    }),
  );

  const calls = [];
  const invoke = async (method, params) => {
    calls.push({ method, params });
    return { removed: true };
  };

  const first = await teardownFixture({ rootPath: root, manifestPath, invoke });
  assert.equal(first.removed, true);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ["bot.delete", "automation.delete", "worktree.remove", "project.remove"],
  );
  await assert.rejects(readFile(root), { code: "ENOENT" });
  await assert.rejects(readFile(manifestPath), { code: "ENOENT" });

  const second = await teardownFixture({
    rootPath: root,
    manifestPath,
    invoke,
  });
  assert.deepEqual(second, {
    removed: false,
    alreadyClean: true,
    operations: [],
  });
  assert.equal(
    calls.length,
    4,
    "a second teardown must not repeat daemon mutations",
  );
});

test("teardown removes only a runtime installed in the manifest data directory", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "drogon-demo-runtime-root-"),
  );
  const dataDir = await mkdtemp(
    path.join(os.tmpdir(), "drogon-demo-runtime-data-"),
  );
  t.after(() =>
    Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(dataDir, { recursive: true, force: true }),
    ]),
  );
  const manifestPath = path.join(root, "manifest.json");
  const runtimePath = path.join(
    dataDir,
    "mentu",
    "runtime",
    "bin",
    "mentu-recipes",
  );
  await mkdir(path.dirname(runtimePath), { recursive: true });
  await writeFile(
    path.join(root, DEMO_MARKER_NAME),
    JSON.stringify({
      format: 1,
      owner: "drogon-demo-fixture",
      root,
      nonce: "runtime-marker",
    }),
  );
  await writeFile(runtimePath, "pinned runtime bytes\n");
  await writeFile(
    manifestPath,
    JSON.stringify({
      format: 1,
      owner: "drogon-demo-fixture",
      root,
      markerNonce: "runtime-marker",
      dataDir,
      runtimeInstallPath: runtimePath,
      runtimeInstallOwned: true,
      runtimeInstallStatus: "installed",
    }),
  );

  const result = await teardownFixture({ rootPath: root, manifestPath });
  assert.equal(result.removed, true);
  assert.ok(result.operations.includes("runtime"));
  await assert.rejects(readFile(runtimePath), { code: "ENOENT" });
});

test("teardown refuses an existing unmarked directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "drogon-demo-unmarked-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(path.join(root, "user-data.txt"), "must survive\n");
  await assert.rejects(
    teardownFixture({ rootPath: root, manifestPath, invoke: async () => ({}) }),
    /Refusing to touch existing/,
  );
  assert.equal(
    await readFile(path.join(root, "user-data.txt"), "utf8"),
    "must survive\n",
  );
});
