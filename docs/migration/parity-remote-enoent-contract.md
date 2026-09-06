# G20 — remote missing-path classification

Coordinator source review at frozen revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`. This documents an existing
compatibility obligation, not a new protocol implementation or full E5 closure.

## Observed path

1. Host `src/relay/dispatcher-rpc-routing.ts:133-165` preserves the message,
   keeps a numeric error code, otherwise substitutes `-32000`. Its structured
   `data` allowlist validates skill-install and terminal-unavailable shapes;
   it does not generically preserve Node string errno in this catch path.
2. Desktop `src/main/ssh/ssh-channel-multiplexer.ts:518-531` reconstructs an
   `Error`, attaches the received transport `code` and `data`, then rejects the
   pending request after cleanup. The type in
   `src/main/ssh/relay-protocol.ts:103-108` declares a numeric code. This review
   does not establish the same transformation in every transport/direction.
3. `src/main/ipc/filesystem-path-containment.ts:24-44` recognizes only Error
   instances: string `.code === 'ENOENT'` OR the canonical phrase
   `ENOENT: no such file or directory` with word boundaries in the message.
   Numeric transport codes and IPC message prefixes therefore remain usable.
   This is phrase matching, not a structured-errno guarantee. A mere mention
   of ENOENT is insufficient; an Error with the full phrase can match even
   without a matching string code. The source explicitly accepts this tradeoff
   for an already trusted execution host; do not market it as spoof-proof.
4. `src/main/ipc/worktree-remote.ts:983-999` returns false if no stat provider,
   true after a successful stat, false for isENOENT, and rethrows other errors.
   These path-existence booleans are NOT process liveness verdicts.

The original remote-wire guide identifies this as known cross-version debt.
An additive original-string-errno field is a suggested future extension, not
present behavior established here. A future change must retain compatibility
with old hosts that omit it; dropping the existing phrase fallback would
regress those hosts. Client-to-host and host-to-client tests remain owed.

## Executed original baseline

`tests/parity/baseline-capsules/remote-enoent-classification.json` preserves
both exact source files and the MIT license. Node24.19.0 / original installed
Vitest4.1.11 executed the unchanged seven direct test cases: **7 pass, 0 fail,
0 skipped**, one actual test file. Cases cover local code, numeric relay code,
IPC prefix, no code, permission-denied, word-only mentions and non-errors.

These tests construct error objects in memory. They do not execute the relay,
IPC, filesystem stat, real SSH, worktree creation or any candidate Rust code.
The test and module were fully read before execution; other path operations
exported by the module are not called. No model or personal app is involved.
Config/setup differences are disclosed in the manifest and receipt.

Evidence: `reference-captures/c9790628-remote-enoent/`. Full original and staged
file hashes and all seven assertion results were checked independently. This
extends the prior75-case isolated original baseline to82 cases in6 capsules;
it is not full-suite acceptance or candidate RED→GREEN.

## Source fingerprints and review bounds

| Source-relative file | SHA-256 | Read bound |
| --- | --- | --- |
| `src/main/ipc/filesystem-path-containment.ts` | `f2a6d09644d78129b595715a0e760a565512aab5b6b075b748556e2fa92af2b2` | Complete |
| `src/main/ipc/filesystem-path-containment-remote-enoent.test.ts` | `8634d5d377bd7b0c066174ac51b2d12dec613bf5e261c61297098a8155aa9ce2` | Complete; executed unchanged |
| `src/relay/dispatcher-rpc-routing.ts` | `c11b3ff9096bd4877bba0ebc8a70a63092a00015fde3d8f81f3b8fb54087479b` | Relevant request/error blocks, not all notification paths |
| `src/main/ssh/ssh-channel-multiplexer.ts` | `480c722b27dd1ffb8c70bfca8fb3568294ff2777b7b02607548df93bb280f6ae` | Imports and request/response blocks, not full class |
| `src/main/ssh/relay-protocol.ts` | `644aa6f2087b5867d41006bfdcec78ffba693157a2912feb8f82b120f5647b34` | JSON-RPC type section only |
| `src/main/ipc/worktree-remote.ts` | `f0b74fbd8f5c8c5c9c3d2ba4f9ed0e0d1d3f6f6d808d79fce4328e130dbfa828` | remotePathExists body only |
| `docs/reference/remote-wire-compatibility.md` | `1259e994b5986bad07ac4ae2e8b7111955d66f8dd33f197156ff33ce09e2706c` | Complete guide |

Owners: WP-ENG-REMOTE for wire preservation/mixed-version execution;
WP-ENG-IPC for equivalent classification and path-existence caller behavior.
Remaining obligations include actual transport reconstruction, unexpected
errors and both version skews; this capsule alone cannot discharge them.
