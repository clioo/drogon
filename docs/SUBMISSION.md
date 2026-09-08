# Drogon — submission notes for judges

Drogon is an open-source desktop workspace for developers: a **Rust core**
with a `drogond` daemon and a `drogon-cli` client, plus an **Electron/React
desktop** on top. Its slogan is "Less meeting. More shipping." Give each task
its own Git worktree and session, keep agents and terminals together, and
review, stage, commit and open pull requests without leaving the workspace.
The desktop UI is ported component-by-component from the Orca source (MIT, ©
Lovecast Inc. — see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)); the
Bots, Automations and Mentu-recipe concepts come from the Drogon fork of
Orca. No telemetry, no updater, no model inference inside the app's own test
and acceptance paths (shell fixtures only).

## Build and run (macOS)

Requirements: Rust 1.98, Node.js 24, pnpm 11.19.0 (declared in
`packageManager`), Git, and `gh` for the GitHub features.

```sh
git clone https://github.com/clioo/drogon.git
cd drogon
pnpm install --frozen-lockfile
cargo build --workspace --locked
./target/debug/drogond --data-dir /tmp/drogon-dev
# in another terminal, same data directory:
DROGON_DATA_DIR=/tmp/drogon-dev pnpm --filter @drogon/desktop dev
```

Every change must pass the gates in [AGENTS.md](../AGENTS.md): `cargo fmt`,
`cargo clippy`, `cargo test`, `pnpm typecheck`, the desktop `vitest` suite,
`pnpm test:renderer-contracts`, `pnpm test:packaging`, the production bundle
build, and `node scripts/accept-desktop.mjs --files` (rendered acceptance
over CDP, must end in PASSED).

## Sealed acceptance

Build the ad-hoc-signed, sealed `Drogon.app`, validate it against a
disposable profile, then install the preview:

```sh
node scripts/package-desktop.mjs
node scripts/accept-desktop.mjs --bundle <path-to-Drogon.app> --files
node scripts/install-preview.mjs --bundle <path-to-Drogon.app> --report <path-to-acceptance-report>
```

The installer links `~/Applications/Drogon.app` to an immutable, verified
build under `~/Applications/.drogon-builds/`, preserves earlier builds, and
never stops a running daemon. The installed preview keeps its data in
`~/Library/Application Support/Drogon`. The preview is ad-hoc signed, not
notarized: on first launch, right-click `Drogon.app` and choose **Open**.

## Demo

- Script: [docs/demo-script.md](demo-script.md) — a presenter-ready,
  five-minute path through the twelve MVP journeys, with timings, fallbacks
  and teardown. Prepare it with `node scripts/demo-fixture.mjs --qa` (or
  `--data-dir`/`--cli` against a non-QA daemon); the fixture creates a
  disposable project, worktree, bot, automation and recipe and never starts a
  terminal, harness, model or web server.
- Screenshots: [docs/screenshots/](screenshots/) (`workspace-light.png`,
  `workspace-dark.png`) — captured from the real app running that fixture,
  light and dark, current with the sidebar/tab-strip geometry and the status
  bar. The README embeds them at the top.

## Intentionally out of scope

Remote SSH targets, Linear/Jira/GitLab integrations, new Meetings, voice,
computer use, emulator, mobile, AI Vault, plugins and cloud are outside the
MVP. The binding scope reference is
[docs/migration/rewrite-mvp-plan.md](migration/rewrite-mvp-plan.md) §2
("MVP acordado") and §7 (continuous QA): every shipped journey is covered by
automated acceptance plus a source-anchored fidelity oracle that renders the
app and diffs named UI surfaces against the Orca reference. Feature history
is in [CHANGELOG.md](../CHANGELOG.md), one line per merged PR.
