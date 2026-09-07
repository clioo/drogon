# Integrated native desktop acceptance

Root validation on macOS arm64, 2026-09-07. This is an intermediate migration
slice, not full Orca parity or a Mentu benchmark.

## Candidate and evidence

- Clean packaged source: `ebbbb58c0b4af3fbf77c84a2edb39f302f7f75f8`.
- Electron44.2.0;191 dependency notices; local ad-hoc signing, not notarized.
- `codesign --verify --deep --strict`: passed.
- Final sealv3: `0059f0c5e8706d09eadb52f3487d69d16df5d363db2c4d8970c910a7c5ff71b9`,
  293 files,307543311 bytes. Legacy partial metadata is not install authority.
- Rust workspace tests and strict all-target Clippy passed in the integrated
  checkout;114 desktop tests,72 renderer-contract tests and both typechecks
  passed.66 packaging tests passed before four additional Pi-readiness cases.
  These counts describe different suites, not a product-completion percentage.

The corrected Playwright/CDP acceptance passed14 checks in
`.preflight/acceptance/desktop-1788752982191-81ecfa85-07f1-4720-b4c9-2dcae26df50a/report.json`.
It starts the bundled service with a minimal PATH, registers an ordinary
folder, renders real PTY output, reloads the same session/incarnation, quits
and reopens Electron while preserving the incumbent service/session/output,
checks tab keyboard navigation and sibling close, captures light/dark/narrow
layouts, closes exact sessions, and preserves their dismissal after reload.

It also launches the installed Pi harness through the bundled native runtime,
observes its actual version header and interactive controls, reloads the same
session, removes only the private fixture socket pathname to produce
`unverifiable`, restores contact, and closes that exact Pi incarnation.
The isolated Pi profile intentionally contains no models or credentials;
its no-model warning is expected. There was no model inference or user-data
access. All owned sessions and both Electron instances exited; the detached
service shut itself down through authenticated fences with kernel exit proof,
without discovered-PID signals or force. The final bundle seal was unchanged.

## Instrument correction

The initial receipt `desktop-1788752696857-6f18a624-5100-47ec-8e28-84a7da3d361a`
reported PASS, but root's screenshot inspection found its Pi check accepted
download-path text instead of the TUI. That receipt is insufficient for Pi
readiness and does not authorize installation. An intermediate stronger
matcher expected an expanded help label and failed against Pi's compact
startup; that failure is retained in `desktop-1788752777242-e2e74283-3529-4957-969b-1b0cc74cfd3a`.
The final browser predicate requires both a Pi semantic-version header and
the actual compact `clear/exit` control, with four regression cases rejecting
absent terminal, download output and header-only output. The same unchanged
sealed candidate passed with that corrected instrument. Root visually inspected
the TUI, launch form, light/dark/narrow layouts and connection-loss state.

## Remaining gates

Current-head platform CI, PR integration and installation/installed-artifact
verification remain separate gates. Preserve previous installed builds and
all user sessions/data. This preview does not implement the full Orca renderer,
native coordination, file/source-control panels, SSH/Windows runtime or the
Mentu/Bots/Meetings workflows; those remain required by the full rewrite goal.
