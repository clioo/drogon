# Drogon — submission notes for judges

Drogon is an open-source desktop workspace for developers: a **Rust core**
with a `drogond` daemon and a `drogon-cli` client, plus an **Electron/React
desktop** on top. Its slogan is "Less meeting. More shipping." Give each task
its own Git worktree and session, keep agents and terminals together, and
review, stage, commit and open pull requests without leaving the workspace.
The desktop UI is ported component-by-component from the Orca source (MIT, ©
Lovecast Inc. — see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)); the
Bots, Automations and execution-evidence concepts come from the Drogon fork of
Orca (the authoring surface has since become the Work Graph). No telemetry, no updater, no model inference inside the app's own test
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
  disposable project, worktree, bot, automation and work graph and never starts
  a terminal, harness, model or web server. The 3:45–4:30 segment is the Work
  Graph and the Orchestrator — designing nodes, the subagent-policy failover
  order, and the bounded adversarial loop.
- Screenshots: [docs/screenshots/](screenshots/) (`workspace-light.png`,
  `workspace-dark.png`) — captured from the real app running that fixture,
  light and dark, current with the sidebar/tab-strip geometry and the status
  bar. The README embeds them at the top.

## Beyond the MVP

Three capabilities grew past the original twelve journeys and are worth a judge's
minute:

- **The Work Graph and the Orchestrator.** The work is designed on a canvas —
  nodes with their own harness and model, dependency edges — and `.drogon/graph.json`
  keeps a strict `intent` (human-authored) / `state` (daemon-observed) split. On top
  sits a subagent policy: approved runtimes tried in order, a fallback only after they
  all fail with every attempt recorded, an optional Delegate mode that reaches the next
  session's brief, and an optional adversarial loop (break it, then review and verify
  the fixes) bounded by a maximum iteration count.
- **Bots that wake themselves.** A bot owns monitors — file digest, HTTP poll, script,
  or a watch on a repository's pull requests — and a firing monitor releases real work:
  a watched PR opens a worktree and starts a review session, deduplicated per case, with
  new watches parked until approved.
- **Meetings.** Markdown transcripts from a local note-taker, indexed read-only, with
  search, filters and bounded reads at corpus scale; commitments can be extracted into
  real tasks, each shown with the transcript line it came from, using only a free local
  model.

Installation is also no longer manual: `brew tap clioo/drogon && brew install --cask
drogon` installs the app, the daemon and the CLI, and an upgrade restarts a daemon whose
binary changed instead of silently attaching to the old one.

## Intentionally out of scope

Remote SSH targets, Linear/Jira/GitLab integrations, voice,
computer use, emulator, mobile, AI Vault, plugins and cloud are outside the
MVP. Every shipped journey is covered by automated acceptance, plus a rendered oracle
that diffs named UI surfaces against their recorded baselines. Feature history
is in [CHANGELOG.md](../CHANGELOG.md), one line per merged PR.
