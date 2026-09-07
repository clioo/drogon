# Packaged runtime sealed-bundle identity — admission report

## Root re-verification — 2026-09-06 21:16 UTC

After Sonnet's final App identity corrections, root independently reran
desktop typecheck, **114 desktop tests**, **35 packaging/process/bridge
tests**, and the Electron build: all passed. The rebuilt development app
again passed all **11** real Electron/Pi checks without inference, with
observed unforced session, desktop and daemon exits:
`.preflight/acceptance/desktop-1788729338121-430ce7b1-5fc7-4ce9-bd25-e578e90a908a/report.json`.
The profile is retained for inspectable evidence. This healthy rendered
flow does not substitute for adversarial async-context/race wiring tests.
Packaged, installed and full-Orca-fidelity acceptance remain pending.

## Root rendered development acceptance — 2026-09-06 21:02 UTC

Root independently verified desktop typecheck,105 tests and the Electron
build after Sonnet's bootstrap/recovery delivery. A real isolated-profile
Electron + CLI/service + Pi run then passed11 checks, without inference:
`.preflight/acceptance/desktop-1788728512666-62d32774-7e2c-4d53-8973-e8fee6642d14/report.json`.
The flow covered folder registration, terminal bytes, exact-session reload,
keyboard tab navigation/sibling close, explicit dismissal after reload,
Pi launch/form placement/light-dark/narrow/Escape, transport loss reported
unverifiable, reconnect to the same Pi session, and confirmed Pi exit.
Owned sessions, desktop and daemon all exited. Root visually inspected
light.png, harness-form-narrow.png and pi-unverifiable.png in that directory.
Pi's isolated test profile intentionally has no models; this proves its TUI
integration, not DGX inference, model defaults or Mentu comparison.

Three preceding actual runs failed at the Pi exit check. Root isolated the
instrument defect: Playwright1.63 waitForFunction evaluates the predicate's
Promise as truthy before its boolean result. Explicitly reading the returned
handle proved false, not exited, in
`.preflight/acceptance/desktop-1788728449737-6ca9e4c6-73f3-4ed8-b467-882392b7d1b2/report.json`.
Installed primary code coreBundle.js24413 confirms the synchronous predicate
truth test. Root replaced all three async IPC waits in probe-rendered-harness
with bounded Node-side awaited page.evaluate polling. Three new tests cover
false-then-true results, a stuck/late reply, and rejection without retry.
All35 packaging/process/bridge tests pass after formatting; test:packaging
and the existing CI invocation include them. Original assertions remain;
no product change was needed to make this healthy-path UI run pass.

Root also prevents forced first-instance quit from being overwritten by a
later PASSED result, and records error stacks for diagnostic failures.
Source candidate remains uncommitted at base7269184, not a sealed artifact.
Late-context close/incarnation and append ordering corrections remain assigned
to Sonnet; this UI run does not cover those races. Packaged startup, signature,
sealed installed acceptance and full Orca fidelity are still unproven.

## Root packaging preparation and cleanup tests — 2026-09-06 20:41 UTC

20:46 integration checkpoint: with the desktop worker settled, root
fast-forwarded this branch from14cfc74 to main7269184, preserving all dirty
desktop/package changes. Root independently verified98 desktop tests and72
renderer contracts before the next correction assignment. In this integrated
worktree, locked/offline Rust build and368 tests passed (one marker-gated
probe is ignored in ordinary enumeration and invoked by its owning test);
strict all-target Clippy and rustfmt passed. Real CLI/service acceptance
passed17 checks, report
`.preflight/acceptance/core-cli-1788727520808-a230d3ae-dfe1-4a03-9813-be74e4edb19d.json`.
All five fixture sessions and owned daemons exited; fixture removed.
This crash check stops the children first, not live-child crash proof.
Integrated notices now total191 entries/924030 bytes. Desktop final
host-fencing/bootstrap-error corrections remain active; no package accepted.

Root admitted the preserved additive `@electron/packager@20.0.4` lock and
package/install scripts without changing existing dependency versions or
renderer-contract scripts. The lock matches the original draft SHA-256
`d17c9cd392f9e1099c45922a0d00f73df3e1d1886d93812522a952083d331e72`.
Invoking the package test script triggered pnpm's automatic install:
38 packages reused from cache, zero downloaded. The active desktop worker
was notified to rerun its final tests after that dependency transition.
License-text collection with those dependencies found191 entries/923077 bytes,
no missing texts; this is not legal review or final packaged-artifact proof.

The existing acceptance-process module now supplies bounded exit observation
and exact-ChildProcess cleanup to desktop acceptance. Timeout and successful
signal delivery alone remain `unverifiable`; forced termination fails desktop
acceptance even when exit is subsequently observed. Signal exceptions return
an honest cleanup result rather than preventing report emission. Six focused
tests cover real normal exit, a live timeout, orderly and forced cleanup,
signal-without-exit, and signal failure. The last case failed behaviorally
before error handling (5pass/1fail); the initial missing-export setup failure
was not behavioral RED. Root ran the combined suite: **32pass/0fail/0skip**
on macOS. The native Linux/macOS CI job now runs this suite; remote execution
is still pending. No packaged launch or install has happened.

This proves owned direct-child cleanup only. The separately launched packaged
daemon still has its own ownership checks; live-child crash recovery is a
different worker's acceptance gate, not proven by these tests.

## Root correction: final-artifact archive identity

The installer still keyed archived builds by the old partial fingerprint,
so two accepted Electron runtimes with identical app/native bytes but different
frameworks could collide at the archive path and refuse the later installation.
Root extracted the existing key expression into the production-used
`previewArchiveName`, then reproduced equal keys for different sealed digests
(2 tests passed, 1 assertion failed). The key now includes the seal version and
the full final-artifact SHA-256, preserving old archives without name reuse.
The same regression and all seal tests pass: **26 passed, 0 failed, 0 skipped**.
No installer was run and no installed preview changed.

## Root correction: unambiguous tree framing

After correction dispatch ctx_6a4d7438f297 settled, root reproduced a further
v2 identity collision without attacking SHA-256: files `a=left` and `b=right`
(mode 600) serialized identically to one `a` containing
`left\\0file:b\\0600\\0right`. The raw streamed payload could impersonate the
next tree entry. The added regression failed with equal digests before the fix.

Version **3** streams each file into a separate SHA-256 and feeds an encoded
record containing path, mode, actual byte count and fixed-length content hash
into the tree hash. Payload bytes cannot inject record boundaries. Versions
1 and 2 are not accepted as v3 receipts. Root reran all three pure test files:
**25 passed, 0 failed, 0 skipped**. This supersedes the v2 encoding and 24-test
count below; all earlier evidence remains historical. Real packaging,
cross-platform execution, signing and install acceptance remain pending.

2026-09-06. Isolated PURE fixture/security slice on worktree
`codex-packaged-artifact-identity` (base `14cfc74`). Draft provenance from
`docs/migration/worktree-packaging-transfer.json` retained; no commits, pushes,
dependency installs, signing, packaging, installer execution or live services.
Root RED baseline (`packaged-identity-root-red.md`): 2 passed, 4 failed with
unchanged partial digest `cecc040d…495fa4`.

## Historical v2 implementation (superseded by root v3 framing above)

`scripts/desktop-artifacts.mjs` gains a detached sealed-bundle identity
(`SEALED_BUNDLE_VERSION = 2`): `sealedBundleDigest` walks the whole final
bundle in stable raw-byte path order, hashing every file's bytes plus ordinary
mode bits, directory modes, and in-bundle symlink target strings. Symlinks are
recorded, never followed, so the digest never reads outside the bundle;
escapes, cycles, special files and substituted paths fail closed. Required
runtime files (executable, daemon, CLI, build-info, DEPENDENCY-NOTICES.txt,
darwin Info.plist, desktop tree) must be present. Bounds:
`MAX_SEALED_ENTRIES = 100000`, `MAX_SEALED_BYTES = 2 GiB`,
`MAX_SEALED_FILE_BYTES = 512 MiB`, enforced while streaming. Pure helpers
`verifySealedBundle` and `assertSealedInstallAuthorization` (no side effects)
let installers and tests enforce the identity without launching anything.
Legacy `fingerprintBundle`/`verifiedBuildInfo` are unchanged for recovering
historical metadata-only previews; they no longer authorize installs alone.

## Enforcement wiring (receipt/admission portions only)

- `scripts/accept-desktop.mjs`: seals the candidate before launch, stores
  `sealedVersion/sealedDigest/sealedFileCount/sealedTotalBytes` plus
  `identityProof: sealed-final-artifact` in the detached report, re-verifies
  after acceptance, fails closed on mid-run change. Development (source-build)
  reports are labeled `source-build-not-final-artifact`.
- `scripts/install-preview.mjs`: verifies the sealed digest of the source
  candidate, the staged copy and the reuse target against the detached report;
  legacy reports without sealed fields fail closed.
- `scripts/package-desktop.mjs`: stamps legacy build-info with an explicit
  `provenance: legacy-partial-build-metadata-not-final-proof` marker and
  documents that sealing stays detached to avoid a self-hash re-sign loop.
  Packaging/signing/install execution logic untouched (root-owned).

## Correction dispatch (2026-09-06): link chains, file kinds, streaming caps

Root reproduced 3 REDs against the v1 sealer — `cyclic-link`, `dangling-link`
and `desktop-file` fixtures were accepted. All three are fixed and their
regression assertions kept in `scripts/packaged-runtime-admission.test.mjs`:

- Every symlink chain is now fully resolved with `realpath` at seal time:
  cycles (`ELOOP`), dangling links (`ENOENT`) and escapes through any hop fail
  closed, while real Electron framework internal links (`Versions/Current`)
  still resolve inside and stay allowed. Symlink bytes outside the bundle are
  never read. Checks are best-effort at seal time, not a proof against
  concurrent bundle mutation during sealing.
- Required runtime paths must be ordinary files (a symlink or directory at one
  of those paths no longer satisfies the check) and the desktop path must be a
  directory, so a file substituted for the desktop tree is refused.
- File bytes are hashed with bounded streaming: per-file and total caps are
  enforced as chunks arrive, with a stat size pre-check, so oversized input
  fails before full allocation. Caps are overridable per call
  (`{ maxEntries, maxTotalBytes, maxFileBytes }`) and exercised by tests with
  small bounds instead of GiB fixtures.
- Encoding change (file length prefix removed; size is committed by streamed
  bytes) bumps `SEALED_BUNDLE_VERSION` to 2; v1 receipts fail closed as
  unknown versions. No v1 report ever authorized a real install (fixture-only
  slice).
- `assertSealedInstallAuthorization` now also refuses calls presenting no
  digest at all, so a receipt alone authorizes nothing; install/accept callers
  re-verified to authorize recomputed candidate/staged/target bytes.

## Evidence (Node24, no dependencies, owned bounded fixtures, exact cleanup)

`/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/desktop-artifacts.test.mjs scripts/packaged-runtime-admission.test.mjs tests/parity/ports/WP-ENG-RUNTIME/package-admission/sealed-bundle-identity.test.mjs`
→ 24 passed, 0 failed/skipped: 2 legacy artifact tests, 3 link/desktop
regression REDs now GREEN plus 4 rebound mutation REDs GREEN, 15 additive
sealed-identity tests (determinism, mode coverage, internal symlink, direct /
chained escape/cycle/dangle refusal, runtime-path kind strictness, small-bound
caps, candidate-change and legacy-receipt refusal, candidate/staged/target
tamper refusal, legacy-report refusal).

## Limits and pending full-build prerequisites

Fixture-only macOS-layout coverage; no real Electron bundle sealed, no
codesign run, no installer executed, no Linux/Windows bundle verified, no
genuine packaged-app acceptance run. Real packaged acceptance still waits for
desktop/bootstrap and native lifecycle integration, then root
signing/packaging/acceptance/install with exact final-receipt verification
before anything is installed. This slice is not packaged-app acceptance.
