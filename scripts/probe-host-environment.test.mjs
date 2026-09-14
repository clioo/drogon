// Clean-machine environment detection: the packaged suite must tell "this
// host cannot run the journey" apart from "the journey failed". These
// helpers decide that, so they are tested against real files and canned
// process results — never against the ambient host.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { hostBinaryAvailable, linkHostBinaryIntoFixtureBin } from "./probe-agent-settings.mjs";
import { findClaudeBinary } from "./probe-claude-terminal-input.mjs";

async function makeBin() {
  const dir = await mkdtemp(path.join(tmpdir(), "probe-host-env-"));
  return dir;
}

test("hostBinaryAvailable sees only executable files on the given PATH", async () => {
  const dir = await makeBin();
  const runnable = path.join(dir, "pi");
  await writeFile(runnable, "#!/bin/sh\n");
  await chmod(runnable, 0o755);
  assert.equal(await hostBinaryAvailable("pi", dir), true);
  assert.equal(await hostBinaryAvailable("missing", dir), false);
  assert.equal(await hostBinaryAvailable("pi", ""), false);
  assert.equal(await hostBinaryAvailable("pi", null), false);
  await chmod(runnable, 0o644);
  assert.equal(await hostBinaryAvailable("pi", dir), false);
});

test("hostBinaryAvailable searches every PATH entry", async () => {
  const first = await makeBin();
  const second = await makeBin();
  const runnable = path.join(second, "pi");
  await writeFile(runnable, "#!/bin/sh\n");
  await chmod(runnable, 0o755);
  assert.equal(await hostBinaryAvailable("pi", [first, second].join(path.delimiter)), true);
});

test("linkHostBinaryIntoFixtureBin links the genuine binary and reports it", async () => {
  const host = await makeBin();
  const bin = await makeBin();
  const genuine = path.join(host, "pi");
  await writeFile(genuine, "#!/bin/sh\n");
  await chmod(genuine, 0o755);
  assert.equal(await linkHostBinaryIntoFixtureBin(bin, "pi", host), true);
  const { readlink } = await import("node:fs/promises");
  assert.equal(await readlink(path.join(bin, "pi")), genuine);
  assert.equal(await linkHostBinaryIntoFixtureBin(bin, "pi", await makeBin()), false);
});

test("findClaudeBinary resolves a real binary and is null otherwise", async () => {
  const host = await makeBin();
  const genuine = path.join(host, "claude");
  await writeFile(genuine, "#!/bin/sh\n");
  await chmod(genuine, 0o755);
  const found = await findClaudeBinary(async () => ({ stdout: `${genuine}\n`, stderr: "" }));
  assert.equal(found, await (await import("node:fs/promises")).realpath(genuine));
  assert.equal(await findClaudeBinary(async () => ({ stdout: "\n", stderr: "" })), null);
  assert.equal(
    await findClaudeBinary(async () => ({ stdout: "/nonexistent/claude\n", stderr: "" })),
    null,
  );
  assert.equal(
    await findClaudeBinary(async () => {
      throw new Error("which failed");
    }),
    null,
  );
});

test("findClaudeBinary falls back to the real which by default", async () => {
  const found = await findClaudeBinary();
  assert.ok(found === null || found.endsWith(`${path.sep}claude`));
});
