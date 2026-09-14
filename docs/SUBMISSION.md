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
- Reproduce a whole run: `make repro`. It asks which harnesses to use, then
  runs the chain end to end in a disposable world of its own — a bot with a
  `local_file_digest.v1` monitor over `specs/dog-tinder.md`, the spec change
  that wakes it, the session it releases fanning the build out to parallel
  workers through Drogon's own orchestration verbs, and the bounded
  adversarial rounds the daemon drives afterwards. It leaves a receipt in
  `.preflight/reproduce/<run>/` with the verdict of every round, the telemetry
  and usage ledgers, an independent `node --test` of the work product, and the
  cost of what ran. Every invocation is a NEW run (`make repro-list` shows
  them all), and the default lane runs local fixtures: the product executes
  for real, no model inference happens, and nothing is billed. The same demo
  runs from the app in **Settings → Reproducible demo**: the main agent and
  the subagents each take a harness installed here and a model from that
  harness's own list (the Subagent policy's pickers, with a proposal filled
  in), every run creates a project `dog-tinder-<tag>` under Projects and a
  bot `White walker <tag>` under Chats, and the tour leaves Settings on its
  own — Bots once the watch is armed, the run's sessions while the released
  session and its workers run side by side, and the Work Graph's **Agent
  telemetry** and Usage tabs at the end. The telemetry is written by the
  daemon itself as the orchestrator advances (every attempt, runtime, verdict
  with the agent's evidence, and the workflow's outcome), so it reads the
  same whichever harness ran. "Remove demo runs" deletes only what the demo
  created; a watch whose workspace is gone retires itself instead of failing
  forever. Tests: `make repro-test`, `node scripts/probe-repro-demo.mjs`, and
  `make repro-ui`, which runs the in-app demo end to end from its own button
  in a background window — the bot, its watch firing on the spec change, the
  sessions view opening by itself with at least two sessions alive at once
  (measured through the daemon), the rounds passing, the telemetry and the
  cost. `make repro-ui FLAGS="--runs 1 --live --main-harness claude
  --main-model claude-sonnet-5 --subagent-harness pi --subagent-model <id>"`
  runs the same demo on the real harnesses installed here — real inference,
  real spend — with the main agent on one runtime and its subagents on
  another.
- Screenshots: [docs/screenshots/](screenshots/) — 23 images of every surface
  (workspace, Orchestrator off and on, Bots, Meetings, Automations, Tasks,
  Settings; light and dark; one at 760px), all captured from the real packaged
  app against a disposable fixture world with no owner data, and regenerated by
  `node scripts/doc-screenshots.mjs`. [MANIFEST.md](screenshots/MANIFEST.md)
  states what each one shows and the seeding step that produced it.

## Beyond the MVP

Three capabilities grew past the original twelve journeys and are worth a judge's
minute:

- **The Work Graph and the Orchestrator.** The Orchestrator is the graph's one
  interface: a Main agent bound to the live session, the Implementation workers it
  directs at depth 1, and a subagent policy — approved runtimes tried in order, a
  fallback only after they all fail with every attempt recorded, and one execution
  mode at a time: a bounded adversarial loop (break it, then review and verify the
  fixes) or Delegate, which reaches the next session's brief. `.drogon/graph.json`
  keeps a strict `intent` (human-authored) / `state` (daemon-observed) split, and
  each node shows its own attempts and verdicts.
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
