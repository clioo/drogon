# Relay boundary review after e0a1491

Bounded coordinator review of source c97906287bb7a390b25e2025b600d9fb3c25d9c3, with 19 fingerprints independently matching checkout and pinned Git blobs. Read tiers are explicit in the accompanying JSON. **Audit remains open; candidate parity is unproven.** Mentu Navigator status succeeded; source remained read-only.

## Corrections to the leaf report

- `session.registerRoot` request returns `{ok:true}`; `relay.configureGraceTime` returns `{graceTimeMs:number}`. Both support notifications, but sharing two transport lanes does not imply the same result schema. Evidence: relay-runtime-services.ts:121–135 and relay-grace-lifecycle.ts:33–38,142–152.
- AiVaultHandler soft-disables only when the platform is unsupported or the service is absent. RelayRuntimeServices:79 calls the service factory without a catch; the factory constructs RelayAiVaultServiceClient. The client's constructor initializes restart policy rather than starting a process. Missing-service handling must not be described as arbitrary constructor-failure tolerance or later process-startup-failure behavior. The latter still needs separate tracing/tests.

The original147-site map and process-specific counts are unchanged. These corrections do not accept every registered method's behavior or the complete daemon/guest composition.

## Cancellation is a delivery contract, not a process-exit verdict

`ssh-pty-consumer-session-adapter.ts:38–43` publishes `pty.deliveryCanceled` on the control lane. It is an outbound notification, not an additional request registration. `pty-source-credit-record.ts:246–261` constructs the proof: full delivery identity, reason, sent/credited offsets, remaining interval [credited,sent], and an optional replacement token. Identity includes id, provider/client/owner generations, PTY incarnation and delivery token.

The source-credit adapter publishes a superseded proof during rotation and publishes through cancelExact for a known nonclosed delivery, including detach/grace expiry. In contrast, explicit cancel returns a compact `{canceled:true,sentEndSu,creditedEndSu}` result without this unsolicited notification. Recent owned proofs support idempotent retries while retained in the256-entry index; this is bounded retention, not permanent idempotency.

The desktop listener in `ssh-relay-session.ts:2181–2250` first fences the current multiplexer and id/token/client-generation/owner-generation/incarnation. During pending recovery it either records a replacement token or requires restore for absent, same or conflicting tokens. Outside recovery it checks safe integer offsets and uses the active **local** provider generation when applying the proof; it does not directly compare the wire provider generation. Thrown proof errors retain identity.

One lifecycle question remains explicit: the registry and obligation layer can return false when intake or a matching obligation is missing, while this listener ignores the return value and retires the token. That source observation needs a reproducible lifecycle test before calling it a defect or changing it. The deeper credit coordinator and publication settlement are not accepted by this review.

Retiring a delivery must never become evidence that its remote process exited. The execution host owns that verdict; a lost connection remains unverifiable. No real terminal, SSH connection or delivery was canceled for this audit.

## Original filesystem baseline

[Twelve original cases passed](reference-captures/c9790628-wsl-hook-fs-bridge/README.md), zero failed/skipped/todo, using Node24.19.0 and the original installed Vitest4.1.11 on macOS arm64. Test and runtime closure bytes were staged unchanged with the original MIT license, and matched the frozen checkout and Git revision.

This is real temporary-filesystem behavior with a fake registration collector, not a pure-function capsule. The generic runner disclaimer is overbroad on that point; its raw output is preserved and the evidence README corrects its applicability. The closure does not start WSL, relay, network, model or home-configuration activity.

Covered: home and link status, file round-trip, missing file, traversal/sibling/relative-path refusals, read-only ancestor probes, cross-boundary rename refusal, mkdir and invalid chmod. Still untested here: successful rename/unlink/chmod/stat handlers, complete method set, symlink behavior, actual Windows host/Linux guest, transport and candidate implementation. The lexical home rule intentionally follows symlinks and is not a security sandbox.

## Next acceptance work

Keep the full rewrite scope: finish relay handler authority/composition, guest manager lifecycle and distribution review; retain whole-suite ports and behavioral RED/GREEN gates. Do not use this baseline as permission to close the audit or start nested product workers. During implementation, retain the approved Mentu upstream route: reproducible gap, minimal justified English PR, regression evidence and pinned local verification without waiting for merge. No Mentu gap was established by this relay slice.
