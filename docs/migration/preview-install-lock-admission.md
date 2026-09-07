# Preview install lock admission and diagnosis correction

## Scope

Direct depth-1 review correction under root Astra. `scripts/install-preview.mjs`
acquired its exclusive install lock with a bare `open(install.lock, "wx")`, so an
interrupted (or concurrent) installer left the user a context-free
`EEXIST: file already exists` with no actionable diagnosis. This change extracts
the lock lifecycle — unchanged in mechanism — into
`scripts/preview-install-lock.mjs`, and makes every refusal fail closed with an
explanation. Only the lock module, its test, the installer call site, and this
document are touched; receipt/signature/archive/preservation semantics of the
installer are unchanged.

## The fix

`scripts/preview-install-lock.mjs` is the single owner of:

- **Acquisition** — same `open(lockPath, "wx", 0o600)` exclusive create as before.
- **Identity payload** — same `{ pid, startedAt }` JSON written into the lock.
- **Release** — same inode/dev-checked unlink: a lock path that was _replaced_
  while held belongs to someone else and is preserved, never deleted.

Refusals are diagnosed from **path metadata only** (`lstat`); the lock payload is
never read, because the path may be attacker-controlled via a redirected
`~/Applications/.drogon-builds` and its contents are irrelevant to the verdict:

- **Occupied regular lock** (`kind: "occupied"`): reports the exact lock path,
  states that another installer may be running _or_ a previous install was
  interrupted, and instructs the user to verify no installer process is active
  and that any previous installer has fully finished before removing the lock
  manually. The lock is never modified.
- **Symlink at the lock path** (`kind: "symlink"`): refused as not a regular
  lock file; the link and its target are left untouched; no install is
  performed through it.
- **Directory at the lock path** (`kind: "directory"`): refused as not a regular
  lock file; the directory is left untouched.
- **Other non-regular file** (`kind: "not-regular"`): same refusal shape.
- **Write failure after acquire**: the handle is closed and only the inode this
  holder created is removed (same inode check as release), so a failed identity
  write never leaks an orphaned lock that would block the next real install.

Explicit non-goals, by policy: staleness is **never inferred from the recorded
PID or file age** (an active install and an interrupted one are
indistinguishable from here); the module **never reclaims or deletes a lock it
did not create**; it **never signals any process**.

`scripts/install-preview.mjs` now calls `acquirePreviewInstallLock(builds)` and
`installLock.release()` in its existing `finally`; the lock path, payload, and
release semantics are byte-for-byte the prior logic, only relocated.

## RED / GREEN evidence

Tests-first against pinned Node24
(`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`,
v24.19.0), worktree-local, temp fixtures only (`mkdtemp` under the system temp
dir), no real `~/Applications`, user data, or full installer invocation.

Command (both phases):

```
node --test scripts/preview-install-lock.test.mjs
```

**RED** — with the lock logic extracted verbatim (pre-diagnosis), 4 of 7 tests
fail. The occupied-lock, symlink, and directory refusals all surfaced the raw
generic error, recorded verbatim from the run:

```
EEXIST: file already exists, open '/var/folders/.../preview-lock-test-W6iIeN/install.lock'
    at async open (node:internal/fs/promises:697:25)
    at async acquirePreviewInstallLock (.../scripts/preview-install-lock.mjs:26:16)
```

`ℹ pass 3 / ℹ fail 4` — exactly the diagnosed gap: no actionable message, no
distinction between an occupied lock and a symlink/directory at the path. (A
fourth failure exposed that `FileHandle.writeFile` does not stringify its
argument; serialization is now owned by the module, which also makes the
write-failure cleanup path reachable.)

**GREEN** — after adding `describeLockRefusal`: `ℹ tests 7 / ℹ pass 7 / ℹ fail 0`.

Coverage (`scripts/preview-install-lock.test.mjs`):

1. Existing regular lock → `PreviewInstallLockError` (`kind: "occupied"`), exact
   path in the message, active/interrupted wording, "fully finished" +
   "only then remove … manually" guidance; pre-existing lock bytes unchanged.
2. Symlink at lock path → `kind: "symlink"`, "not a regular" wording; link still
   a symlink afterward; its target's contents unmodified.
3. Directory at lock path → `kind: "directory"`; directory still present.
4. Normal acquire → identity payload contains this process's PID and a
   timestamp; `release()` removes the lock (`ENOENT` after).
5. Payload override → acquire/release symmetrical for staged installs.
6. Replaced lock inode → `release()` preserves the replacement file untouched.
7. Identity-write failure → only the holder-created lock is removed; `ENOENT`
   after.

Regression check on untouched neighbor suites:
`node --test scripts/preview-install-lock.test.mjs scripts/acceptance-process.test.mjs scripts/desktop-artifacts.test.mjs`
→ `ℹ tests 16 / ℹ pass 16 / ℹ fail 0`.

`node --check` passes on `install-preview.mjs`, `preview-install-lock.mjs`, and
the test.

## Gaps and limits

- Root independently reran all 16 tests successfully. The payload failure
  fixture throws during serialization, before the disk write; it does not
  establish ENOSPC or other real I/O-failure recovery. Three refusal REDs
  demonstrate the prior source behavior; the fourth was an intermediate
  extraction defect, not a newly discovered defect in the original installer.
- The retained lstat/inode/unlink check is best-effort against replacement
  observed before cleanup, not an atomic compare-and-unlink primitive against
  an adversarial concurrent path swap. This correction adds diagnostics,
  not a new hostile-filesystem security guarantee.
- The full installer (`install-preview.mjs`) was **not** executed end-to-end: it
  requires a real sealed, codesigned bundle and packaged acceptance report,
  which are root-owned artifacts. The refactor is call-site only and the lock
  semantics are test-covered in isolation; root should re-run the packaged
  install gate before admitting a new preview build.
- `EACCES`/`EPERM`/`ELOOP` acquisition failures are rethrown unchanged (not
  wrapped in `PreviewInstallLockError`); they are environmental errors, not
  lock-state refusals, and were out of the PR7 correction's scope.
- The refusal message names the lock path and the recovery precondition but
  deliberately does not inspect the lock payload (PID/timestamp), per policy;
  "verify the installer has finished" is left to the user's process check.
