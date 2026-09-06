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
