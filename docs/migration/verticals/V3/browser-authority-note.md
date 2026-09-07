# V3 browser-authority note

Vertical-03 (workspaces/remote) UI-side contract note for browser and
window-open authority. It records which decisions the renderer may make
locally, which require service/host authority, what the shipped types in
`apps/desktop/src/renderer/src/features/browser/` already enforce, and the
tests owed before real CDP mounting.

Normative source: `docs/migration/parity-window-browser-authority.md`
(G17 window placement and authority, G18 browser identity and lease
lifecycle), read against frozen source `c9790628…`. Conventions follow the
sibling `features/remote/` slice: injected interfaces only, no
Node/Electron imports, barrel `index.ts`, colocated vitest.

## Shipped V3 surface (pure TypeScript, renderer)

Files: `browser-tab.ts`, `browser-authority-source.ts`,
`browser-nav-state.ts`, `window-open-authority.ts`, `index.ts`.

- `BrowserTabDescriptor { tabId, url, title }` — exactly the identity the
  service projects; the renderer never constructs tabs for URLs it was
  not shown.
- `BrowserNavState` reducer over `idle | loading | ready | blocked |
  error` with actions `navigate-started / committed / failed /
  blocked-by-policy / retry-started / reset`. Every host event is fenced
  by BOTH the navigation `generation` and the `tabId`; fenced events are
  discarded by identity (state object returned unchanged).
  - `blocked-by-policy` is terminal for its request: the pane leaves the
    loading phase, so a late commit for the same generation is dropped
    and the URL can never render as loaded; no retry affordance is
    offered (policy will not change on retry), while a fresh navigation
    to an admissible URL simply takes a new generation.
  - Only a host commit for the current generation reaches `ready`, with
    the host-confirmed URL.
  - `failed` offers retry; `retry-started` works only from `error`.
- `runNavigate` and `requestWindowOpenDecision` are the exact pipelines
  the mounting component will use, exported for deferred-fake tests. Late
  decisions (superseded generation) are dropped before dispatch.
- `WindowOpenDecision { outcome: allow | block | open-in-system; reason }`.
  `classifyWindowOpenRequest` is renderer-local PRE-CLASSIFICATION for the
  request only and never proposes `allow` — the renderer cannot create
  windows, so `allow` exists in the vocabulary because the host may grant
  a host-managed window, not because the renderer may open one.

## Renderer-local vs service/host authority

Renderer may decide locally (display and proposal only):

- Which granted tab to show and how to render descriptors, state, policy
  reasons and error text (verbatim, never paraphrased into success).
- Scheme-level syntax checks and window-open pre-classification, as a
  proposal to the authority source (see classifier above).
- Offering a retry affordance when the reducer says `canRetry`, and
  re-issuing requests with a fresh generation.

Requires service/host authority (the renderer proposes, waits, renders):

- Navigation approval and commit. Only the host knows what actually
  loaded (redirects included); the renderer's `ready` state is reached
  exclusively through a host `committed` event for the current
  generation. Privileged-navigation policy is installed host-side;
  `blocked` is always the service's verdict, never a renderer guess.
- Window creation, placement, restore bounds and focus. Popouts mirror
  pages; they do not host them (separate partition, sandbox, no webviews,
  no browser-host identity stamp, permission handlers deny). `open-in-system`
  is executed by the host, never by renderer process spawning.
- Permission requests (geolocation, notifications, media, and the rest):
  host policy denies by default; the renderer only displays the denial.
- Browser-host identity: the host stamps its identity at creation; the
  renderer caches non-null answers only and retries absent/throw results
  (G18). It never fabricates an identity to unblock a flow.
- Lease lifecycle and admission: capacity (1 distinct host per connection,
  4 per paired device), active-lease selectability, reconnect grace
  (15s default) versus legacy immediate fencing, capability-array restore
  negotiation (length AND order, not set equality), authority epoch/
  generation preservation, and revocation. Revocation is not a
  process-death verdict — a fenced renderer shows unknown-until-proven
  state, mirroring the `unverifiable`/`exited` discipline of the remote
  vertical. Stale handles cannot revoke replacement authority through
  old tokens; the renderer must not honor stale fences either.
- Authority-replacement classification: exact typed code or exact legacy
  message, never substring/plain-object matching (G18).

## Owed-test list for real CDP mounting

These must exist against the real transport before the browser feature
ships. Items 1–3 have reducer/pipeline-level coverage here; the rest are
unproven at this layer.

1. Host navigation commit/fail events fence by generation and tab id; a
   late commit for a superseded navigation never marks ready (drive CDP
   frame events through the real bridge).
2. A policy-blocked URL never renders as loading or ready even when its
   commit event still arrives; the policy reason is displayed verbatim.
3. Error recovery: a failed navigation offers retry and a fresh commit
   completes it; retry is inert outside the error phase.
4. Permission requests are denied by host policy and rendered as denials;
   no renderer-local prompt is ever shown.
5. Window-open end-to-end: renderer proposal → host verdict; `allow`
   opens a host-managed window (popout mirror semantics), `open-in-system`
   is executed host-side; the renderer process performs neither.
6. Identity stamping: absent/throw answers are retried, only non-null
   answers cached; a null identity never downgrades into a guessed host.
7. Lease lifecycle: reconnect grace expiry vs legacy immediate fence;
   stale handles cannot revoke replacement authority; revocation renders
   unknown-until-proven state, never "process exited".
8. Restore negotiation: capability arrays must match in length and order;
   authority epoch/generation preserved; inventory refreshed from the new
   attach rather than carried over.
9. Renderer bundle purity: the feature module graph imports no
   Node/Electron builtin; backend contact only through the injected
   `BrowserAuthoritySource` (build-time lint or import test).

## Unverified / out of scope here

- No CDP, Electron window, or real service transport was exercised; the
  reducer/pipeline tests run against injected deferred fakes only.
- Window bounds/zoom/DPI journeys, dashboard popout IPC, and registry/
  reconciliation contention remain owned by WP-UI-SHELL-WIN /
  WP-UI-BROWSER / WP-ENG-BROWSER per the parity document's "Owned
  remaining work"; this note adds no wire format and closes no E4/E5 gate.
