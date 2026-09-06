# G9/G10 — diagnostic destinations and OS tray contracts

Coordinator source review at c97906287bb7a390b25e2025b600d9fb3c25d9c3.
Owners: WP-CAP-DIAG; WP-UI-SHELL-WIN + WP-ENG-INSTALL for tray.
These bounded source contracts supersede the corresponding old reading gaps,
not execution, packaging, security review or rendered acceptance obligations.

## G9: two different upload lanes

| Lane | Source routing | Consent/payload boundary observed |
| --- | --- | --- |
| Crash report with optional logs | submitCrashReport → submitFeedback → Electron net.fetch POST to the fixed upstream feedback URL in ipc/feedback.ts | Logs default enabled unless includeDiagnosticLogs is false, subject to bundleEnabled. submitAnonymously replaces login/email with null; main supplies version/platform metadata. |
| Reviewed support bundle | diagnostics:uploadBundle → uploadDiagnosticBundle → token request then NDJSON upload | Main retains collected payload; IPC receives an ID, not renderer-supplied bytes. bundleEnabled is checked before and after native confirmation; pending bundle is re-resolved after confirmation. |

The original feedback destination is `https://www.onorca.dev/v1/feedback`.
The official release-cut build injects
`https://www.onorca.dev/diagnostics/token` into the support-bundle lane.
These are **source provenance**, not destinations approved for Drogon.
Do not carry them into rewrite defaults or contact them in parity tests.
Fixtures must capture requests; a shipped Drogon destination needs its own
configuration/ownership and truthful UI consent language.

### Crash report path

- Missing requested report produces an uncaptured report; passing args without
  reportId deliberately does not pick up a newly pending report. Explicitly
  selected dismissed reports can still be sent.
- Concurrent submissions of a report ID are rejected. Recent successful IDs
  are held in an insertion-ordered set capped at256, refreshed on remembrance.
  Successful remote submission remains ok even if markSent/markDismissedSent
  persistence fails; in-session suppression avoids inviting an immediate resend.
  This is not proof of cross-restart or server-side idempotency.
- Crash logs request a three-day lookback from the collector when enabled.
  Collection errors and attachment failure reasons pass through string
  sanitization; this review does not prove the collector's complete redaction.
- Plain JSON requests have10s AbortController deadlines and retry once on
  thrown errors or HTTP>=500. Retry uses the same endpoint, not an alternate
  host. Multipart logs have60s; with a prepared report-only body they shed logs
  on400/403/404/408/413/415/422/>=500 or exceptions. Other failures stay failures.
  Report-only retry uses10s and retains attachment-failure metadata.
- Crash lane drops images. Public feedback:submit forces submissionType:feedback,
  so a renderer cannot choose the main-only crash lane through that channel.
  Feedback image handling is a separate feature, not certified by this review.

### Support-bundle destination and transport

- The observability composition root forwards upload/delete to the reviewed
  helper. Its consent resolver disables both lanes in CI or when diagnostics
  are disabled; DNT/telemetry-disabled leaves local logging on but blocks bundles.
  getDiagnosticsStatus uses cached initialization consent when present, so its
  IPC recheck is not proof of fresh environment-variable evaluation each time.
- stable/rc build identity pins the build-time token endpoint and ignores the
  runtime env override. A nonofficial build may use nonempty runtime
  ORCA_DIAGNOSTICS_TOKEN_URL; otherwise it falls back to the build value.
  Endpoint strings are not trimmed here; absence reports unconfigured.
- uploadBundle checks the local byte cap, then posts submission ID and byte
  count to the token endpoint. It validates token/upload_url/max_bytes types
  and the server cap; expires_at is declared but not validated here.
- Upload URL must use HTTP(S), retain HTTPS when the token endpoint is HTTPS,
  and have equal URL.host (including port). This is a host comparison, not
  an unconditional scheme+host+port same-origin comparison. HTTP development
  token endpoints may return HTTPS uploads when their host strings match.
- NDJSON POST carries bearer token, content type and byte length. The response
  needs a nonempty ticket_id. Deletion validates ticket format and posts to
  /diagnostics/delete/<ticket> on the configured token endpoint's origin.
- Token/delete transport uses10000ms; upload30000ms. The Node HTTP helper uses
  request timeout events, not a separate whole-operation AbortController timer.
  Do not claim an absolute end-to-end deadline from this source alone.
- HTTP response buffering is capped at1MiB; success parses JSON (empty→{}).
  Non-2xx exposes status without the response body; network errors are generic.
  Request/response listeners are removed on settlement. URL/token validation,
  real TLS/network behavior and server policy remain execution obligations.

## G10: explicit per-OS tray behavior

Read the complete system-tray.ts implementation. Linux returns null before
creation: it is explicitly unsupported in this source, **not a missing Linux
tray asset inferred from a file search**. New Linux tray support would be a
separate enhancement, not necessary to reproduce this original behavior.

- macOS loads the Drogon1x template PNG and explicitly adds the2x representation.
  Invalid1x returns null; a missing/bad2x warns and retains1x. Imports request
  asset&asarUnpack; that is intended bundling, not inspected package contents.
- Windows normalizes the selected app-icon ID (classic/watercolor/blue,
  unknown→classic), loads that icon and resizes it to16x16. It does not use a
  separate tray PNG. Classic uses the dev asset in dev builds.
- Creation reuses an existing nondestroyed tray. Windows provides Open/Quit
  and left-click open; macOS adds Settings/Check for Updates and relies on
  the attached menu. Callbacks catch synchronous errors; async rejections are
  not independently handled by the wrapper's void contract.
- macOS visibility toggles create/destroy without clearing attention state.
  Attention is recorded synchronously, repaint deferred to a fresh timer turn
  and bursts coalesced. A theme update repaints active attention; Retina gets
  a rebuilt representation. macOS composition failure falls back to the
  template. That catch is not present around the Windows composition branch.
- DEV markers identify dev instances; macOS stamps the glyph with a rebuilt
  Retina representation, Windows marks the tooltip. Destruction removes the
  appearance listener and native tray, retaining attention for a later show.
- Existing fallback strings still include Orca in translated menu/attention
  calls. Do not treat a Drogon base tooltip as full branding closure. The
  separate full-brand-review requirement must cover localized and fallback text.

## Evidence tiers, tests and remaining work

Read four assertion bodies at system-tray.test.ts:194–276: Windows menu/click,
macOS menu/template/Retina, invalid1x asset and idempotence/Linux null. The
other22 declaration titles were located only; no tray tests executed and no
actual OS tray/package viewed. Port complete original assertions, including
attention/theme/dev/repaint/teardown, then validate native rendered behavior.

Executed the unchanged diagnostic-upload-http two-file capsule: **2 pass,
0 fail,0 skipped**, original Vitest4.1.11/Node24.19.0. Both HTTP transports
are mocked; cases prove listener cleanup after successful JSON and oversized
response rejection, not actual uploads/consent/endpoint selection. Evidence:
reference-captures/c9790628-diagnostic-http. Cumulative isolated original
baseline is118 distinct cases across13 capsules, not full-suite or rewrite parity.

Source fingerprints and precise read bounds are in the JSON companion.
No original source edits, uploads, credentials, live session stops or product
installation occurred. Full consent/collector redaction, server acceptance,
packaged assets, OS execution and candidate parity remain required.
