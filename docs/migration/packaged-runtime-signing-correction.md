# Packaged runtime signing correction

Root verification, 2026-09-06. This is bounded macOS runtime evidence,
not installation acceptance or full Orca parity.

## Reproduced failure

Candidate `5126985950c0c721460ecfe0c25069ab736b05bf` built and passed
deep/strict code-signature verification, but the actual bundled Electron
renderer failed to launch. DYLD rejected the Electron Framework mapping
under library validation; the desktop subsequently terminated with SIGTRAP.
The original bundle was preserved. Passing signature verification alone
did not prove a launchable package.

The installed `@electron/osx-sign` 2.7.0 applies signing policy through
`optionsForFile`; its default enables hardened runtime. A top-level
`hardenedRuntime: false` did not override that per-file default. Both helper
and framework signatures had `adhoc,runtime` flags.

## Correction and counterexperiment

The packager now supplies `optionsForFile: () => ({ hardenedRuntime: false })`
for the explicitly local ad-hoc macOS preview. This changes neither global
security settings nor the signing policy of a future distributed release.
No notarization or Developer ID distribution claim is made.

Root copied the original bundle into a separate private candidate and
re-signed that copy with the corrected per-file policy. Signature flags
became `adhoc` and deep/strict verification passed. A real Playwright CDP
test then passed four assertions against that actual Electron executable:

1. A stopped session remains visible while its stop reply is held.
2. Selecting its sibling before releasing the reply keeps the correct tab.
3. Releasing the reply dismisses only the stopped session.
4. A real renderer reload preserves that dismissal and selected sibling.

The test used real shell sessions and an owned private socket proxy to
delay one response. Desktop exit code was zero; the directly owned test
daemon exited after SIGTERM without forced cleanup. No discovered PID was
signaled. Root visually inspected before-reply and after-reload screenshots.
The local receipt is `report-1788731567723.json` in the retained
`drogon-rendered-close.GcyJ8H` temporary evidence directory.

This copied diagnostic bundle was not resealed and must not be installed
using the original bundle's receipt. Production must be rebuilt from the
committed correction, sealed after signing and subjected to complete
packaged acceptance. Authenticated quiescent service shutdown and kernel
exit observation remain prerequisites for safe detached-fixture cleanup.
The previous installed preview and all user sessions remain untouched.

Separately, two literal NUL source delimiters in dismissed-session keys
were replaced by equivalent Unicode escapes to restore text tooling.
All 114 desktop tests passed after that semantics-preserving correction.
