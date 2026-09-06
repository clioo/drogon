# Root acceptance: production close guard

2026-09-06, 16:23 UTC. Accepted only the actual main-world close-guard boundary.
The broader rewrite, UI parity, restart checkpoint, packaging and installation
remain incomplete. Source baseline/module provenance remains in the Sol report.

## Independent RED to GREEN

Root ran the final delegated runner unchanged before and after caller integration:

```text
node scripts/accept-preload-close-guard.mjs --execute
```

Both runs used Node 24.19.0, Electron 44.2.0, actual desktop builds, Playwright CDP,
nonce-owned profiles, and no daemon or user sessions. The only product change in
this acceptance was importing `installBrowserWindowCloseGuard` and invoking it
through `contextBridge.executeInMainWorld` in the real preload entry, matching
the pinned original caller pattern. Existing dirty buildInfo wiring was preserved.

| Evidence under tests/parity/ports/WP-UI-PRELOAD/electron-close-guard | Result |
| --- | --- |
| `2026-09-06T16-22-27-512Z/report.json` | RED, native replaceable window.close; exit 1 |
| `2026-09-06T16-22-51-164Z/report.json` | GREEN, guarded close and replacement resistance; exit 0 |

The before preload digest was
`77f87eb59169e9f52693fc2e0ab9146fa6e0d50c931cfb9b3b23cd030bf6f735`;
after was `e76a1590ac5cc2122bc1c418cf81c532b6ae652ebf91a2b279d0f9c6dbe861fe`.
Both used main digest
`65cf7afdb764e3c0a561cd22feac7a24c03af7bc4b956a0a7bfc33505d122dfe`.
These identify dirty-tree builds, not a clean HEAD-only build.

GREEN proves an own non-native function with configurable/writable/enumerable
all false, a still-responsive page after calling close, rejected assignment and
defineProperty replacement, and absence of Node globals in the main world.
The bridged preload ran. Persisted and returned verdicts agree, screenshot
evidence is complete, CDP disconnected and the exact owned Electron exited.
Root inspected the after screenshot: the isolated service-unavailable workspace
remained visible, as expected with no daemon. It is not service-health evidence.

Root additionally ran the 19-test final runner suite (19 passed, no skipped cases),
all 13 desktop test files (75/75 passed), desktop typecheck (exit 0), and production
build (exit 0). Build emitted upstream
Zod PURE-annotation warnings; no error. Historical initial harness-plumbing failure
and leaf RED were retained, not relabeled or replaced by root evidence.

## Ownership and remaining work

GLM implemented the harness under Sol-UI, including root/lead review corrections.
Root integrated the product entry and independently tested the result. The parent
was released through Orca; external terminal retained, no force-close. Packaging
or reinstall was not performed: this source-build acceptance does not validate
the full currently dirty foundation, attribution bundle, or install lifecycle.
Preserve the current verified installed preview until those gates pass.
