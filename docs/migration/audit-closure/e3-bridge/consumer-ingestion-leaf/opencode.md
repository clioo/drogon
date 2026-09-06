# UIG-OPENCODE: opencode usage ingestion contract (leaf)

Candidate leaf audit, **not** closure. Parent owns consumer13 + the
Claude/Codex complement and will independently review, integrate and release.
No recensus; no unread helper relabeled external.

- Task `task_df6099832449`, Dispatch `ctx_5042f615e1cf`, parent terminal
  `term_233f0742-c797-43da-b5b9-0efd8e91ad43`.
- This worker runs on terminal `term_517b3e95-5910-4621-8141-29b5a38f4517` at
  dispatched depth 2 (leaf, no descendants, no child). Retained launch
  `opencode --model opencode-go/muse-spark-1.3-contributor --auto`; routing
  receipt only, no self-authentication.
- Source read-only: `/Users/carlos/Documents/Drogon-mentu-session` pinned
  `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. Work limited to
  `/Users/carlos/Documents/Drogon-rewrite`. AGENTS.md read (CLAUDE.md is a
  one-line pointer to it); no Orca/global settings touched. No tests executed,
  no installs, no source edits, no Git commands (hashes via file bytes only).
- Scope is exactly UIG-OPENCODE from `followup-domain-ownership.json`
  `ingestionInputBoundaries`: the 6 named modules plus only-necessary local
  callees. Machine companion: `opencode.json` (8 function contracts, 26
  verified whole-file hashes, 3 test files, 19 assertion bodies read).
- Corrected parent applied (see §7): the prior leaf's false OpenCode opt-in
  preservation and topModel/topProject omissions are superseded here.

## 1. Discovery — `listOpenCodeDatabases` (discovery.ts:30-61)

Resolves `<XDG_DATA_HOME|~/.local/share>/opencode` (trimmed XDG, empty falls
back; Windows uses HOME/USERPROFILE home, **not** LOCALAPPDATA — test-pinned).
`OPENCODE_DB` override: blank = unconfigured; `:memory:` = memory-only → [];
relative joins the data dir; absolute used verbatim (host-flavoured
`isAbsolute`, so UNC stays verbatim on Windows only); override-as-directory
(stat-not-file) → []. Default scan lists `opencode(-suffix)?.db` files,
sorted. Every fs failure resolves to [] — `onRefusal(path, error)` fires
**only** for `WslTranscriptFsError` (stalled UNC/9P mounts hit the scan
deadline via the single-slot WSL gate instead of hanging, STA-4049). An empty
list is therefore ambiguous (absent vs refused) unless the refusal callback
observed it. Priority is pure string order: `opencode.db` rank 0, ties by
path (`compareOpenCodeClaimPriority`, discovery.ts:73-83). Freshness key is
`{path, mtimeMs, size}` (`getProcessedDatabaseInfo`, 85-94); float-ms
inequality forces reparse by design.

## 2. Row queries — `selectUsageRows` (row-queries.ts:118-164)

Three probed DB generations, fastest first: materialized session token totals
(any positive-token session row) → assistant `session_message` rows (gated by
`type='assistant'` when the column exists, else token-presence probe) →
legacy `message` rows (`json_extract(data,'$.role')='assistant'`). Missing
`session` table → []. The `project` join degrades to a null-join without the
table/`project_id`; `session.model` selects NULL when the column is absent.
Zero-token units excluded in SQL; output ordered `(time_created, id)`.
Materialized rows synthesize message-shaped JSON with `cache.write` hardcoded
0 and `total = input+output+reasoning`. Probes are `sqlite_master` /
`PRAGMA table_info` checks (`schema-helpers.ts`), shared with the AI Vault
scanner. Query throw mid-read aborts the whole scan (no per-DB isolation).

## 3. Row parsing — `parseOpenCodeUsageRow` (row-parsing.ts:69-110)

Returns the parsed event or null (drop, never throw; `JSON.parse` failures →
null). Coercion (`usage-record-coercion.ts`, 11 lines, the whole contract):
`ensureNumber` admits finite numbers else 0; `extractString` admits trimmed
non-empty strings else null. Consequences: `cachedInputTokens =
min(cache.read, input)` (over-reported cache clamped; negative reads can push
the sum-guard to drop the row); `total = tokens.total` only when > 0 else
recomputed input+output+reasoning; rows with zero five-part sum dropped; cost
kept only when > 0 else null; timestamps by priority completed > created >
time_updated > time_created with seconds-vs-millis inference (`<1e10` ×1000),
non-positive rejected, invalid Date → drop; model `provider/model` with
`modelID|modelId`, `providerID|providerId`, and `data.model`/session-model
JSON-object fallbacks, null when unresolvable (→ `'unknown'`/`'Unknown model'`
buckets downstream); cwd from `path.cwd` → `directory` → `worktree`, null
when all absent. `session_id` passes through unvalidated.

## 4. Attribution — `attributeOpenCodeUsageEvent` + canonical paths (worktree-attribution.ts:58-122)

Worktrees canonicalized once per scan (`realpath` + normalize, throw →
un-normalized fallback; 8-way bounded fanout; sorted longest-path-first so
nested worktrees win). Match is equality **or** containment (win32 vs posix
chosen by either side looking Windows-like); `..name` children accepted, true
`..` escapes and cross-drive paths rejected (all three test-pinned).
`cwd` matched → `worktree:<id>` + display name; unmatched → `cwd:<normalized>`;
null cwd → `unscoped` + `Unknown location`; default label otherwise last two
path segments. Day is **local-timezone** `YYYY-MM-DD` (host-offset-sensitive);
invalid timestamp → null (drop). Output always carries string `projectKey`/
`projectLabel` with nullable `repoId`/`worktreeId`.

## 5. Claim ownership + aggregation (scanner.ts:51-220, aggregation 269 lines)

Per-DB parse (51-95): readonly open + `query_only=ON`, claim each session id
once per DB (`claimSession` callback or default true), skip-and-flag deferred
claims, attribute, aggregate with null-preserving cost fold (`addCost`: null
only when both null) and `structuredClone` session merge; handle **always**
closed in `finally`. Cross-DB scan (97-220): mtime/size + owned/shape check
decides reuse vs reparse; deleted-owner triggers reclaim **only** for
previously-deferred DBs; lower-priority owned siblings are demoted to reparse
when a higher-priority path parses (sticky-backup unfreeze; empty-owned
siblings never demoted); live `opencode.db` claims first with cached claims
restored in priority order; per-DB merges are whole (a failed DB fails the
scan — no partial-db contribution); event loop yielded every 2 DBs.
Finalization sorts breakdowns by tokens desc, resolves `Mixed models` /
`Multiple locations` / `Unknown location` primaries, sessions by
`lastTimestamp` desc, dailies by day then label. Five cross-DB claim/reclaim
sequences plus reuse-identity (`toBe`) are test-pinned with exact totals.

## 6. SQLite wrapper + failure taxonomy (sync-database.ts, sqlite-read-failure.ts)

`SyncDatabase`: optional `fileMustExist` precheck (TOCTOU race remains —
driver throw is authoritative), `node:sqlite` load throw on runtimes without
it (Node 18 SSH companions import without opening), LRU-256 statement cache
(PRAGMAs and wildcard selects never cached; DDL-matcher clears first),
`pragma(..., {simple})` no-row → `undefined`. Partial success is per-call;
no transactions here. `isTransientSqliteContention` (busy/locked errcode or
message) vs structural `wal-index-unavailable` (WAL siblings unhostable on
9p/SMB/SSHFS — retry cannot fix) vs other: the classifier exists but is
**not consumed** in the opencode scan path, so a locked `opencode.db` aborts
the scan and surfaces as `lastScanError` upstream rather than retrying.
Recorded as observed behavior, not endorsed design.

## 7. Corrected parent applied

Per `followup-domain-ownership.json:145,353,424` and `.md:111,117,124`:
OpenCode schema-mismatch normalization returns **full defaults including
`enabled=false`** — opt-in is not preserved (the prior S-FACTORIES leaf's
blanket preserve-enabled claim is corrected for OpenCode; same-version path
only normalizes costs to `?? null`). OpenCode summaries **do** carry
`sessions`, `topModel`, `topProject` (plus `events`) — verified at
`snapshot-rollups.ts:50-67` and `shared/opencode-usage-types.ts` (the prior
leaf's omission claim is superseded). `hasInferredPricing` stays Codex-only
on breakdown/session rows. The `.md:117` defect list (raw handler inputs,
pre-ack mutation, swallowed persistence errors, stale slice overwrites) is
reused as characterization, not desired parity.

## 8. Tests and remaining execution

Whole allocation preserved and read in full (19 its): `scanner.test.ts`
(572 lines — message parse exact shape, 3 attribution cases,
materialization exact tokens/cost, typeless messages, owned-id report,
message-table preference, 2 override empties, 5 claim/reclaim sequences);
`scanner-windows-data-directory.test.ts` (90 lines — home-dir resolution,
`path#session` Vault identity, zero issues); `scanner-wsl-gate.test.ts`
(132 lines — deadline-only settling, refusal callback shape, healthy
listing). Nothing executed. Exact remaining obligations — whole-file runs
plus new gates (zero-token/cost drops, timestamp inference, cache clamp,
unknown-model buckets, invalid-timestamp drops, scoping matrix,
longest-path priority, claim ordering, float-mtime reparse, reclaim series,
reuse identity, refusal shape, home-dir resolution, override empties,
pragma set, finally-close, locked-DB abort documenting the unused
classifier, tz-sensitive day boundaries, mixed primaries, daily order) and
live-DB/provider-version delivery — are enumerated in `opencode.json`.
