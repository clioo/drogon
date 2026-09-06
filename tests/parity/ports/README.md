# Original-test migration artifacts

Tests copied/adapted from Orca retain the full Lovecast Inc. notice in
`LICENSE.orca`. Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`;
per-suite maps preserve paths, hashes and binding status. New Drogon-authored
tooling remains covered by the repository license.

A file here is not automatically a completed test port. Preserved original
assertions, candidate bindings, executed cases, behavioral RED/GREEN and
integrated product acceptance are distinct. Missing modules or test environments
must not be called behavioral RED. Never replace missing behavior with a fake
adapter that produces expected results, or claim a frozen source suite ran
against Drogon when it did not.

## Literal-preservation check

Run `node scripts/check-frozen-test-ports.mjs --source-root <read-only-source>`
from the rewrite checkout. Its reviewed manifest is `tests/parity/frozen-test-ports.json`.
It checks pinned file hashes and exact bodies after the leading static-import
region; provenance comments may be added, other leading comments/directives must
match. It reads only and never executes the reference. Unsupported syntax fails
closed as a body difference; do not loosen it to accept changed assertions.
Import binding equivalence, source execution, native translations and actual
candidate parity need separate evidence. Do not call a frozen body a completed port.
