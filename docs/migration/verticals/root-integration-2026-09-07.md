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
