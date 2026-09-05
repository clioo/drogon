# Reference launch audit — coordinator correction

Status: **launch not accepted**. This replaces the initial Muse report after
source review found consequential errors in its isolation conclusions.
No reference application has been launched. The personal Orca instance is
not a test fixture and must not be restarted, modified or stopped.

## Provenance

The frozen migration source is `c97906287bb7a390b25e2025b600d9fb3c25d9c3` in
`/Users/carlos/Documents/Drogon-mentu-session`, read-only including `out/`.
Existing ignored build artifacts have no verified source-to-build receipt.
Their version or modification times cannot prove their source revision;
a build may precede a commit containing the same bytes and timestamps can be
preserved. Do not describe the old build as proven incompatible either.

An old build can be labelled visual observation with unknown source provenance,
not source-pinned acceptance. The preferred reference is a fresh build in an
independent disposable source copy, with revision, dependency/tool versions,
build mode, output hashes and fixture changes recorded.

## Source-backed findings that change the next action

| Boundary | Verified source | Required action |
| --- | --- | --- |
| Profile and home | `tests/e2e/helpers/electron-home-isolation.ts` creates a disposable home; `src/main/startup/configure-process.ts:183` validates Node home and sets Electron home/userData; `orca-app.ts` verifies the resolved home after launch | Reuse these checks but establish confinement before process startup; never change global HOME/CODEX_HOME or target the personal profile. |
| Environment | The helper removes a specific home/Codex/shell-key list, then spreads the remaining inherited environment and supplied overlays | This is not a credential/environment allowlist. Build a deliberate child environment; absence of personal repos in the fixture is not proof no ambient credential is inherited. |
| Network | `main-process-runtime-launch.ts:64-81` enables `exposeNetworkByDefault` for E2E; `runtime-rpc/runtime-rpc-lifecycle.ts:145-159` resolves that to `WS_BIND_HOST_ALL_INTERFACES`; `runtime-rpc-pairing-types.ts:21-22` defines `0.0.0.0`; `runtime-rpc-websocket-bind-host.test.ts:84-101` asserts the wide bind | Random port is not loopback isolation. Confine network externally or add a documented fixture-only loopback override in the disposable copy. Never call the unchanged E2E network boundary safe for a host reference run. |
| Daemon teardown | `tests/e2e/helpers/electron-process-shutdown.ts` reads numeric PID files and calls its process-tree killer; no process-incarnation/fixture-root verification occurs between those operations | A stale/reused PID CAN target an unrelated process. Do not reuse this cleanup unchanged. Verify exact owned child/daemon identity before signals and retain evidence on unverifiable ownership. |
| Hooks | `src/main/codex/codex-real-home-hook-install.ts` installs/sweeps hook files and can invoke a Codex trust-grant session | Ensure all paths and children remain in the disposable home or disable that lane only in the documented visual fixture. Hashing personal files afterward is detection, not prevention, and does not authorize touching them. |
| CLI installation | The desktop launch comments describe a separate renderer-driven install flow; home-relative defaults alone do not establish all fallback targets | Verify installer destination and prevent global CLI replacement/elevation before a reference launch. Do not infer confinement from one default path. |
| Keychain/auth | `tests/e2e/helpers/electron-launch-args.ts` sets Chromium mock-keychain flags on macOS | Useful fixture machinery, not proof every app credential store or external provider CLI is isolated. Resolve native/app credential access separately. |
| Notifications, telemetry, update and relay | Startup contains notification, updater and optional relay paths; the initial report conflated updater suppression with telemetry suppression | Verify each separately. Use explicit test privacy controls and no personal credentials. A headless window does not by itself prove all side effects absent. |
| Instance lock | `single-instance-lock.ts` derives lock identity from the configured profile and normally skips the lock for dev unless E2E enforcement is set | Separate profile is required regardless of lock policy; do not use the packaged bypass flag or interact with the personal instance. |

These are static findings; the cited source tests were read, not executed in
this audit. They do not establish that all launch side effects have been found.

## Next concrete sequence

1. Prepare an independent clean source copy at the frozen revision under a new
   `.preflight/reference-build-*/source` directory. Never build into the
   read-only reference checkout and never redirect output through a symlink.
2. Review build commands/config and prepare independent dependencies in that
   copy against its frozen lock, without running unaudited lifecycle scripts
   or modifying shared installed packages. Record whether dependencies were
   freshly installed or copied, and any missing native build prerequisites.
3. Compile the reference there; retain full build provenance and output hashes.
   Compiling is not launching or accepting the application.
4. Close the prelaunch gaps above using an isolated environment and a reviewed
   fixture adapter. Record any adapter changes separately from frozen source;
   visual-fixture differences cannot prove unchanged runtime/network behavior.
5. Run one background Electron/Playwright CDP session, assert profile/home and
   listener boundaries, capture first window, fixture workspace/terminal and
   settings/about states with theme/viewport/build identity. Then extend the
   screenshot/interaction matrix feature by feature.
6. Close only processes whose exact fixture ownership is established. Keep
   receipts, screenshots and fixture data until review; no broad PID sweep or
   automatic profile deletion on a failed/uncertain teardown.

The existing launch helpers are reuse candidates, not an approved verbatim
harness. Further code/launch work remains required; this audit does not claim
there are no blockers or that screenshots are complete.

## Build-only progress at 23:22 UTC

Steps 1–3 have a first successful reference bundle in
`.preflight/reference-build-Z1ylje/source` at the exact frozen SHA. Existing
dependencies were independently copied (no source-pointing symlinks), their
installed application lock matched the second document of the source lock,
and the Electron/Vite wrapper exited 0 under Node 24.19.0. The source stayed
clean. `build-result.json` records 1,105 output hashes and the explicit child
environment; `build.log` retains the existing build guards and chunk warnings.
No registry reinstallation, full desktop/native/CLI build, app launch or
installation is implied. The prelaunch gates above remain open.
