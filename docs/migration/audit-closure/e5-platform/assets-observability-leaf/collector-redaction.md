# E5 assets/observability leaf — collector + redaction bounded contracts

Audit-only leaf, no descendants, no writes outside this file pair. Source is
the read-only reference at pinned commit `c97906287bb7a390b25e2025b600d9fb3c25d9c3`
(`/Users/carlos/Documents/Drogon-mentu-session`, verified via `git rev-parse` above).
Machine companion: [collector-redaction.json](collector-redaction.json).

Scope is the finite file set assigned by the lead (assets/telemetry client+consent,
IPC, submission/service seams remain the lead's): the local trace/bundle collector,
the redactor, the local NDJSON sink, tracer/instrumentation, bundle byte-limit
constant, logs-directory path resolution, and the crash-storage/persistence
boundary (crash report store, crashpad dump capture, crash breadcrumb store,
durable crash breadcrumb), plus the sanitizer helpers those files call directly.
No recursive import census was performed and no diagnostic-suite-wide claim is made.

Rewrite status: `apps/desktop/src/main` has **no** `observability/` or
`crash-reporting/` directory yet — this is a candidate source handoff, not a
parity check against existing rewrite code.

## Contract table (OBS-COL-*)

| ID | File (source-relative) | Blob SHA256 (git hash-object, full file) | Lines | Read | Summary |
| --- | --- | --- | --- | --- | --- |
| OBS-COL-01 | `src/main/observability/bundle.ts` | `750f41fead9c3b45971623c7fb55065297ff3667` | 191 | full | `collectBundle`: newest-first NDJSON scan across rotated trace + optional daemon-log family, end-time lookback filter (default 30 min, keeps unparseable timestamps), per-record + cumulative 4 MiB (`MAX_BUNDLE_BYTES`) enforcement, second (server-mode) redaction pass, 50 MiB per-file stat guard before read. |
| OBS-COL-02 | `src/main/observability/bundle.ts` (same file) | (see above) | — | full | `generateBundleSubmissionId`: 128-bit `randomBytes(16)` base64url, generated fresh per bundle, never persisted, explicitly not derived from/joinable to `install_id` (comment cites "Issue 8"). |
| OBS-COL-03 | `src/main/observability/local-file-sink.ts` | `b2a74bbbb40888273127541752ec2d950f5fe610` | 282 | full | `createLocalFileSink`: synchronous fd-based NDJSON append, size-based rotation (`file` → `.1` … `.N`, oldest dropped), per-record oversize drop, per-batch chunk splitting so one oversized batch doesn't lose valid records, directory/file mode hardened to `0700`/`0600`, write failure does one reopen+retry then silently drops the chunk. |
| OBS-COL-04 | `src/main/observability/diagnostic-bundle-limits.ts` | `cb70c7c95691e5f09c40e8c16d712032c9be1b6b` | 1 | full | Single constant `MAX_BUNDLE_BYTES = 4 * 1024 * 1024`, the shared cap OBS-COL-01 and the (out-of-leaf) upload path both key off. |
| OBS-COL-05 | `src/main/observability/logs-directory.ts` | `20ad104af740d6ed458d996c56c64e5c6bdb74f4` | 44 | full | Single source of truth for `<userData>/logs`, trace file (`main.trace.ndjson`) and daemon log (`daemon.log`) paths; explicit note that this intentionally diverges from Electron's `getPath('logs')` to avoid stranding existing bundles. |
| OBS-COL-06 | `src/main/observability/redactor.ts` | `da8feb0a8b0af99bdbc870765114aad15d73827f` | 237 | full | `redactString`/`redactValue`/`redactAttributes`/`redactSpan`: 4 idempotent string rules (labeled k/v, provider-key fingerprints, URL userinfo, `.env`-shape lines) + attribute-key blocklist (client set + server-only identity-key set `install_id`/`distinct_id` family). No per-value length cap by design (comment: would truncate diagnostic stack tails). |
| OBS-COL-07 | `src/main/observability/tracer.ts` | `c151aa6a2fb77093d76b4e678bafad466976a963` | 283 | full | Span lifecycle recorder (`withSpan`/`startSpan`) over `AsyncLocalStorage`; every finalized span is redacted client-mode (`redactSpan`) before being pushed to the sink; `noopSpan` when no sink installed; `flushActiveSink` swallows sink errors by design ("must never turn a recoverable crash into a main-process crash"). |
| OBS-COL-08 | `src/main/observability/instrumentation.ts` | `8569ab6ef048c2f3fbaf74f9d9cb683094b26179` | 332 | full | Span-boundary wrappers (git exec, worktree stages incl. phase-coverage math, updater stages) built on OBS-COL-07; includes a bounded (`GIT_SAMPLING_MAX_BUCKETS=512`) fast-success sampling window for `git.exec` spans so high-frequency fast git calls don't dominate trace volume. |
| OBS-COL-09 | `src/main/crash-reporting/crash-report-store.ts` | `143210418ce6821c769826a0d583d12c6de3fba0` | 259 | full | `CrashReportStore`: atomic temp-file+rename JSON persistence at `<userData>/crash-reports.json`, capped at 5 reports (`MAX_REPORTS`), serialized writes via an internal promise chain, Windows EPERM/EACCES/EBUSY retry ladder (5 delays) with one ACL-repair attempt, sibling-crash auto-dismiss within a 5 s correlation window, records go through `sanitizeCrashReportDetails`/`sanitizeCrashReportBreadcrumbs` (OBS-COL-13) at write time. |
| OBS-COL-10 | `src/main/crash-reporting/crashpad-capture.ts` | `1f628fe9c24e90c5766f5d6401cd0fab49d78416` | 317 | full | `startCrashpadCapture`/`waitForCrashMinidump`/`captureMinidumpSignature`: starts Electron's Crashpad handler with `uploadToServer:false` (no network path — dumps stay local), pairs dumps to a crash via mtime-recency window (30 s) + size ceiling (64 MiB/dump), prunes stored dumps against a 128 MiB / 64-file budget while protecting claimed/reserved paths, dump-signature parsing delegates to `minidump-crash-signature.ts` (out of leaf — see Unknown seams). |
| OBS-COL-11 | `src/main/crash-reporting/crash-breadcrumb-store.ts` | `2c0b68b043eaecd697a2fe40ac45a201a6ba0cda` | 281 | full | In-memory breadcrumb ring (`MAX_BREADCRUMBS=30`) + a separate retained-threshold map (`MAX_RETAINED_BREADCRUMBS=8`, keyed for `renderer_memory_highwater` marks) + a bounded coalescing map (`MAX_COALESCE_KEYS=128`) that folds repeat bursts into `suppressedSinceLast` on the ring entry it owns, with orphan-handling when the owned entry falls out of the visible window. Not itself persisted to disk — see OBS-COL-09 for the durable side. |
| OBS-COL-12 | `src/main/crash-reporting/durable-crash-breadcrumb.ts` | `ff1c77bc9c65ea2bc410a8d9d3d1f8ea7589eabf` | 88 | full | Wraps OBS-COL-11 with main-process lifecycle identity tagging and forces a `flushActiveSink()` (OBS-COL-07) after every durable breadcrumb write/failure so a crash immediately after the breadcrumb doesn't lose it to the tracer's normal batch window. |
| OBS-COL-13 | `src/shared/crash-report-redaction.ts` | `510792de2d85c62cb5faf8b17091cdda88f0e688` | 109 | full | `sanitizeCrashReportString`/`sanitizeCrashReportDetails`/`sanitizeCrashReportBreadcrumbs`: independent (not shared code with OBS-COL-06) path/credential/secret regex set, per-string 240-char cap (4,000 for stack-shaped keys detected by suffix match on `stack`/`component_stack`/`error_stack`/`minidump_check_message`), breadcrumbs capped to newest 30 and name-length-capped to 80. Directly called by OBS-COL-09 at every write. |
| OBS-COL-13b | `src/shared/crash-reporting.ts` | `194760afa8137c49858b7ebaeb4a73ec3e27a2d0` | 276 | partial (exports list + `formatCrashReportText` body, lines 192–241, read in full; remaining ~226 lines pointer-only) | `formatCrashReportText`, directly called by OBS-COL-09's `formatDiagnosticText`, re-emits `report.details`/`report.breadcrumbs` **verbatim** — safe only because OBS-COL-09 sanitizes at write time via OBS-COL-13. This file's own type/status/reason helpers were not read and are outside this leaf's characterization. |

Inclusive full-file byte-identity for OBS-COL-01–12 plus OBS-COL-13/13b is the git
blob SHA256 column above (`git hash-object` at the pinned commit); these are
**provenance identifiers, not behavior proof** — a byte-identical file can still
regress once re-executed under Electron/Node in the rewrite.

## Concrete controls read (collection / redaction / caps / rotation / storage)

- **Collection + attachment caps**: OBS-COL-01 enforces the 4 MiB bundle cap
  (OBS-COL-04) both per-record (`maxRecordBytes`) and cumulatively
  (`currentBytes + redactedBytes > MAX_BUNDLE_BYTES` → `break outer`), and a
  50 MiB per-source-file stat guard before `readFileSync` to avoid an
  attacker-tampered oversize file forcing a large synchronous read.
- **Redaction**: two independent redaction paths exist in this leaf —
  OBS-COL-06 (spans/bundles, three call sites: sink-write, bundle-collect,
  server-ingest) and OBS-COL-13 (crash reports, single call site: record-time
  in OBS-COL-09). See Finding F1 below for a coverage divergence between them.
- **Local logs persistence/rotation/failures**: OBS-COL-03's rotation cascades
  highest-index-first to avoid overwriting a still-needed file, reopens the
  base file after rotation, and on a write failure does exactly one
  reopen+retry before silently dropping the chunk (comment: "telemetry must
  never crash main"). No breadcrumb, log line, or counter records a dropped
  chunk — see Finding F2.
- **Crash storage**: OBS-COL-09 persists via write-temp-then-rename with a
  `finally`-block cleanup of the temp file on any failure path, a 5-entry
  MAX_REPORTS cap, and a Windows-specific retry ladder gated on
  `process.platform === 'win32'` plus the error's `code` (`EPERM`/`EACCES`/`EBUSY`).
- **OS host ownership**: OBS-COL-10 starts Electron's real Crashpad handler
  (`uploadToServer:false`) and depends on Electron/Chromium's out-of-process
  dump writer timing (hence the 8 s poll window) — this is a real OS/Electron
  execution boundary this review cannot verify statically. See Unknown seams.

## Test associations (finite, this leaf's files only)

Body-read means I read the actual `it(...)` assertion bodies, not just the name.

| Source file | Test file | Lines | Read depth |
| --- | --- | --- | --- |
| bundle.ts | `src/main/observability/bundle.test.ts` | 582 | body-read for the byte-cap/truncation/oversize-skip block (lines 247–330: "does not append a span that would push the payload over the upload cap", "keeps the newest spans when the bundle size cap truncates a file", "skips individually oversized recent spans...", "skips oversized middle spans..."); remaining ~35 `it` blocks (submission-ID shape, lookback filtering, daemon-log merge, redaction pass, `validateUploadUrl`, `uploadBundle`/`deleteBundle`) are pointer-only (names enumerated, bodies not read) — those last two describe blocks (`validateUploadUrl`, `uploadBundle and deleteBundle`) test `diagnostic-bundle-upload.ts`/`diagnostic-upload-*.ts`, which are the lead's submission-seam files, not this leaf's. |
| local-file-sink.ts | `src/main/observability/local-file-sink.test.ts` | 272 | body-read for the full "rotation" describe block (lines 111–217: byte-cap rotation, UTF-8 byte accounting, single-record drop, oversized-batch split, worst-case total-disk-cap); "basic write", "listing + clearing", "robustness" describes are pointer-only (names enumerated). |
| redactor.ts | `src/main/observability/redactor.test.ts` | 342 | pointer-only — all ~35 `it` names enumerated (provider-key fingerprints per tag, labeled-kv, URL userinfo, `.env`-shape, attribute blocklist incl. nested/compound, server-mode identity keys, recursion/circular, idempotence, span-shape preservation); no assertion bodies read in this pass. |
| tracer.ts | `src/main/observability/tracer.test.ts` | 203 | not enumerated or read this pass — outstanding. |
| instrumentation.ts | `src/main/observability/instrumentation.test.ts` | 251 | not enumerated or read this pass — outstanding. |
| crash-report-store.ts | `src/main/crash-reporting/crash-report-store.test.ts` | 266 | body-read for the Windows-recovery block (lines 162–218: ACL-repair-and-retry, transient EPERM/EACCES/EBUSY read recovery, rename-lock retry, terminal-failure temp-file cleanup); `describe('CrashReportStore')` top-level list enumerated (names only) for the remaining ~12 cases (cap-to-5, corrupt-JSON recovery, terminal-status-once, sibling-dismiss ×2, concurrent-write serialization, `attachDetails` ×4); pointer-only for those. |
| crashpad-capture.ts | `src/main/crash-reporting/crashpad-capture.test.ts` | 292 | pointer-only — all ~19 `it` names enumerated (`waitForCrashMinidump` recency/poll/deadline, `captureMinidumpSignature` claim/reject/mismatch, dump pruning byte/count/claimed-retention); no assertion bodies read this pass. |
| crash-breadcrumb-store.ts | `src/main/crash-reporting/crash-breadcrumb-store.test.ts` (623 lines) + `-leak.test.ts` (68) + `-orphan-cleanup.test.ts` (167) | 858 combined | not enumerated or read this pass — outstanding; file sizes alone (main file is the largest in this leaf) indicate this needs a dedicated pass before any coalescing-correctness claim. |
| durable-crash-breadcrumb.ts | `src/main/crash-reporting/durable-crash-breadcrumb.test.ts` | 97 | not enumerated or read this pass — outstanding. |
| shared/crash-report-redaction.ts + shared/crash-reporting.ts | `src/shared/crash-reporting.test.ts` | 502 | not enumerated or read this pass — outstanding; this is the file most directly relevant to Finding F1 below and should be the next read. |

No test file in this leaf was executed. Nothing here is a PASS/FAIL claim —
source-and-test reading only, per the tests-first migration gate.

## Findings (source defects / unknown seams — not proven failures)

**F1 — Divergent secret-redaction coverage between the two redactors (PLAUSIBLE, needs the assertion-body read of `crash-reporting.test.ts` to confirm test coverage either way).**
OBS-COL-06 (`redactor.ts`, used for spans/bundles) has explicit patterns for
AWS secret access keys (`aws_secret_access_key\s*[:=]\s*[A-Za-z0-9/+=]{40}`)
and bare JWTs (`eyJ...\....\....`). OBS-COL-13 (`crash-report-redaction.ts`,
used for crash-report `details`/`breadcrumbs`) has no equivalent: its
`SECRET_ASSIGNMENT_PATTERN` key-name group is `token|access[_-]?token|
refresh[_-]?token|api[_-]?key|client[_-]?secret|secret|password|
account[_-]?key`, and `\b` immediately before `secret` will not match the
`_` before `secret` in `aws_secret_access_key`, so that assignment shape
falls through; and it has no bare-JWT pattern at all (only
`Bearer\s+<token>`, which requires the `Bearer ` prefix to be present in the
string). **Concrete failure scenario**: a crash-report detail string
containing `aws_secret_access_key=AKIA...restofsecret...` or a bare JWT
(no `Bearer ` prefix) would pass OBS-COL-13 unredacted into
`crash-reports.json` and into `formatCrashReportText`'s verbatim output,
while the same string in a trace span would be redacted by OBS-COL-06.
This is a genuine source-level asymmetry, verified by direct regex reading
on both sides; it is not yet confirmed as an actual test gap because
`crash-reporting.test.ts`'s assertion bodies were not read this pass (see
test-association table).

**F2 — Silent data loss on local sink write failure, no observability signal (PLAUSIBLE).**
OBS-COL-03's `writeChunk` swallows both the original write error and a
retry-after-reopen failure with no callback, counter, or breadcrumb. This is
explicitly by design ("telemetry must never crash main"), but it means a
persistent disk-full or permission condition produces a trace file that
silently stops growing with no signal anywhere in this leaf's files that
data is being lost — a user support bundle collected during such a condition
would look like "quiet app," not "broken logging." No test in the
`local-file-sink.test.ts` "robustness" describe (pointer-only, not body-read)
was confirmed either way to assert on this path.

**F3 — Unknown external/OS seams, explicitly out of this leaf's characterization.**
- `parseMinidumpCrashSignature` (`minidump-crash-signature.ts`) — OBS-COL-10
  calls it directly but the file is outside this leaf's assigned set; the
  real minidump binary format and its parser correctness are not evaluated
  here.
- Electron's real Crashpad handler process (native, out-of-process dump
  writer) — OBS-COL-10's 8 s poll/250 ms interval is a black-box wait on
  Chromium/Electron internals; this review cannot verify OS-level Crashpad
  behavior (WER on Windows, Apple Crash Reporter on macOS) from source
  alone.
- `../win32-utils` (`grantDirAclAsync`, `isPermissionError`) — OBS-COL-09
  calls these directly for the Windows ACL-repair path; the ACL-grant
  implementation itself is outside this leaf's assigned file set.
- `../../shared/app-environment` (`getAppEnvironment`/`hasAppEnvironment`) —
  OBS-COL-05 depends on this for `userData` path resolution; not read here.

## Exact next tests (not yet body-read, ranked by what would close F1/F2 fastest)

1. `src/shared/crash-reporting.test.ts` (502 lines) — read assertion bodies
   for any case exercising `aws_secret_access_key`-shaped or bare-JWT input,
   to confirm or refute F1 as a real gap vs. an already-covered case I
   missed in the source read.
2. `src/main/crash-reporting/crash-breadcrumb-store.test.ts` +
   `-leak.test.ts` + `-orphan-cleanup.test.ts` (858 lines combined) — largest
   unread surface in this leaf; needed before any coalescing/eviction
   correctness claim on OBS-COL-11.
3. `src/main/observability/redactor.test.ts` (342 lines) — body-read to
   confirm OBS-COL-06's own five rule families are asserted with the same
   rigor the bundle-cap tests showed for OBS-COL-01.
4. `src/main/observability/tracer.test.ts` (203) and
   `instrumentation.test.ts` (251) — not yet touched this pass.
5. `src/main/crash-reporting/crashpad-capture.test.ts` (292) and
   `crash-report-store.test.ts`'s remaining ~12 non-Windows-recovery cases —
   body-read to confirm the pruning-byte/count-budget and cap-to-5/sibling-
   dismiss behavior matches OBS-COL-10/09's source claims above.

## Precedence and scope

This is a candidate for lead/root review, not E5 closure, not implementation
parity, and not a claim that all ~57 diagnostic-suite test bodies were read —
only the ones enumerated above were. Source counts and hashes above are
provenance, not behavior proof. No tests were run, no services/providers were
called, no uploads/telemetry queries/source writes/credentials/dependencies/
Git mutations occurred, and no UI was touched. No original telemetry
destinations are proposed for reuse in the rewrite.
