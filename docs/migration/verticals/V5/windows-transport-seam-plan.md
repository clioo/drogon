# V5 — Windows native transport/auth/same-user/lifecycle seam plan

Doc-first leaf task, no code edits. Read-only source reference:
`/Users/carlos/Documents/Drogon-mentu-session`, frozen commit
`c97906287bb7a390b25e2025b600d9fb3c25d9c3` (per `five-vertical-handoff.md`). No
test, script or process was run against that directory; every claim below is
from reading its files, never executing them. No file outside this document
was edited by this task.

## 0. Ownership boundary (why this is a seam, not a V5 implementation)

Per `docs/migration/five-vertical-handoff.md` §5 ("Propiedad común"):

> V5: `scripts/package-*`, `scripts/install-preview.mjs`,
> `scripts/desktop-artifacts*`, `scripts/preview-install-lock*`, herramientas y
> runners de aceptación/build; `apps/desktop/src/main/build-info*`,
> `daemon-path*`, `native-runtime-bootstrap*`. **El cliente nativo de main y
> transporte/auth son V1**; ventana/UX de main es V2.

So `apps/desktop/src/main/native-client.ts` — the transport (`callNative`,
`resolveEndpointPath`, `observeLocalEndpoint`, `validateEnvelope`) and the
auth-token read — is **V1-owned**, not V5. V5 owns only the bootstrap/lifecycle
decision layer (`native-runtime-bootstrap.ts` + its test) and `daemon-path.ts`,
which *consume* `native-client.ts`'s exports (`LocalEndpointObservation`,
`observeLocalEndpoint`, `resolveEndpointPath`) as `BootstrapDeps`. This
document is written from that consumer's vantage point: it characterizes the
source Windows seam, then states what V5's bootstrap layer needs from V1's
transport layer as a bounded contract request, per the handoff's own escalation
rule ("Si una interfaz falta: abrir una petición acotada con forma, consumidor,
error y test").

## 1. Source baseline: Windows native transport/auth/same-user/lifecycle

### 1.1 Transport shape

`src/main/runtime/rpc/unix-socket-transport.ts`'s `UnixSocketTransport` is the
*only* transport class for both POSIX and Windows; it takes a `kind: 'unix' |
'named-pipe'` and calls `node:net`'s `createServer`/`.listen(endpoint)`
identically for both — Node's `net` module treats a `\\.\pipe\...` path as a
named pipe transparently. Framing (newline-delimited JSON), the 1 MiB max
message, the 32-connection cap, and the 30s idle timeout are all
platform-agnostic; the only platform branch in that file is `chmodSync(...,
0o600)`, gated `if (this.kind === 'unix')` — **named pipes get no equivalent
hardening call**, because Windows named pipes have no `chmod`.

`src/main/runtime/runtime-rpc/runtime-rpc-socket-metadata.ts`'s
`createRuntimeTransportMetadata` picks the endpoint:

```
win32:  kind: 'named-pipe', endpoint: `\\.\pipe\orca-${pid}-${endpointSuffix}`
other:  kind: 'unix',       endpoint: `${userDataPath}/o-${pid}-${suffix}.sock`
```

The comment is explicit about the security model this implies: *"named pipes
lack the chmod hardening of Unix sockets; a per-runtime suffix avoids a stable,
guessable endpoint name."* I.e. source's Windows same-endpoint-instance
protection is **obscurity of the pipe name** (pid + random suffix), not an
ACL/`SECURITY_ATTRIBUTES` on the pipe object. ROOT sharpening (2026-09-07):
an obscure/unguessable pipe name is **never same-user proof** — it only
resists discovery; it authenticates nothing about the connecting process.
No file read in this task sets a
`SECURITY_DESCRIPTOR`, calls `GetNamedPipeClientProcessId`, or otherwise
authenticates the connecting process/session on the pipe itself.

### 1.2 Auth

`src/main/runtime/runtime-rpc/runtime-rpc-request-admission.ts:10` states the
model directly: *"Unix socket dispatch is one-shot and auths via the shared
token from the 0o600 metadata file."* Every request must carry `authToken`
matching the server's in-memory token (`request-admission.ts:128-132`); the
token itself is read from a metadata file whose Unix protection is the same
`chmod 0o600` noted above. On Windows that file-level protection is whatever
NTFS ACLs the user-profile directory already has (not something this code
sets), so same-user isolation for the token file is inherited from the OS
default, not asserted in-repo.

### 1.2.1 In-repo descriptor/token facts (this repo's actual stack)

Verified 2026-09-07 by reading this repo's code (task E, read-only; no
implementation change). These are facts about what the rewrite itself
enforces today:

- **Server:** the RPC server is Rust `drogond`, not Node. Its endpoint module
  is `#![cfg(unix)]` (`crates/drogond/src/endpoint.rs:12`; header: *"Windows
  named pipes are a different mechanism entirely and are not implemented
  here"*), and `serve()` itself is `#[cfg(unix)]` with
  `ServeError::UnsupportedPlatform` otherwise (`crates/drogond/src/lib.rs:22,30,51-52`).
  On POSIX it sets the listening socket file to **0o600 before hard-linking**
  (endpoint.rs:88-91), citing protocol-v1: socket restricted to the owning
  user, matching the data directory **0o700** (`crates/drogond/src/lib.rs:56-57`)
  and token file **0o600** (`crates/drogond/src/auth.rs:30`).
- **Token file:** `ensure_token` writes a fresh token via `create_new` on a
  scratch name + rename, with the **0o600 `set_permissions` call inside
  `#[cfg(unix)]`** (auth.rs:27-31) — so it is a POSIX-only fact, not a
  Windows guarantee. Token minting itself is `#[cfg(not(unix))] → Unsupported`
  ("token generation is not implemented on this platform yet", auth.rs:47-53):
  on Windows this repo mints **no token at all** today and attempts no
  chmod-equivalent.
- **Windows pipe client (CLI):** `crates/drogon-cli/src/transport.rs:95-103`
  opens `Endpoint::NamedPipe` via
  `tokio::net::windows::named_pipe::ClientOptions::new().open(name)` —
  defaults only, no security/QoS override; a client cannot grant itself
  rights anyway, the DACL lives on the server's pipe object, and no Windows
  server exists in this repo. The deterministic name
  `\\.\pipe\drogon-v1-{sha256(canonical data dir)[0..24]}` is set in
  `crates/drogon-cli/src/paths.rs:93-101` (contract-stability tested).
- **Node side (desktop main, V1-owned `native-client.ts`):** production Node
  code is **client-only** (`createConnection`); `node:net`'s `createServer`
  appears only as a POSIX test fixture (`native-runtime-bootstrap.test.ts:1`).
  So there is no production `node:net` server in this repo whose defaults
  would need hardening — and the Node client validates nothing about the
  endpoint: win32 resolves the same deterministic pipe name
  (`native-client.ts:73-74`), `observeLocalEndpoint` short-circuits win32 to
  unconditional `ambiguous` (:108-112), and `auth.token` is read via plain
  `readFile` with **no mode/ACL validation** (:317).

**Conclusion (fact, not change):** the only same-user enforcement anywhere in
this repo is POSIX file modes (0700 data dir / 0600 socket / 0600 token).
On Windows, in-repo code enforces **no descriptor** on any pipe object and
**no token-file protection**; once the unsupported gates lift, same-user
would be entirely unproven unless V1 adds an explicit mechanism.

### 1.3 Same-user / identity resolution primitives that *do* exist

`src/main/win32-utils.ts` resolves the current Windows identity for a
different purpose — granting directory ACLs, not gating the RPC pipe — via
`whoami /user /fo csv /nh`, parsing the SID out of CSV, with absolute
`%SystemRoot%\System32\...` paths for `icacls.exe`/`whoami.exe`/`reg.exe`
because *"Electron's main process may have a stripped PATH that excludes
System32."* This SID-resolution + `icacls` pattern is real Windows prior art
for a same-user check, but every call site found (`grantDirAcl`,
`grantDirAclAsync`, `windows-install-dir-acl-probe.ts`) applies it to
**directories** (Chromium `userData`, the install tree for crash-signature
diagnosis), never to the RPC named pipe.

### 1.4 Lifecycle / endpoint ownership

`src/main/daemon/daemon-endpoint-ownership.ts` is the POSIX ownership
protocol: bind privately, `link()` (not `rename`) onto the canonical path so a
losing race gets `EEXIST` rather than silently clobbering a live daemon, prove
the incumbent dead via a real connect probe before ever replacing it, and
re-verify after replacing that the name wasn't stolen back — all keyed on
`dev`+`ino` identity of the socket's directory entry. Every one of those
functions has an explicit, one-line win32 exit:

- `publishDaemonEndpoint`: `if (process.platform === 'win32') return {
  status: 'published', identity: null }` — comment: *"Named pipes are
  exclusive by name and vanish with the process; listen is the whole
  protocol."*
- `readDaemonSocketIdentity` / `readDaemonEndpointEntryIdentity`: return
  `null` on win32 (no `dev`/`ino` equivalent for a pipe).
- `readDaemonEndpointOwnershipState`: returns `'indeterminate'` (never
  `'lost'`) on win32 — a named pipe has no directory entry to stat, so absence
  of proof is never treated as proof of loss.

`daemon-endpoint-windows.test.ts`'s own header comment is the load-bearing
caveat: *"Every other endpoint test is skipIf(win32), so these paths had no
coverage anywhere: on POSIX they are skipped by the guard, and **PR CI never
runs the suite on Windows at all**."* The win32 branches are unit-tested with
mocked `fs`/platform overrides on a non-Windows CI runner — proving the
*decision logic* is inert on Windows, never that a real named pipe behaves as
assumed.

### 1.5 EDR posture (Windows-specific operational risk for any spawn/lifecycle work)

`docs/reference/windows-edr-posture.md`: a real enterprise tenant opened six
Microsoft Defender for Endpoint **behavioral** incidents against a signed
build in eight days, none of them signature hits. The two clusters directly
relevant to a native-transport/lifecycle seam:

- **Spawn cluster (all six incidents):** `Orca.exe → orca-terminal-daemon.exe
  → powershell.exe/cmd.exe/reg.exe → <agent CLI>`. The daemon runs from a
  *renamed copy* of the signed image (`daemon-host-relocation.ts`) specifically
  so the installer's `taskkill /IM Orca.exe` can't reap it across an update —
  which is exactly EDR's masquerading signature (MITRE T1036).
- **Update cluster:** an unsigned `old-uninstaller.exe` fired independently.

Guidance the doc gives that transfers directly to a Windows `drogond` spawn
path: shorten the interpreter chain, never spell `-EncodedCommand` or
`-ExecutionPolicy Bypass` on a command line, and expect that AV path
exclusions do **not** suppress these — only a scoped MDE alert-suppression
rule does. None of this is about the pipe transport itself, but any V5-side
lifecycle change that adds a Windows daemon spawn (`spawnDetachedDaemon`'s
win32 path, not yet implemented in this repo) inherits this exact signal
surface.

### 1.6 WSL note (pattern relevant to the existing `LocalEndpointObservation` design)

`docs/reference/wsl-probe-failure-semantics.md` documents a recurring source
bug class: collapsing "the probe failed to answer" into "the answer is no" (a
bare `catch { return false }`), which becomes user-visible once the result is
cached or gates discovery. This repo's `LocalEndpointObservation` (in
`native-client.ts`, V1-owned) already avoids exactly this failure mode — it is
a three-way `absent | present | ambiguous`, and every non-`ENOENT`/
`ECONNREFUSED` connect error, including probe timeout, is `ambiguous`, never
collapsed to `absent`. Recorded here as a validated design choice against a
real source bug class, not a gap.

### 1.7 Linux glibc floor (contrast requested by the task)

`config/scripts/verify-linux-glibc-floor.cjs`: `MIN_GLIBC = [2, 31]` (Ubuntu
20.04), because v1.4.150 shipped a Linux build whose `node-pty` needed
`GLIBC_2.34` (glibc's libutil/libpthread merge relocated `openpty`/`forkpty`
into libc) and crashed at startup on 20.04 after a build-runner glibc bump. The
gate `objdump -p`s every bundled native binary's `.gnu.version_r` and fails
packaging if any `GLIBC_`/`GLIBCXX_`/`CXXABI_` version-need exceeds the floor
(with a documented, narrow exemption for the lazily-loaded `sherpa-onnx`
speech prebuilt). **Contrast with Windows:** there is no equivalent
"shared-library ABI floor" gate for Windows in source — Windows compatibility
risk in this codebase is EDR/ACL/pipe-naming-shaped, not symbol-versioning-
shaped. A Windows seam plan should not expect (and does not need) a glibc-style
floor check; it needs the ACL/auth/EDR posture covered above instead.

## 2. V5-side vs. V1-side seam responsibilities — bounded contract request

Current state in this repo (`apps/desktop/src/main/`):

- `native-runtime-bootstrap.ts` (V5): pure decision core, fully platform-
  injected (`BootstrapDeps.platform`), already gates Windows explicitly —
  `if (deps.platform === "win32") return { kind: "unsupported-platform" }`
  (comment: *"`drogond` has no Windows named-pipe implementation; spawning it
  there would only fail"*). This gate is correct **today** and needs no change
  until V1 ships a real Windows `drogond`.
- `daemon-path.ts` (V5): builds `PATH` fallback for the spawned daemon; its
  win32 branch is `fallbacks = []` — no PATH augmentation at all on Windows,
  unlike the POSIX branch's nine-entry fallback list. Source's analogous
  problem (Electron's stripped PATH missing `System32`) was solved by
  `win32-utils.ts` via **absolute exe paths**, not a `PATH` fallback list — a
  different technique `daemon-path.ts` doesn't currently use. Whether Windows
  ever needs a `PATH` fallback (e.g. a harness installed under a user-scoped
  `winget`/`scoop` bin) is unanswered by source reading and is called out as
  an open question in §4, not assumed either way.
- `native-client.ts` (V1): owns `resolveEndpointPath`'s win32 branch —
  `` `\\.\pipe\drogon-v1-${sha256(dataDir).slice(0,24)}` `` — a name
  **deterministic** in the data directory, unlike source's per-**pid** random
  suffix. It also owns `observeLocalEndpoint`, which currently short-circuits
  Windows unconditionally: `if (platform === "win32") return { kind:
  "ambiguous", reason: "unsupported-platform" }` (native-client.ts:108-112).

Because `observeLocalEndpoint`'s Windows branch is a hardcoded `ambiguous` and
`bootstrapNativeRuntime`'s Windows branch is a hardcoded `unsupported-
platform`, **V5's bootstrap layer cannot exercise, or write a real test for,
any Windows lifecycle path until V1 defines the actual transport contract.**
This is the bounded request:

- **Shape:** Confirm whether `resolveEndpointPath`'s deterministic
  `drogon-v1-{hash(dataDir)}` pipe name is the final wire contract for a
  Windows `drogond`, and state what same-user protection (if any) replaces
  source's "random suffix as obscurity" — which was never same-user proof
  either (§1.1): an explicit pipe
  `SECURITY_ATTRIBUTES`/DACL restricting to the creating user's SID (resolvable
  via the same `whoami /user` SID pattern `win32-utils.ts` already uses for
  directory ACLs), continued reliance on the auth-token file alone, or both.
- **Consumer:** `native-runtime-bootstrap.ts`'s `BootstrapDeps.observeLocalEndpoint`
  and `checkStatus` (V5), which currently receive a synthetic `ambiguous` /
  `unverifiable` for every Windows call and therefore never spawn — once V1
  ships a real endpoint, V5 needs to know whether the `win32 →
  unsupported-platform` gates in both `native-client.ts` and
  `native-runtime-bootstrap.ts` should be lifted together, and whether any
  `BootstrapDeps` shape changes (e.g. a Windows-specific probe timeout, given
  named-pipe connect semantics can differ from Unix-socket `ECONNREFUSED`
  timing).
- **Errors:** State the Node error codes a real Windows named-pipe connect
  failure surfaces through `net.createConnection` (`ERROR_FILE_NOT_FOUND` /
  `ERROR_PIPE_BUSY` map to which `NodeJS.ErrnoException.code`?) so
  `observeLocalEndpoint`'s absent/present/ambiguous classification — currently
  keyed only on POSIX's `ENOENT`/`ECONNREFUSED` — gets a correct Windows
  branch instead of the current unconditional `ambiguous`.
- **Test:** A fixture-backed test mirroring
  `native-runtime-bootstrap.test.ts`'s existing "real local endpoint probe
  against an owned fixture socket" suite (lines 452–489: a real
  `net.createServer` bound at `resolveEndpointPath(dir, "darwin")`, asserting
  `observeLocalEndpoint` returns `present`/`absent` correctly against it) — run
  against a real named pipe on an actual Windows runner, not a mocked
  `platform` override on macOS/Linux. §3 below identifies that no such runner
  currently executes any TypeScript test at all.

## 3. Real platform test plan — actually available runners

Inspected `.github/workflows/foundation.yml` (the only workflow in this repo)
and this worktree's own installed state before naming anything as available.

| Check | Runner that actually exists | What it actually runs | Status |
| --- | --- | --- | --- |
| POSIX transport/lifecycle unit + fixture tests (`native-client.test.ts`, `native-runtime-bootstrap.test.ts`, incl. the real-socket fixture tests) | CI job `native`, `matrix.os: macos-14` | `pnpm --filter @drogon/desktop test` (vitest) | Real runtime execution, on real Unix-domain-socket behavior. **Leader correction (V5 review, 2026-09-07):** the leaf's "no local vitest" claim was wrong — `apps/desktop/node_modules/.bin/vitest` is installed in this worktree (root `node_modules` holds only electron-packager/playwright/prettier). The leader ran `vitest run src/main/native-runtime-bootstrap.test.ts` from `apps/desktop`: **24/24 passed in 939ms**. So a local runner exists for the POSIX fixture tests; CI remains the only runner for the Linux/macOS matrix legs, and no runner exists for Windows (next row). |
| Same suite on Linux | CI job `native`, `matrix.os: ubuntu-22.04` | same `pnpm --filter @drogon/desktop test` | Same as above — real, not locally executed by this task. |
| Windows compile boundary | CI job `windows-compilation`, `runs-on: windows-2022` | **`cargo check --workspace --locked` only** (foundation.yml:55–58, step literally titled *"Check platform boundaries, not runtime acceptance"*) | This is the one and only Windows-labeled CI job. It has no `actions/setup-node` step and no `pnpm`/`vitest` step of any kind — confirmed by reading the full 60-line workflow file. A green run of this job proves Rust compiles for the `x86_64-pc-windows-msvc`-equivalent target; it proves nothing about `native-client.ts`, `native-runtime-bootstrap.ts`, the named-pipe transport, auth, same-user isolation, or daemon lifecycle, all of which are TypeScript and never run there. |
| Windows real named-pipe transport/auth/same-user/lifecycle behavior | **No runner exists in this repo or in this worktree.** This worker's host is `darwin` (confirmed via `uname`); no Windows host is reachable from this task. | — | **Unverified — not waived.** Stays unverified until (a) V1 answers the §2 contract request with an actual Windows `drogond` implementation, and (b) a `pnpm --filter @drogon/desktop test` (or equivalent) step is added to a Windows-labeled CI job, since `windows-compilation` today only compiles. |

Source-side precedent for the same gap pattern: `parity-windows-render-runner.md`
(read per task instructions) documents that the *existing* product's Windows
render test (`runtime-render.test.ps1`) has an identified runner
(`.github/workflows/computer-e2e.yml`'s `windows-latest` job) but "the job
excludes pull requests; its existence is not evidence it ran on a particular
commit" — the same "a Windows CI job existing is not the same as it having run
this code" caveat applies here to `windows-compilation`, which *does* run on
every PR but only compiles.

**Recommendation (not implemented — doc-only task):** once V1's §2 contract is
answered, add a `pnpm --filter @drogon/desktop test` step to
`windows-compilation` (which will first need an `actions/setup-node` step, since
none exists there today) so the existing win32-branch unit tests and any new
real-named-pipe fixture test actually execute on `windows-2022`, and update the
audit ledger to mark Windows transport/lifecycle `unverified` rather than
silently `pass`-adjacent because "the job is green."

## 4. Gaps and risks

1. **Windows same-user protection for the RPC pipe is undefined, not just
   unimplemented.** Source's model (unguessable per-pid pipe name) is
   deliberately *not* an ACL — and per the ROOT sharpening above, such a name
   is never same-user proof in any case. If V1's Windows `drogond` ships with
   a deterministic, hash-of-data-dir pipe name (as this repo's
   `resolveEndpointPath` already produces) and no explicit
   `SECURITY_ATTRIBUTES`/DACL, the default Windows named-pipe DACL — which
   per Microsoft's named-pipe security documentation grants `Everyone` and
   anonymous **read** access (read data/attributes, read permissions),
   with full control reserved to the instance's client/server, not
   unrestricted access to all
   (https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights;
   ROOT correction 2026-09-07 supersedes the earlier "open to `Everyone`"
   full-access wording) — plus an auth-token file with no Windows-mode
   protection in-repo (§1.2.1), is a materially weaker default than source's
   "obscure name" scheme, since the name is no longer obscure. **The finding
   stands: a deterministic pipe name without an explicit DACL is weaker than
   per-instance obscurity.** This must be an explicit decision in V1's answer
   to §2, not an accident of reusing the existing hash-based name unchanged.
2. **No Windows runner executes any TypeScript test today.** `windows-
   compilation` compiles Rust only; this is the same "CI job exists, proves
   compilation, not behavior" trap the source repo's own render-runner doc
   flags for a different subsystem. Any claim that Windows lifecycle "passes
   CI" would currently be false.
3. **`daemon-path.ts`'s empty Windows fallback list is unverified, not
   confirmed-correct.** Source solved an analogous PATH-stripping problem with
   absolute exe paths rather than a fallback list; whether V5's Windows branch
   needs an equivalent (for a harness installed outside system PATH) is open,
   not answered by this reading.
4. **EDR signal surface applies to any future Windows daemon spawn.** Once V1
   ships `spawnDetachedDaemon`'s Windows path, it inherits the exact behavioral
   signature (renamed-image spawn, shell fan-out) that generated six real MDE
   incidents against the source product; the mitigation (shorten interpreter
   chain, avoid `-EncodedCommand`/`Bypass`, plan for an alert-suppression rule
   rather than AV path exclusions) should be designed in from the start, not
   retrofitted after an incident.
5. **`observeLocalEndpoint`'s Windows error-code mapping is unknown.** Its
   POSIX branch keys the `absent` classification on `ENOENT`/`ECONNREFUSED`
   specifically; the Windows equivalents were not verified against a real named
   pipe (no Windows host was available), so §2's "Errors" contract item is a
   real open question, not a formality.
6. **Leader correction:** dependencies *are* partially installed in this
   worktree — `apps/desktop/node_modules/.bin/vitest` exists and the leader
   executed the already-real macOS/Linux fixture tests in
   `native-runtime-bootstrap.test.ts` locally (**24/24 passed**). The leaf's
   "node_modules absent, CI-only" statement is superseded. What remains true:
   no Windows host or Windows TypeScript runner was available to this task,
   so the Windows named-pipe behavior stays **unverified, not waived**.
