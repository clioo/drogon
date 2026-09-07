# Root integration — 2026-09-07

## 12:17 UTC checkpoint (supersedes holds below where noted)

V4 checkpoints are staged as `faa279d` and `0927d1c`. Root independently
passed automation execution 17/17, responsibility policy 15/15 and runner
21/21. The combined desktop suite passes 264/264 in 25 files; typechecking
passes. The bound frozen skill-sharing catalog suite passes 2/2. These are
isolated policy/adapter/UI contracts, not live automation or mounted Bot parity.

Root added `bot.snapshot` over existing scoped Bot storage and registered
workspace ownership. Five actual Engine regressions failed with missing methods
before implementation and now pass: own-scope data, missing/foreign host,
foreign workspace row, recoverable malformed data, and caller folder override.
The endpoint is read-only, has no capability advertisement or desktop bridge yet,
requires an explicit locale, and rejects oversized responses. Deleted-Bot
history remains stored but is not listed by this live-Bot snapshot.

Windows daemon API dependencies are provisioned in `b001dfc`: existing
`windows-sys 0.61.2`, six requested features, only one new lockfile dependency
edge. Locked offline Mac checks pass; this does not compile Windows-only code.
V5 acceptance corrections and a real Windows CI entry are integrated through
`a438b0d`; local Windows-probe tests were 21 passed / 7 Windows-only skipped.

Current acceptance holds:

- Files core remains with V3; no `files.v1` advertisement yet. UI `cbe54ad`
  has a successful A→B→A save-receipt reuse bug, pending-save retirement on
  file switch, and prop/state transition fencing corrections assigned to V3.
  V2 may prepare the hidden mount from exact committed UI blobs.
- Runner recording loses exact session identity and needs retry-safe durable
  history and observation timestamps. V4 owns the correction and proposal;
  root retains RPC contracts. No timer or real model activation.
- V1 actual Windows transport/service wiring remains under review, and final
  fixture corrections are awaiting a stable handoff. No Windows parity claim.

Audit remains 11/12, 91.7%, medium confidence, delta zero. The fixed target is
still 16:41:33 UTC; full-parity and installed-build gates remain high risk.

## 11:51 UTC checkpoint

Integrated candidate: `f3ea46a`, branch `codex/vertical-integration`.
This is not a release or a full-parity acceptance.

Accepted into the candidate after root code review:

- V1 CLI baseline `0489018` (root `e226502`). Real-model tests remain held for
  opt-in, result parsing and exact-session cleanup corrections; a skipped model
  leg is not successful provider evidence.
- V2 route/settings baseline `625544e` (root `c5fea1d`), theme `f540e54`,
  recovery/palette/settings preservation `5800537`, and executable CDP probe
  through `726cf8f`. Earlier probe cleanup claims were superseded by the
  all-exited invariant and independently addressable CLI cleanup channel.

Root verification on the combined candidate:

- Desktop Vitest: 21 files, 220 tests passed; TypeScript check passed.
- `cargo build -p drogond -p drogon-cli --locked --offline`: passed.
- Electron production build: passed; upstream Zod annotation warnings only.
- Real dev Electron + real drogond, isolated folder/data/profile, Playwright
  CDP: keyboard creation, tab selection/focus, and six explicit/system theme
  combinations passed. Root inspected the dark-theme screenshot.
- Both created shell sessions were stopped by exact identity and observed as
  `exited`; final inventory contained two exited sessions. Exact host/service
  `runtime.shutdown` was admitted; desktop and daemon were observed exited,
  with no forced-stop result. Probe exit code was 0.

Local screenshots are under `.preflight/v2-kbd-1788781834567/` (ignored).
This run exercises the working-page cleanup path, not an injected renderer
crash. Windows remains explicitly unverified; no packaged-install claim.

## Integration holds

- Files RPC: eight root-authored behavioral tests are pending against the
  missing service methods. Root glue is prepared but not wired or advertised.
  V3 is correcting bounded enumeration, UTF-8 path fidelity, metadata result
  shape, opened-handle file validation and exclusive temporary creation.
- Files UI: root review found counter-based request ID reuse across mounts,
  stale content across scope transitions, reads after capability loss, and
  discarded listing truncation. V3 owns the correction; V2 has the proposed
  factory signature only. Unread files must never become empty-file saves.
- V4 runner and Bots UI remain unintegrated pending functional runner handoff,
  additive RPC proposal and removal of inferred liveness from stored sessions.
- V5 Windows acceptance corrections and V1 actual native transport remain in
  their assigned worktrees. No platform parity claim from POSIX-only runs.

Source audit remains 11/12 (91.7%, medium confidence, delta 0); all 46 package
obligations remain. Product completion has no defensible percentage. The fixed
16:41:33 UTC target has high risk; tests and scope are not reduced to meet it.

## 12:39 UTC checkpoint

Combined candidate: `053c89f`, not a release. This checkpoint supersedes the
earlier current-state holds above, not their historical verification records.

- V1 fixture fixes `fda7987` and `cef62f8` are integrated as `681b584` and
  `6b5ecbf`: every cleanup attempts a stop marker; unreadable PID evidence
  preserves fixtures; the regression is UID-independent and tears down its
  exact test directories. Root independently passed 25 lifecycle/receipt/
  cancellation/boundary tests, then reran all eight cancellation tests after
  the portability correction.
- `8f21da7` adds the final requested Windows threading feature to the daemon
  manifest. Locked metadata passes. Windows implementation `530b0e7` is NOT
  integrated: root found pending-overlapped lifetime, racing completion and
  permanent shutdown/clone-ownership defects. V1 owns the active correction.
  No Windows compile or execution acceptance is claimed.
- `bab4cdf` relocates the Bot display DTO to the desktop shared boundary with
  a full type reexport at the old renderer path. `28c1c10` adds validated
  `botSnapshot` IPC: explicit host/workspace/locale, existing sender-frame
  admission, deep record validation, exact response-scope matching and native
  errors preserved verbatim. Twelve new isolated bridge cases pass; the full
  combined desktop suite passed 381 tests across 35 files, with TypeScript
  clean. These tests do not prove the native snapshot's resource bounds.
- V4 style checkpoint `63edd954` is integrated as `053c89f`, preserving the
  existing descriptor API, Button primitive and canonical tokens. Root passed
  all 26 Bots contract tests. This remains an unmounted export, not rendered
  interaction acceptance.

Active acceptance work:

- V3 owns FIFO-safe read/readback, Windows imports, scoped in-memory draft
  retention, and save-retry ordering. Review of `a6cab17` found that ambiguous
  A followed by confirmed B can still replay A's old receipt; the correction
  must also retain retry identity at the memory limit. Neither that UI delta
  nor Files capability activation is accepted yet.
- V2 owns App layout and capability-gate wiring. `ecea077` keep-alive and
  `d8a7107` gate are not integrated: the gate must be wired and validated
  against explicit capability loss while busy. Bots mount planning uses the
  existing route system and stays dark pending root acceptance.
- V4 owns durable runner history and scope-safe retained Bot history; V5
  owns only the native snapshot's bounded-query correction and auth/locale/
  size regressions. V5 prerequisite registration hunks mirror the existing
  root baseline; only its later correction should be integrated.
- Bot-run RPC is still a proposal. Root requires asserted host scope checked
  against host authority, typed invocation reason, stable request identity,
  changed-parameter conflicts, inherited permission defaults and preserved
  session incarnation. No automatic timer or paid-model activation occurred.

No packaged installation is claimed for this checkpoint. Source audit remains
11/12 (91.7%, medium confidence, delta zero); product parity still has no
defensible completion percentage over its 46 obligations. The 16:41:33 UTC
target remains high risk. Next closure is real Files/Bots interaction followed
by combined packaged acceptance, without weakening the safety gates.

## 12:50 UTC checkpoint

Combined candidate: `43d3b0f`, not a release. V2 `ecea077`, `d8a7107` and
`9a45524` plus V3 `a6cab17` are now staged. Root independently passed all
396 desktop tests across 35 files, TypeScript and the desktop build. Rebuilt
daemon/CLI and the real Electron Playwright CDP probe passed 34 checks:
keyboard focus, six theme combinations, 1440/760 layout and inspector behavior,
with both fixture sessions observed exited and quiescent daemon shutdown.
Screenshots are under `.preflight/v2-kbd-1788785294071/` (untracked evidence).

This accepts only the narrow shell/layout behavior with Files withheld. Visual
inspection found nearly invisible dark header icons despite successful hit
testing; V2 owns the contrast investigation. The App gate has an effect-time
transition window, not a proven synchronous admission fence. V3 still owns
draft retention and ambiguous-save ordering; enabled Files remains unaccepted.

Root reviewed but did not integrate V5 `44034a3`: its DISTINCT linked-payload
budget undercounts per-history-row materialization. A repeated large linked
record can still amplify memory before the final response cap. V5 owns the
multiplicity/UTF-8-byte correction as well as the scheduled-trigger projection.
Root's `native_bot_wire` scheduled snapshot regression remains RED; persisted
snake-case storage compatibility must remain unchanged.

Root also reviewed but did not integrate V1 `4fcf2ee`: closed-check/I/O-issue
ordering and snapshot-handle/cancellation lifetime races remain. V1 owns those
corrections and a suspected Windows-only test compilation issue. No native
Windows acceptance is claimed. All five leaders remain active; no capability
activation, paid-model launch or packaged installation occurred here.

Audit closure stays 11/12 (91.7%, medium confidence, delta zero). All 46 product
obligations remain in scope; no full-parity completion percentage is asserted.
The fixed 16:41:33 UTC target remains high-risk.
