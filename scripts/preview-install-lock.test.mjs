import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  acquirePreviewInstallLock,
  previewInstallLockPath,
  PreviewInstallLockError,
} from "./preview-install-lock.mjs";

async function fixtureDir(context) {
  const dir = await mkdtemp(path.join(tmpdir(), "preview-lock-test-"));
  context.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function expectRefusal(promise) {
  const error = await promise.then(
    () => {
      throw new Error("expected lock refusal but acquisition succeeded");
    },
    (error) => error,
  );
  assert.ok(
    error instanceof PreviewInstallLockError,
    `expected PreviewInstallLockError, received ${error}`,
  );
  return error;
}

test("an existing regular lock fails closed with an actionable diagnosis", async (context) => {
  const dir = await fixtureDir(context);
  const lockPath = previewInstallLockPath(dir);
  await writeFile(lockPath, '{"pid":424242}', { mode: 0o600 });
  const error = await expectRefusal(acquirePreviewInstallLock(dir));
  assert.equal(error.lockPath, lockPath);
  assert.equal(error.kind, "occupied");
  assert.match(error.message, /install\.lock/);
  assert.match(error.message, /active|interrupted/i);
  assert.match(error.message, /only then remove .* manually/i);
  assert.match(error.message, /fully finished/i);
  // Fail closed: the pre-existing lock is left exactly as it was, contents
  // untouched (we never read it for diagnostics either).
  assert.equal(await readFile(lockPath, "utf8"), '{"pid":424242}');
});

test("a symlink at the lock path is refused and left unaltered", async (context) => {
  const dir = await fixtureDir(context);
  const outside = path.join(dir, "outside-target");
  await writeFile(outside, "do not touch");
  const lockPath = previewInstallLockPath(dir);
  await symlink(outside, lockPath);
  const error = await expectRefusal(acquirePreviewInstallLock(dir));
  assert.equal(error.kind, "symlink");
  assert.match(error.message, /not a regular/);
  const stat = await lstat(lockPath);
  assert.ok(stat.isSymbolicLink());
  assert.equal(await readFile(outside, "utf8"), "do not touch");
});

test("a directory at the lock path is refused and left unaltered", async (context) => {
  const dir = await fixtureDir(context);
  const lockPath = previewInstallLockPath(dir);
  await mkdir(lockPath);
  const error = await expectRefusal(acquirePreviewInstallLock(dir));
  assert.equal(error.kind, "directory");
  assert.match(error.message, /not a regular/);
  assert.ok((await lstat(lockPath)).isDirectory());
});

test("normal acquire writes the identity payload and release removes the lock", async (context) => {
  const dir = await fixtureDir(context);
  const lockPath = previewInstallLockPath(dir);
  const lock = await acquirePreviewInstallLock(dir);
  const raw = JSON.parse(await readFile(lockPath, "utf8"));
  assert.equal(raw.pid, process.pid);
  assert.ok(raw.startedAt);
  await lock.release();
  await assert.rejects(lstat(lockPath), { code: "ENOENT" });
});

test("a payload override keeps acquire/release symmetrical for staged installs", async (context) => {
  const dir = await fixtureDir(context);
  const lockPath = previewInstallLockPath(dir);
  const lock = await acquirePreviewInstallLock(dir, {
    lockPayload: JSON.stringify({ pid: 7, startedAt: "t" }),
  });
  assert.equal(await readFile(lockPath, "utf8"), '{"pid":7,"startedAt":"t"}');
  await lock.release();
  await assert.rejects(lstat(lockPath), { code: "ENOENT" });
});

test("release preserves a lock path that was replaced while held", async (context) => {
  const dir = await fixtureDir(context);
  const lockPath = previewInstallLockPath(dir);
  const lock = await acquirePreviewInstallLock(dir);
  const replacement = path.join(dir, "replacement");
  await writeFile(replacement, "someone else's lock");
  await rename(replacement, lockPath);
  await lock.release();
  // The replaced inode is not ours; it must survive release untouched.
  assert.equal(await readFile(lockPath, "utf8"), "someone else's lock");
});

test("failed identity serialization removes only the lock this holder created", async (context) => {
  const dir = await fixtureDir(context);
  const lockPath = previewInstallLockPath(dir);
  await assert.rejects(
    acquirePreviewInstallLock(dir, {
      lockPayload: {
        toJSON() {
          throw new Error("payload refused");
        },
      },
    }),
    /payload refused/,
  );
  await assert.rejects(lstat(lockPath), { code: "ENOENT" });
});
