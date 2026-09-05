# Drogon

An open-source agent workspace being rebuilt with a Rust core and `drogon-cli`, plus an Electron desktop.

**Status: environment and orchestration preflight. No rewritten application is available yet.**

The previous Orca-based implementation and its history are preserved at [drogon-orca](https://github.com/clioo/drogon-orca). This is a new, independent repository, not a fork or a claim of feature parity.

See [the rewrite plan](docs/migration/preflight-plan.md). Product experiments comparing Mentu against a baseline remain Pi + DGX Spark only; development uses the three explicitly approved harnesses.

The three development harnesses passed their execution smoke on September 5, 2026. See [verified results and remaining gates](docs/migration/preflight-results.md). This is not validation of the rewritten product.

## Preflight

`node scripts/verify-preflight.mjs <agy|sonnet|glm>` verifies a worker artifact against its input challenge. It requires the local, ignored `.preflight/<lane>/challenge.json` and `result.json` from the run; a fresh clone does not contain those artifacts. This is infrastructure validation, not a product test. Local raw transcripts stay ignored.
