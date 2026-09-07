# Drogon

An open-source agent workspace being rebuilt with a Rust core and `drogon-cli`, plus an Electron desktop.

**Status: first vertical slice under implementation and independent review. Not a feature-complete release.**

The previous Orca-based implementation and its history are preserved at [drogon-orca](https://github.com/clioo/drogon-orca). This is a new, independent repository, not a fork or a claim of feature parity.

See [the rewrite plan](docs/migration/preflight-plan.md). Product experiments comparing Mentu against a baseline remain Pi + DGX Spark only; development uses the three explicitly approved harnesses.

The three development harnesses passed their execution smoke on September 5, 2026. See [infrastructure results](docs/migration/preflight-results.md), [lifecycle preflight](docs/migration/lifecycle-preflight.md) and the [current implementation checkpoint](docs/migration/foundation-status.md).

## Development

Use Rust 1.98, Node 24 and pnpm 11.19.0. Install dependencies with `pnpm install --frozen-lockfile`. The coordinator is currently integrating the Rust workspace; consult the checkpoint for outstanding failures before treating a build as accepted.

```sh
cargo build --workspace --locked
pnpm --filter @drogon/desktop build
```

Run the service in a dedicated test data directory with `target/debug/drogond --data-dir /path/to/drogon-data`. In another terminal, set `DROGON_DATA_DIR` to that same directory and run `pnpm --filter @drogon/desktop start`. The first slice requires explicit service startup and never opens Orca's profile. Do not use production data for this development build.

`pnpm typecheck`, `pnpm test`, `pnpm accept:desktop` and `pnpm accept:core-cli` cover complementary boundaries. Acceptance scripts create isolated profiles and retain local evidence under `.preflight/acceptance`; inspect their exit status and reports. A rendered terminal test passing does not imply the complete security, platform or feature gates passed.

## Install (macOS preview)

From a clean checkout on `main`, `pnpm package:desktop` builds the release binaries, bundles the desktop and ad-hoc-signs `Drogon.app`. `node scripts/accept-desktop.mjs --bundle <Drogon.app> --files` runs the sealed packaged acceptance (palette, Settings, Changes, Automations, Bots, status bar, Tasks) against a disposable profile and data directory. `node scripts/install-preview.mjs --bundle <Drogon.app> --report <packaged acceptance report>` installs `~/Applications/Drogon.app` as a link to an immutable copy under `~/Applications/.drogon-builds/`, keeping earlier builds and never stopping a running daemon. The preview carries no telemetry or updater; the installed app uses your existing `~/Library/Application Support/Drogon` data directory.

## Preflight

`node scripts/verify-preflight.mjs <agy|sonnet|glm>` verifies a worker artifact against its input challenge. It requires the local, ignored `.preflight/<lane>/challenge.json` and `result.json` from the run; a fresh clone does not contain those artifacts. This is infrastructure validation, not a product test. Local raw transcripts stay ignored.
