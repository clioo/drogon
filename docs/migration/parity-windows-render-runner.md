# Windows render test: runner identified, execution pending

This resolves the routing question for `WP-UNRESOLVED-01` without changing the
frozen test census or pretending that a Windows test passed on macOS.
Source revision: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.

The coordinator read all 224 lines of
`native/computer-use-windows/runtime-render.test.ps1`, the wrapper's dispatch
table and the Windows CI job. The route is explicit:

1. `package.json:69` maps `verify:computer-native` to
   `config/scripts/verify-computer-native.mjs`; release scripts at lines 89–90
   also invoke it.
2. The wrapper's Windows snapshot renderer entry at lines 77–90 launches
   `powershell.exe` with the test file, only on `win32`.
3. `.github/workflows/computer-e2e.yml:183–199` defines a `windows-latest`
   job which invokes that wrapper at line 196. The job excludes pull requests;
   its existence is not evidence it ran on a particular commit.

The test dot-sources `runtime.ps1` with a nonce-named handshake operation file.
It constructs in-memory fake UI Automation elements and exercises named and
anonymous controls, row summaries, wrapper elision, failed child reads, node
limits and depth limits. Assertions include enumeration counts and truncation
flags, not just snapshot text. It prints `windows-snapshot-render-tests-ok`
only after the assertions complete and removes its operation file in finally.

This is **not** an inert text-only test suitable for an arbitrary host:
it compiles fake types via Add-Type and loads the production runtime, whose
top-level imports include Windows UIAutomation and Forms assemblies. The
original wrapper uses ExecutionPolicy Bypass. That is recorded source behavior,
not approval to copy that launch policy into the new product. Before a candidate
runner is implemented, follow the existing Windows EDR posture reference.

No wrapper, PowerShell, native helper or UI operation was executed in this
inspection. The full production runtime was not reviewed for execution safety.
Future execution needs a dedicated Windows fixture and explicit pass evidence;
the original wrapper skips missing commands without failing, so its exit zero
alone is insufficient. Preserve the actual test marker, assertion failures,
process exit and skip status. Owner: coordinator/test infrastructure with
WP-ENG-NATIVE (test port) and WP-CAP-DEVICE (joint computer-use acceptance).

The existing single-path allocation bucket remains stable to preserve its
source manifest identity. It is no longer runner-unknown; runtime collection,
candidate port and Windows execution remain unverified.
