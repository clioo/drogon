# TypeSafe for Drogon

This is the TypeSafe harness used in `howdycom/astro-market`, adapted to Drogon.
The skill, the smoke validator, the Codex Stop hook, and the one-sided CI
advisor come from that repo. The Howdy pull-request tiers (iterate versus
merge, early Playwright, Lighthouse) do not: Drogon has no deferred browser
matrix for Jev to pull forward. Foundation, journeys, and packaged acceptance
always run.

The upstream skill is installed at `.agents/skills/typesafe-ai/`. Codex
discovers it there. `.claude/skills/typesafe-ai` and `.grok/skills/typesafe-ai`
are relative symlinks to that directory, so Claude Code, Codex, and Grok read
one copy. The body matches
[`typesafe-ai/skills` at `65a39f393687675ce170e6094757de20370365b9`](https://github.com/typesafe-ai/skills/commit/65a39f393687675ce170e6094757de20370365b9)
(v0.5.7), with the Markdown tables formatted as in astro-market. The YAML
`description` stays narrow: `Use only when the task explicitly involves TypeSafe, Jev, or TYPESAFE_API_KEY.`

Refresh by copying `skills/typesafe-ai` from a pinned commit of
[typesafe-ai/skills](https://github.com/typesafe-ai/skills) and recording that
SHA here. After copying, put the narrower `description` back. Keep both
symlinks. `npx` and `pnpm dlx` are not the install path.

## Configure and run

Set `TYPESAFE_API_KEY` in the root `.env` or in the agent process. Obtain a key
from the [TypeSafe console](https://console.typesafe.ai/keys). Optional
settings are `TYPESAFE_BASE_URL` (default `https://api.typesafe.ai`) and
`TYPESAFE_DEFAULT_MODEL` (default `jev-latest`). No SDK is added to the app.

The validator reads the root `.env`, then inherited environment values, in
increasing precedence. It parses dotenv values without executing shell code.
An explicitly empty inherited key overrides a key in the file and disables the
request. Missing or whitespace-only keys also skip.

From the repository root:

```sh
node scripts/typesafe-validate.mjs
```

The script sends one request to `POST /v1/systemone` with two fixed synthetic
messages and two Noul questions. It checks the response model, answer types,
finite probabilities in `[0, 1]`, and that the explicitly urgent sample scores
above `0.5` while the explicitly non-urgent sample scores below `0.5`. These
are smoke-test expectations, not production thresholds.

- **Passed:** a live typed response met both sample expectations; exit `0`.
- **Skipped:** no nonblank key was configured; no request was sent; exit `0`.
- **Failed:** HTTP, network, timeout, response-shape, or sample-expectation failure; exit `1`.

Requests have a 15-second timeout and do not follow redirects. The script does
not print the key or raw response bodies, and sends no repository files.

## Who runs the check

- **Codex**, when `TYPESAFE_API_KEY` is set: `.codex/hooks.json` runs the
  validator once per turn on `Stop`. Codex must trust project hooks.
- **Grok**, when `TYPESAFE_API_KEY` is set: run
  `node scripts/typesafe-validate.mjs` once before finishing and report
  passed, skipped, or failed. Grok Build discards stdout on `Stop`, so there
  is no TypeSafe Stop hook.
- **Claude Code** leaves the check to Codex and Grok.

A missing or blank key skips with no request. In `--hook` mode that prints
`{}`, because Codex surfaces `systemMessage` as a warning. Passed and failed
hook results include `systemMessage` and do not set `decision`. A
sample-expectation miss is third-party model behaviour, so another agent turn
cannot repair it.

```sh
node "$(git rev-parse --show-toplevel)/scripts/typesafe-validate.mjs" --hook
```

## In GitHub Actions

`.github/workflows/typesafe-advisor.yml` runs on pull requests. It uses the
`TYPESAFE_API_KEY` secret when one is configured. Fork pull requests do not
receive that secret.

[`scripts/ci-jev-advisor.mjs`](../../scripts/ci-jev-advisor.mjs) asks Jev, per
changed runtime file, whether the diff could change a desktop or CLI flow and
whether it could change a daemon guarantee (session liveness, PTY delivery,
worktrees, the Work board, orchestration gates, bot monitors, automations).
At or above `0.85` the job summary asks a reviewer to look at that surface.

The advisor never removes a required check. `vars.CI_JEV_MODE=shadow` records
the probabilities and still asks for both kinds of attention. `off` skips the
request and does the same. A missing key, a diff that cannot be read, more
than 40 runtime files, a timeout, or a malformed answer also ask for both.
Docs, tests, `scripts/`, and `.github/` are not sent. A path that looks like a
credential file is sent as a path only.

## Verify

```sh
node --test scripts/typesafe-validate.test.mjs scripts/ci-jev-advisor.test.mjs
node scripts/typesafe-validate.mjs
TYPESAFE_API_KEY= node scripts/typesafe-validate.mjs
```

The tests never call the live service. The last command proves the empty-key
skip. Do not put a literal key in shell history or in a fixture.
