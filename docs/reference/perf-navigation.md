# Navigation latency: measure + budgets (R16-BF)

`scripts/perf/measure-navigation.mjs` times what Carlos feels as speed:
sidebar-rail page opens (click to content paint), cold start, session tab
switches, and worktree card updates after session activity. Every metric
reports N samples with median + p95 (default 5) plus the Long Tasks
overlapping each sample, as JSON on stdout (and `--out <file>`).

Budgets: Drogon within 1.25x of the live orca-drogon reference per metric,
every rail page open <= 300 ms absolute, and the pushed worktree-card
update <= 200 ms median.

## Reference (attach only)

The live orca-drogon instance is somebody's running app. This mode never
starts, stops, types into, reloads, or dismisses anything there: it drives
sidebar-rail navigation only, skips legs while the rail is mid-use
(`reference-busy` samples), and navigates back to the entry page at the
end. Cold start has no reference (restarting it is forbidden) and stays
report-only, as do the fixture-backed interaction metrics.

```sh
node scripts/perf/measure-navigation.mjs \
  --reference-cdp http://127.0.0.1:9445 --samples 5 \
  --out /tmp/reference.json
```

If the instance is mid-use, samples come back `reference-busy`; wait for a
quiet window (the rail reads stable across a few seconds) and rerun.

## Packaged candidate (harness-owned lifecycle)

Spawns the sealed bundle on an isolated data/profile pair, provisions one
git project (from `--fixture-repo`), one worktree, one workspace and
`--sessions-count` shell sessions, selects the worktree, measures, then
stops everything it started (Electron by PID, the bundled daemon through
the sealed-acceptance quiescent shutdown). Needs no model, no network
beyond the Tasks `gh` fetch, no paid anything.

```sh
node scripts/perf/measure-navigation.mjs --bundle <Drogon.app> \
  --data-dir /tmp/drogon-perf-data --profile-dir /tmp/drogon-perf-profile \
  --fixture-repo <a gh-backed checkout> --sessions-count 6 \
  --samples 5 --out /tmp/drogon.json
```

Metric notes:

- `cold-start`: spawn to sidebar ready. First-ever runs also pay V8 code
  caching; compare warmed runs.
- `open:tasks`: the first sample of a virgin profile pays the live `gh`
  fetch; later samples paint the persisted seed instantly and revalidate
  underneath. The median is the user-visible number.
- `update:worktree-card`: writes into a live shell session and times the
  shared Working badge. Bound by the session-state propagation cadence,
  not by scripting (Long Tasks stay zero). Since R16-BF2 the daemon pushes
  the change (`session.events.poll` → `ui:session-state-changed`) instead
  of waiting for the 2 s `session.list` poll, so this metric carries an
  absolute budget (median <= 200 ms, no reference leg).
- `switch:session-tab`: needs 2+ tabs; honest `fewer-than-2-tabs` without
  fixtures.

## Budgets

```sh
node scripts/perf/measure-navigation.mjs --check \
  --report /tmp/drogon.json --reference /tmp/reference.json
```

Exit 0 with per-metric `pass`/`info`, non-zero on the first `fail`. The
step is manual (see below), not CI: the reference is a live dev-mode app
whose numbers swing with whoever is using it, and Tasks pays real `gh`
latency.

## Stability

Not yet wired as an acceptance step: 5 consecutive runs have not been
demonstrated flake-free (reference contention, `gh` variance). Run it
manually per the commands above; wire it in only after 5 green runs.
