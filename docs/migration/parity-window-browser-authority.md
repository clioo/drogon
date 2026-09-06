# Window + browser-host authority (G17/G18)

Coordinator-reviewed bounded source contracts, v2, against frozen source
c97906287bb7a390b25e2025b600d9fb3c25d9c3 at rewrite8cf48eb.
Leaf provenance: task_d474323a72d6 / ctx_bf30aa048ee3, Muse.
Audit and candidate/runtime acceptance remain open. JSON lists39 direct
source/test reads with full hashes and explicit partial bounds. Three
boundary documents were read completely, not treated as executable proof.

## G17 — window placement and authority

- Popout singleton restores a minimized existing window; focus is suppressed
  on background launch. Explicit view requests are forwarded. Public IPC
  admits only board/map/undefined; direct creation accepts other strings
  (the original test uses kanban). Preserve these different entry boundaries.
- Popout restore requires width>=480,height>=360 and240x180 overlap with
  an attached display workArea; fallback960x720 without saved x/y. Main
  restore instead requires width>600,height>400 and300x200 overlap. Main
  fallback uses primary workArea size, or1200x800 on screen failure. These
  are not the same minimum/equality rules.
- Bounds overlap rejects screen API failure; it is not a real monitor/DPI
  journey. Both resize/move saves debounce500ms. Popout skips closing,
  destroyed, minimized, fullscreen and below-min states; main does not
  explicitly skip minimized state. Main maximized/near-min paths update only
  the maximized flag, preserving old bounds. Valid nonmaximized bounds+flag
  share one Store mutation, not a proven disk-atomic transaction.
- Main initial reveal is one-shot, including optional did-finish-load and
  Win/Linux10s fallback. Windowless launch stays hidden; saved maximize and
  foreground policy apply on reveal. Main closed handler closes popout and
  removes lifecycle/resume hooks. Popout close unsubscribes zoom, clears
  pending bounds timer and broadcasts closed. App before-quit freezes saves.
- Popout uses a separate in-memory partition, sandbox, no webviews and no
  browser-host identity stamp. Privileged navigation policy is installed and
  both permission handlers explicitly deny. It mirrors pages, not hosts them.
  Main stamps its host-id argument at creation before renderer IPC is ready.
- Popout local zoom survives repeated unchanged app zoom; an actual app zoom
  change updates it. Menu focus, keyboard overrides and wheel zoom have
  separate routing. UI settings types: windowBounds/dashboardPopoutBounds
  are optional nullable rectangles; windowMaximized is optional boolean,
  NOT nullable. uiZoomLevel is a number.
- IPC open/publish requires trusted main plus feature enabled; mount/relay
  requires the live popout plus feature enabled and validated arguments.
  Snapshot cache clears on close/disable. Invalid snapshots keep prior board;
  partial invalid cards warn/drop through admission. Omitted repo icons are
  carried in the replay cache, not inflated into every live forwarded snapshot.

Coordinator read all19 popout test bodies and their mock setup, but did not
execute that Electron-mocked suite. It checks permission-deny callbacks and
source option/zoom/bounds behavior, not real windows. The12 dashboard IPC test
titles remain declaration-only. Full imported navigation/shortcut/validation
implementations are not accepted solely from the call sites above.

## G18 — browser identity and lease lifecycle

The identity argument reader takes the first exact-prefix stamp anywhere in
argv; absent/empty returns null. Preload guest-registration group reads its
own process.argv, not synchronous IPC. Renderer caches non-null answers only
and retries absent/throw results. The identity test expands to SIX cases,
not the worker's four declarations. Complete merged bridge/runtime behavior
still needs its own validation.

Attach snapshots/validates inventory and protocol dependencies before device
conflict/admission checks. Capacity is1 distinct host per connection and4 per
paired device, excluding the state being replaced. Active leases alone are
selectable. Reconnect v1 permits a15s default grace with positive-integer
override; legacy disconnect fences immediately.

Restore requires matching command/reconciliation negotiation and capability
arrays equal in LENGTH AND ORDER, not set equality. It preserves authority
epoch/generation, swaps connection token/fence, refreshes inventory from the
new attach (does not carry old inventory), and renegotiates file-channel
support independently. Active reattach fences old routes/detaches delivery.
Disconnect parks active current state, fences routes/reconciliation, and arms
expiry. Old handles cannot revoke replacement authority through stale tokens.
Final fencing removes current lease/grants/ledger and isolates per-page cleanup
errors; lease revocation is not a process-death verdict.

The authority-replacement classifier requires an Error with exact typed code
or exact legacy message, never a substring/plain-object match. Its45s wait
holds the first deadline while armed, cancels and can rearm; it merely invokes
an injected expiration callback. Neither helper proves guests are alive nor
itself performs environment retirement.14 classifier/timer assertion bodies
read, not executed; four selected registry cases read, not executed.18 other
registry titles remain pointers, not assertion acceptance.

## Placement and adoption: corrected guarantees

Preparation falls back to server only for disabled/server preference, non-ok
status RESPONSE, or eligibility false. Eligibility needs five declared
capabilities and non-mobile scope. Thrown status/start errors propagate.
Runtime identity, pairing drift and non-ready eligible graph reject. After
startHost, caught pairing/authority mismatch closes the host best-effort;
the preceding resolveEnvironment call is outside that cleanup try.

Adoption selects active predecessor entries belonging to this browser client,
with workspaceId present and no existing runtime page. It uses current
workspace execution keys, allocates increasing generations above inventory,
and emits no reclaimFrom. The restart plan may close/restore a guest at its
URL: tab continuity is NOT DOM continuity. Actual guest commands are not
executed by the candidacy/intent tests.

Grant settlement follows committed client placement/page generation and
absence of an existing grant, not the reconciliation promise alone. Partial
success retains placed-page grants even when reconciliation rejects. This
layer does not independently check every client/host identity; preserve
caller/registry fencing too.

## Runtime recovery — now read, not grep-only

Full runtime-browser-client-page-recovery.ts was read. Recovery requires
inventory/reconciliation negotiation; skips just-adopted/exact-active pages;
uses current-client generations for retained pages and paired-device identity
for restored records. It runs up to four operations. Abort prevents taking
new work, not cancellation of in-flight operations.

A missing route leaves a restored row held for later attach; a workspace-gone
result calls optional removal. Current-placement and inventory identities are
checked before close/retire/recreate. URL prefers current inventory. Failures
are page-scoped; only a page left with no placement is released. These are
source contracts, not executed recovery/DOM/persistence guarantees.

## Executed original evidence

Five unchanged isolated capsules passed47 cases, no failures/skips:
identity6, argument reader7, adoption candidacy/intents14, adoption grants8,
placement preparation12. Full runtime import closures were read and pinned.
Type-only dependencies are erased; no arbitrary source module was substituted.

Manifests: tests/parity/baseline-capsules/browser-*.json (exact five entries
listed in JSON.executedCapsules). Reports, stage receipts and raw results:
reference-captures/c9790628-<capsule id>/README.md and companion JSON files.
Original installed Vitest4.1.11, Node24.19.0, macOS arm64. Staged bytes match
source checkout and pinned Git blobs, with MIT notice preserved. No actual
app, window, network, profile, model, service or candidate launched by tests.
Total original baseline is198 distinct cases/20 capsules; full suite unproven.

## Owned remaining work

- WP-UI-SHELL-WIN / WP-UI-STATE / WP-UI-DASH: native reopen, monitor-detach,
  DPI, zoom, restart and persistent-store journeys. No grep proves absence.
- WP-ENG-BROWSER / WP-UI-BROWSER: real preload identity and host-versus-mirror
  rendering, full preparation/recovery failure and cancellation assertions,
  actual downstream restore, permission and grant lifecycle.
- WP-ENG-REMOTE: complete registry/reconciliation tests, contention, stale
  refusal, file-channel negotiation and both remote-runtime version skews.
  Direct SSH relay's build-locked channel is distinct from independently
  updated runtime peers; do not reuse an irrelevant skew claim.

No feature wave/hierarchy/install or goal closure. The two remaining wire
drafts require separate acceptance. Mentu upstream PR policy is unchanged.
