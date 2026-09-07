import { lstat, open, unlink } from "node:fs/promises";
import path from "node:path";

// Interrupted and active holders are indistinguishable; never reclaim either.
export class PreviewInstallLockError extends Error {
  constructor(message, { path: lockPath, kind } = {}) {
    super(message);
    this.name = "PreviewInstallLockError";
    this.lockPath = lockPath;
    this.kind = kind;
  }
}

export function previewInstallLockPath(buildsDirectory) {
  return path.join(buildsDirectory, "install.lock");
}

// Untrusted payload bytes are unnecessary for a refusal diagnosis.
async function describeLockRefusal(lockPath, openError) {
  if (openError.code !== "EEXIST") return null;
  let stat;
  try {
    stat = await lstat(lockPath);
  } catch {
    stat = null;
  }
  if (stat?.isSymbolicLink()) {
    return new PreviewInstallLockError(
      `Refusing to start the preview install: ${lockPath} is a symlink, not a regular lock file. The installer will not create through it or alter it. Investigate why the lock path is a link; only after verifying no install is running and the installer has fully finished, remove it manually and retry.`,
      { path: lockPath, kind: "symlink" },
    );
  }
  if (stat?.isDirectory()) {
    return new PreviewInstallLockError(
      `Refusing to start the preview install: ${lockPath} is a directory, not a regular lock file. The installer will not alter it. Investigate the path; only after verifying no install is running and the installer has fully finished, remove it manually and retry.`,
      { path: lockPath, kind: "directory" },
    );
  }
  if (stat && !stat.isFile()) {
    return new PreviewInstallLockError(
      `Refusing to start the preview install: ${lockPath} exists and is not a regular lock file. The installer will not alter it. Investigate the path; only after verifying no install is running and the installer has fully finished, remove it manually and retry.`,
      { path: lockPath, kind: "not-regular" },
    );
  }
  // PID or age cannot establish whether another installer still owns the lock.
  return new PreviewInstallLockError(
    `Refusing to start the preview install: the install lock already exists at ${lockPath}. Another installer may still be running, or a previous install was interrupted before releasing the lock. Verify that no installer process is active and that any previous installer has fully finished; only then remove ${lockPath} manually and retry. The existing lock was not modified.`,
    { path: lockPath, kind: "occupied" },
  );
}

export async function acquirePreviewInstallLock(
  buildsDirectory,
  { lockPayload } = {},
) {
  const lockPath = previewInstallLockPath(buildsDirectory);
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    const refusal = await describeLockRefusal(lockPath, error);
    if (refusal) throw refusal;
    throw error;
  }
  const lockIdentity = await lock.stat();
  try {
    await lock.writeFile(
      typeof lockPayload === "string"
        ? lockPayload
        : JSON.stringify(
            lockPayload ?? {
              pid: process.pid,
              startedAt: new Date().toISOString(),
            },
          ),
    );
  } catch (error) {
    await lock.close().catch(() => {});
    const current = await lstat(lockPath).catch(() => null);
    if (current?.ino === lockIdentity.ino && current?.dev === lockIdentity.dev)
      await unlink(lockPath).catch(() => {});
    throw error;
  }
  return {
    path: lockPath,
    async release() {
      await lock.close();
      // Preserve replacements observed before release; this is not atomic CAS.
      const current = await lstat(lockPath).catch(() => null);
      if (
        current?.ino === lockIdentity.ino &&
        current?.dev === lockIdentity.dev
      )
        await unlink(lockPath);
    },
  };
}
