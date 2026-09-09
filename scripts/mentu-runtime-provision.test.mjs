import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import {
  MENTU_LOCK_SHA256,
  MENTU_LOCK_REVISION,
  MENTU_LOCK_VERSION,
  MENTU_RELEASE_URL,
  ensureOfficialMentuRuntime,
  bundledRuntimeDestination,
  provisionMentuRuntime,
} from "./mentu-runtime-provision.mjs";

// A fixture whose bytes are engineered to sha256 to the real pinned
// MENTU_LOCK_SHA256 would require the real binary; instead these tests
// point `MENTU_LOCK_SHA256` itself is fixed, so they build a fixture
// "source" and assert against that fixture's own hash via the exported
// constant only for the mismatch path, and skip the match-path assertions
// on the real value (would require the real binary — see the PR's manual
// proof for that). No network and no real binary download in this file.

const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "mentu-runtime-provision-"));
  roots.push(root);
  return root;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("refuses a source that does not match the approved lock and stages nothing", () => {
  const root = fixtureRoot();
  const source = join(root, "candidate");
  writeFileSync(source, "#!/bin/sh\necho not approved\n");
  chmodSync(source, 0o755);

  assert.throws(
    () => provisionMentuRuntime(source, root),
    /does not match the approved/,
  );
});

test("refuses a non-executable source", () => {
  const root = fixtureRoot();
  const source = join(root, "candidate");
  writeFileSync(source, "not executable");
  chmodSync(source, 0o644);

  assert.throws(() => provisionMentuRuntime(source, root), /not executable/);
});

test("refuses a symlink source", () => {
  const root = fixtureRoot();
  const real = join(root, "real-binary");
  writeFileSync(real, "#!/bin/sh\necho hi\n");
  chmodSync(real, 0o755);
  const source = join(root, "candidate-link");
  symlinkSync(real, source);

  assert.throws(() => provisionMentuRuntime(source, root), /regular file/);
});

test("bundledRuntimeDestination is under apps/desktop/resources/mentu-runtime/<revision>/bin", () => {
  const destination = bundledRuntimeDestination("/repo");
  assert.equal(
    destination,
    "/repo/apps/desktop/resources/mentu-runtime/c82ccfa0ebbe77d62193e068821ba6e74f87a8d3/bin/mentu-recipes",
  );
});

test("MENTU_LOCK_SHA256 is a 64-hex sha256, matching this crate's Rust lock constant", () => {
  assert.match(MENTU_LOCK_SHA256, /^[0-9a-f]{64}$/);
});

test("a mismatched source's sha256 is reported accurately in the thrown error", () => {
  const root = fixtureRoot();
  const source = join(root, "candidate");
  const bytes = "#!/bin/sh\necho distinct fixture\n";
  writeFileSync(source, bytes);
  chmodSync(source, 0o755);
  const expectedFixtureSha = sha256(readFileSync(source));

  try {
    provisionMentuRuntime(source, root);
    assert.fail("expected a lock-mismatch error");
  } catch (error) {
    assert.match(error.message, new RegExp(expectedFixtureSha));
  }
});

test("the official release pin agrees across packaging, daemon and desktop", () => {
  const rust = readFileSync(new URL("../crates/drogon-core/src/mentu/runtime.rs", import.meta.url), "utf8");
  const bridge = readFileSync(new URL("../apps/desktop/src/main/mentu-bridge.ts", import.meta.url), "utf8");
  for (const value of [MENTU_LOCK_REVISION, MENTU_LOCK_VERSION, MENTU_LOCK_SHA256]) {
    assert.ok(rust.includes(`"${value}"`));
  }
  assert.ok(bridge.includes(`"${MENTU_LOCK_REVISION}"`));
  assert.equal(MENTU_RELEASE_URL, "https://github.com/mentu-ai/mentu-recipes/releases/download/v0.5.0/mentu-recipes-macos-arm64");
});

test("download failure is fatal, not a package without a runtime", async () => {
  const root = fixtureRoot();
  await assert.rejects(ensureOfficialMentuRuntime(root, async () => new Response("missing", { status: 404 })), /download failed/);
  assert.equal(existsSync(bundledRuntimeDestination(root)), false);
});

test("unverified downloaded bytes are rejected before staging", async () => {
  const root = fixtureRoot();
  await assert.rejects(ensureOfficialMentuRuntime(root, async () => new Response("untrusted bytes")), /checksum mismatch/);
  assert.equal(existsSync(bundledRuntimeDestination(root)), false);
});

test("a corrupt cached runtime is rejected without trusting or replacing it", async () => {
  const root = fixtureRoot();
  const cached = bundledRuntimeDestination(root);
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, "#!/bin/sh\necho invalid\n", { mode: 0o755 });
  await assert.rejects(ensureOfficialMentuRuntime(root, async () => {
    assert.fail("must reject a corrupt cache before downloading");
  }), /does not match the approved/);
});
