# G13/G14/G19 — relay, mobile and agentWait review

Machine record: `parity-relay-mobile-wire-contracts.json` v2.
Source c97906287bb7a390b25e2025b600d9fb3c25d9c3, read-only.
Coordinator base2cc40e3. **Partial coordinator review; runtime acceptance unproven.**

G19's bounded host/worker/federation source transformations are reviewed.
G13 framing/routing is reviewed with16 original isolated protocol cases.
G13 method composition and G14 mobile census remain pending independent
acceptance. This distinction supersedes the original leaf's broad read-tier
label. All61 fingerprints match both checkout bytes and pinned Git blobs;
21 full-body reads plus one partial type read are identified in JSON.
Hashing the other files is not reading their behavior.

## G13 — separate relay namespace and framing

The615 runtime RPC names and975 preload channels are different surfaces.
The leaf's relay dictionary has133 request keys,12 inbound and12 outbound
notification keys. Arithmetic verified, not registration completeness.
Request prefixes are fs25 and git43 (correcting leaf29/41), pty21,skills11,
workspace3,wslfs9, plus the other groups retained in JSON.

Request and notification handlers use separate Maps. Requests may replace
an existing handler; notifications reject duplicate registration.
rpc.cancel bypasses the notification map, scoped by client and request ID.
Dual-registered relay.configureGraceTime and session.registerRoot are
two inbound message kinds, not opposite directions. pty.data really is
bidirectional, with different meaning at each end.

The source relay codec is NOT shared/terminal-stream-protocol.ts:

| Header | Offset | Representation |
| --- | ---: | --- |
| Type | 0 | one byte: Regular1, Handshake2, KeepAlive9 in relay |
| Sequence ID | 1 | uint32 big-endian |
| Acknowledgement | 5 | uint32 big-endian |
| Payload length | 9 | uint32 big-endian |

The13-byte envelope carries JSON-RPC for Regular frames. Dispatcher updates
contact/highest received sequence before handling Regular or KeepAlive;
unknown types are not negotiated terminal-stream opcodes. The runtime
SetOutputPaused16 example must not be copied into this relay inventory.
Desktop main's protocol lists Regular1/KeepAlive9; its shared decoder still
frames numeric types. Handshake belongs to a separate pre-dispatch path.

JSON-RPC parsing checks version2.0, not the entire message schema. Handshake
parsing recognizes three envelope kinds; daemon acceptance separately checks
exact launchVersion and optional endpoint credential. readLaunchVersion reads
.version beside the resolved entry path, falling back to RELAY_VERSION.
Source-documented build-locked relay deployment and semantic runtime-version
compatibility are different obligations. No live authentication/handshake run.

Decoder defaults:16MiB maximum payload; retained input16MiB+13+1MiB;
64frames,16MiB+13bytes,4ms per turn. Oversized bodies are incrementally
discarded; retained-input overflow resets. Partial frames keep reads active.
Continuation failures are contained/reset/reported as typed errors; synchronous
callback failures are not covered by that containment. Reset/drain revoke
scheduled continuation ownership. Full decoder and frame-buffer bodies read.

Request routing returns -32601 for missing methods, ignores unregistered
notifications and fences responses by client generation/membership/abort.
Response settlement is one-shot; callback errors are contained. Errors
preserve numeric code or use -32000, with structured data allowed only for
validated skill-install/terminal-unavailable shapes. A capacity rejection
substitutes -33008 for that request, not a successful original result; rejecting
the substitute leaves the client connected and lets the request time out.
These dispatcher bodies were read, not executed.

Still pending: independently reconcile registration/constructor composition,
dynamic plugin-manifest names and resync marker state.method origins, outbound
publication paths, client parameter/error pairing and auth/lifecycle journeys.
The leaf lists remain available as pointers; diffing unrelated method names
would not discharge these obligations.

## Original protocol baseline executed

| Unchanged original suite | Cases passed |
| --- | ---: |
| protocol-handshake.test.ts | 5 |
| protocol-json-payload.test.ts | 2 |
| protocol-backpressure.test.ts | 9 |

Original Vitest4.1.11 / Node24.19.0, macOS arm64; each one actual test file,
zero failure/skip/todo/timeout. Complete executed imports read before staging;
exact pinned bytes, existing assertions and MIT license preserved.
Raw results/receipts are in the three reference-captures/c9790628-relay-protocol-*
directories; manifests under tests/parity/baseline-capsules.

Tests cover envelope round trips, unknown handshake kind, prepared/direct
byte equality on both codecs (Unicode/header limits), exact payload maximum,
bounded decoder turns, pause/resume, scheduling failure, typed continuation
failure, oversized-body resynchronization and reset/drain cancellation.
No real socket, SSH, daemon, mobile, models or user profiles used by tested code.
These are not full-dispatcher, candidate or mixed-version results.

## G14 — leaf mobile census still pending

The156 distinct mobile outgoing sendRequest/subscribe literal names and seven
subscription names remain leaf scan results. They do not supersede the15-method
desktop mobile bridge, which is a different hop. The original regex and full
lists remain in JSON, including limitations: single quotes and restricted
characters, no type-checked receiver/constant/template resolution, no individual
mobile callsite fingerprints. Name uniqueness is not file count or completeness.

Next: independently enumerate actual calls (including generics/nonliteral args),
bind file/line/hash evidence, then read mobile binary adapters and pairing,
capability/revocation/reconnect paths in both version directions. No mobile
acceptance or execution is claimed by the relay tests.

## G19 — reviewed three-state transformation

Producer: orca-runtime-get-terminal-interactive-wait.ts, full body read.

1. Pane/PTY snapshot lookup failure returns undefined. That catch does not
   blanket-catch every later resolver error.
2. Authoritative prompt-text wins first (since when waitBlockedAt is not null);
   then a live permission title.
3. explicitStatus?.status not permission returns null, including no explicit
   status. With no prompt/title evidence, no agent probe is launched here.
4. Otherwise await the shared PTY probe under timeout. Missing result includes
   timeout, resolved undefined or caught agent-status rejection: unknown.
5. A running agent with permission produces hook/since from fresh explicit
   status; other answered status produces null.

Probe promises are shared per PTY, catch rejection to undefined, and clear
only their own map entry on settlement. A caller timeout does not cancel or
evict the shared in-flight probe.

Both showTerminal branches conditionally emit a non-undefined field.
Internal worker and remote-attachment observations use shorthand agentWait,
so they may have a JavaScript property whose value is undefined; the public
workerShow/contextOnly/federationShow projections conditionally omit it.
Do not confuse internal own-property presence with the serialized contract.

Unattached, missing and identity-changed observations return before copying
the wait. Exact process identity gates attribution. Wait state is independent
of liveness; an exact unverifiable worker can carry the terminal's wait value.
Local liveness fallback uses connected only when the authoritative verdict did
not return live/unverifiable; that provider/host authority remains a separate
execution obligation, not universal liveness proof from a boolean.

FederationShow requires the matching home peer fingerprint. Federated workerShow
spreads the remote observation without coercing missing wait to null, and only
normalizes legacy status running to live. The response is a typed cast, not a
new runtime schema validation at that helper.

CLI formatting reuses the accepted terminal-contract register. Coordinator
literal search found no agentWait in non-test renderer/mobile source; that is
a bounded scan, not proof that no generic UI could receive the field.

Correct skew direction: NEW client + OLD host means absent/unknown; OLD client
+ NEW host ignores the new present key. Neither has been executed against a
real older build. The documented terminal/agent-session cross-version harness
is not evidence of agentWait coverage.

Four complete original worker-interactive-wait assertion bodies were read,
NOT RUN: pending prompt, explicit null during long tool call, changed identity
omits key, and terminal/observation agreement with populated shape first.
Their full runtime/native DB closure has not been staged; no new mocks were
used to claim these original integration tests pass.

## Remaining ownership

G13: WP-ENG-RELAY / WP-ENG-REMOTE, composition/auth/transport journeys.
G14: WP-CAP-MOBILE / WP-ENG-REMOTE, census/adapters/pairing/skews.
G19: WP-ENG-HARNESS / WP-ENG-CLI / WP-ENG-IPC, runtime tests and actual skews.
All original test obligations remain. This bounded review does not close the
audit, accept the rewritten product, or authorize a feature wave.
