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

## 13:46 UTC history integration checkpoint

ROOT integrated V4 `a56c6f0`, `3406c68`, `0d0dedc`, and `3adc0e7` as
`47896ca` through `78b4004`, excluding the unaccepted `bot.run` module.
Independent runner/history/snapshot/wire tests passed 57/57, then
`cargo test --workspace --locked` exited 0. Both history writes now share
one transaction; stale nonterminal observations preserve both rows, and
conflicting session linkage is refused. A ROOT assertion correction checks
the actual `endedAt` JSON key is present and null rather than comparing
a missing snake-case key to null.

`cargo clippy --workspace --all-targets --locked -- -D warnings` remains
RED on the existing unused `workspace_files::revalidate_containment`
test helper; V3 owns its correction. No lint suppression was added.
The `bot.run` candidate is still held: its long-lived Connection borrow
cannot release the Engine database mutex across ledger admission/dispatch,
and saved replay bypasses its workspace checks. Ledger-double tests do not
prove the Engine connection. V4 has a pure-stage correction request; ROOT
will reuse the existing staged ledger rather than add receipt storage.

No bot capability activation, paid-model run or installation occurred.
Candidate-only Files advertisement remains uncommitted pending visual
acceptance. Audit stays 11/12 (91.7%, medium confidence, delta zero), not
product completion; all 46 obligations and the fixed deadline remain.

## 13:12 UTC checkpoint

Combined candidate `0e4c115` includes V3 safe file reads (`40cf24a`):
41 explorer and 8 native Files RPC tests passed. V5 snapshot corrections
(`d7112a2`, `f2c03ba`, `0e4c115`) now pass all 4 ROOT wire regressions and
12 snapshot tests. Per-reference UTF-8 byte budgeting rejects oversized
materialization before parsing; scheduled triggers preserve existing storage
spelling while adding the admitted desktop field.

The new `accept-desktop.mjs --files` probe checks actual disk content,
unsaved edits across file/panel switches, save and reload. Its first run
failed before interaction because service connection was unavailable; this
is setup failure, not behavioral RED. After rebuilding the desktop, the next
run passed seven existing real terminal/shell checks and reached the explicit
Files advertisement assertion (RED, capability intentionally withheld).
No editor/save acceptance is claimed. Both runs observed owned daemon and
desktop exit without force. Evidence: `.preflight/acceptance/desktop-1788786638807-97caf570-3241-40a7-87ca-e25f5953f23d/report.json`.

V2 Bots mount `299b315` remains under review: rejected bridge promises leave
loading unresolved, scope echo needs validation, and Files descriptor identity
must survive Bot snapshot refreshes. V3 draft-lifetime corrections and V4
monotonic history/receipt corrections remain with their owners. V1's latest
dogfood close still reaches an `expect` through its reused spawn helper on
the unwind path; a fallible close correction is requested. No paid run or
release installation occurred at this checkpoint.

Audit remains 11/12 groups (91.7%, medium confidence, delta zero). This is
not a product parity percentage. All 46 obligations remain in scope and the
fixed 16:41:33 UTC deadline remains high-risk.

## 13:20 UTC checkpoint

V2 Bots mount `4e79a7f` + correction `5e35c59` passed 420 combined desktop
tests. V3 draft/store fixes `d3f8015` + `ddb52ab` then passed 448 tests.
The full Rust workspace suite exited 0 at the preceding `a7f42e1` checkpoint;
its test-only unused containment helper warning is queued with V3.

The development fixture had an actual startup race: after its UI reported
unavailable, a diagnostic bridge status call successfully reached the daemon.
The test now waits for authenticated CLI status before launching Electron.
With candidate-only, uncommitted `files.v1` advertisement, real Files acceptance
passed 11 checks: reading, editing, two-file and terminal navigation draft
retention, exact saved disk bytes, unchanged sibling, reload, plus existing
terminal checks. All owned sessions, desktop and daemon were observed exited.
Evidence: `.preflight/acceptance/desktop-1788787050361-835b6bcf-8793-412b-8002-e39847348d11/report.json`.
Visual inspection remains RED: explorer rows are horizontal and the textarea
is undersized/unstyled. V2 owns the CSS correction. True availability-induced
unmount and rejected-save observer handling remain separate V3 checks.
Functional PASS is not visual or release acceptance.

V1 dogfood corrections `accf843` + `79f7678` passed the ROOT opted-in,
pinned Sonnet 5 real-model test. At 13:19 UTC the actual daemon session
`cf055325-97c8-4a51-b44c-fe159b44b8a7`, incarnation
`2650797a-39ae-403c-a93a-236073080b6f`, returned the exact expected marker,
exit code 0 and close verdict `exited`. Latency was 5.5036s; the provider
reported US$0.137132 (34,237 cache-creation input tokens, 2 input, 18 output).
This was one bounded completion, not the final autonomous coordinated
artifact/failure/retry dogfood journey. V1 is preparing that proposal without
another paid launch yet.

V4 `3406c68` fixes completed-run projection but remains held: stale nonterminal
observations still use incoming verdicts and its two history writes are not
atomic. The correction must reuse a transaction-aware storage primitive after
the existing storage owner settles. No receipt table or new DDL is authorized.
V5 comment-only `365f422` is integrated. No release installation occurred;
audit remains 11/12 (91.7%, medium confidence), product scope all 46 obligations,
deadline risk high.

## 13:30 UTC checkpoint

V3 save-observer correction `3f22d96` passed independent review, all 451
desktop tests (38 files), and desktop typecheck. Rejected saves now leave
drafts dirty without an unhandled derived-promise rejection. The originating
leaf encountered a lifecycle capability error; V3 abandoned that dispatch
without process action and preserved the committed work and terminal.

The Files acceptance probe now checks usable editor dimensions, vertical
explorer rows and no horizontal overflow at 1440x900 and 760x900 in both
themes. Its two assertion-unit tests pass. A real Electron run on `3f22d96`
with candidate-only Files advertisement failed the editor-width assertion;
the first wide screenshot confirms the unstyled layout. This is behavioral
RED, not a startup failure. Existing terminal checks passed and all owned
sessions, desktop and daemon exited without force. Evidence:
`.preflight/acceptance/desktop-1788787729552-1a5bbce7-f6cd-4a10-ae14-ffedb2dcbce4/report.json`.

V3 Git test review additionally found Windows-invalid tab filenames in the
real fixtures; portable fixture isolation is queued with V3. V4 history
test review is complete but atomicity/ownership corrections remain held.
No bot capability activation, additional paid run or package installation.
Audit remains 11/12 groups (91.7%, medium confidence, delta zero), not a
product-parity percentage. All 46 obligations and the high-risk fixed
16:41:33 UTC deadline remain unchanged.

## 14:11 UTC checkpoint

Integrated V2 Files CSS `03d5132` as `0e8357f`: source editor-surface
tokens, 240px explorer split and narrow stacked layout. The probe merge
keeps the independent static CSS checks without importing the held contrast
block or its missing functions. Node syntax check and desktop build passed.

ROOT rebuilt the daemon/CLI and ran `node scripts/accept-desktop.mjs --files`
with candidate-only `files.v1` advertisement. Read, unsaved draft switching,
terminal navigation and exact-disk save assertions reached the first layout
gate, which failed: editor height was below 240px. The wide screenshot
confirms a roughly 40px textarea and unstyled tree contents; the outer split
now fills the work surface. V3 owns the remaining component correction.
All owned sessions, desktop and daemon exited. Evidence:
`.preflight/acceptance/desktop-1788790037562-96c311e6-422c-40ff-94a4-4e529e48b757/report.json`.
This is development-build RED, not installed or packaged acceptance.

Pi coordinator steering was queued behind long-running child-Run waits.
After each affected coordinator reported zero active leaves and a stable
checkpoint, a single Escape aborted only its current turn, restoring the
queued input; resubmission preserved its process, Task and Dispatch. V5,
V1, V3 and V4 acknowledged parent guidance. No active leaf was stopped or
replaced. Parent-Dispatch inbox checks are now required between child waits.

V1's immediate Windows error-capture correction is active. V3's Git wrapper
remains held pending full EOF/error handling, strict path decoding, bounded
cross-call reader resources, actual probe coalescing and portable fixtures.
V4 create/run handlers remain held pending composition with the canonical
request ledger; domain ledger traits are not accepted integration adapters.
V5's independent notices verifier is active, with no generator-derived
expected corpus and missing source notice text failing closed. Actual
Windows daemon runtime checks are requested for the existing CI runner;
compilation and JS pipe fixtures do not establish that acceptance.

No further model inference, Bot advertisement, package installation or
rights/service publication. Audit remains 11/12 groups (91.7%, medium
confidence, delta zero), all 46 product obligations remain in scope, and
the fixed 16:41:33 UTC deadline is high risk.
