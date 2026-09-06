# CLI argument parser contract (bounded audit)

Machine-readable record: `docs/migration/parity-cli-argument-contract.json`
(schema `drogon.audit.cli-argument-contract.v1`).

Hand-authored audit (Orca `task_84e6de16239f`) sourced by reading the pinned legacy
checkout with the Read tool at exact line anchors — **no source module was
imported, required, or executed**, and no test/app/harness was run. Counts below
are derived from the emitted rows in the JSON sibling of this document, not from
eyeballed regex summaries.

- Legacy source: `/Users/carlos/Documents/Drogon-mentu-session` (read-only)
- Legacy pinned HEAD: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (verified against
  `git rev-parse HEAD` before reading)
- Reconciled against (read-only, **not mutated**): `docs/migration/parity-source-contracts.json`
  (234-command registry catalog)

## Files read

| File | Lines | SHA-256 |
| --- | --- | --- |
| `src/cli/args.ts` | 263 | `3d6362e8910aa57796a0d2bdce2acd7cdf8e3bb69a710235c7364158381e8e77` |
| `src/shared/cli-argument-boundary.ts` | 96 | `ea0e0bd3c21b26c6506ee8b9d636874cd329783275d3139a50fe3bc7a7fcea01` |
| `src/cli/command-spec.ts` | 19 | `6686b3e57543b6f6473f2d62b883e07827dbbedbec14b0b302d6c0cd0f78d5c7` |
| `src/cli/command-suggestion.ts` | 124 | `f2afbb89f8239311c0234ca3a5a6a26d46fae31fb9e6315220d8cfe78dfcaaec` |
| `src/cli/args.test.ts` | 348 | `9117c4ed93977f6a774f58a3f91126a87019c61fae0c1cff5537144e7ec0c3a2` |
| `src/shared/cli-argument-boundary.test.ts` | 33 | `21e67e48b2e4e79aef903c1a81685034a447bad497a6a7808ca55201a7cd4e17` |
| `src/cli/command-suggestion.test.ts` | 146 | `7f13bdf45d2b892aa66f647333eec00f2520cf35af65f30deab4cbc3167be8b6` |

## Out of scope for this pass

- Per-command **handler bodies**: required/optional/default/type semantics for
  handler-typed flags are not enumerated per command (see Obligations below).
- The **dispatch layer** that decides whether `argumentMode: 'passthrough'`
  actually bypasses flag validation (lives outside these 4 files).
- `src/main/startup/cli-launch-redirect.ts` — read only far enough to confirm
  one call-site fact (below), not otherwise audited.

## Parser contract facts

### Tokenization & value inference
- `--flag=value` splits on the **first** `=` only, so a value may itself contain
  `=`; `--flag=` yields an empty string, not `true`. (`args.ts:48-56`)
- For a flag name **not** in `CLI_BOOLEAN_FLAGS`: no next token, or a next token
  starting with `--`, stores `true`; otherwise the next token is consumed as a
  string value. This lookahead is the **only** type inference the parser
  performs — there is no numeric/enum/JSON coercion anywhere in these 4 files.
  (`args.ts:58-75`)
- A bare `--` token has **no** argument-terminator meaning; it parses as an
  ordinary flag token with an empty flag name.
  (`cli-argument-boundary.test.ts:21`, `"bare double dash"` case)

### Command-boundary detection
- `parseArgs` calls `findCliCommandIndex(argv, commandPaths ?? [])`
  (`args.ts:39`) — **always** with the default empty `knownValueFlags` array.
- `findCliCommandIndex`'s optional 3rd parameter (`knownValueFlags`, an
  always-value-taking flag allowlist) is used by exactly one other caller in
  the pinned checkout — `src/main/startup/cli-launch-redirect.ts:127-133`
  (desktop launch redirect) — **never** by the CLI's own `parseArgs`. Real CLI
  argv parsing relies solely on the generic 2-token lookahead heuristic in
  `commandPathStartsAt`/`findCliCommandIndex` for value-vs-command-start
  disambiguation.

### Global flags
- `GLOBAL_FLAGS = ['help', 'json', 'pairing-code', 'environment']`
  (`cli-argument-boundary.ts:1-2`) are allowed on **every** command,
  independent of that command's own `allowedFlags`.
- `pairing-code` / `environment` specifically must carry a non-empty string
  value or `validateCommandAndFlags` throws `Flag --<name> requires a value.`
  — enforced unconditionally, even for commands that never reference them.
  (`args.ts:250-254`; tests: `args.test.ts:285-295, 272-283`)

### Boolean flags — 41 declared, 39 appear in the current catalog
- `CLI_BOOLEAN_FLAGS` declares 41 names (`cli-argument-boundary.ts:4-46`).
  **39** of them appear in at least one command's `allowedFlags` in the
  current 234-command catalog; the other 2 (`help`, `json`) never need to,
  because they're global.
- **Critical distinction:** boolean-set membership controls only how a token
  is *parsed*. It does **not** make a flag *allowed* on a given command —
  every non-global boolean flag must still be declared in that command's
  `allowedFlags` to pass `validateCommandAndFlags` (`args.ts:255-261`),
  exactly like any other flag.

### Repeated-string flags — exactly 2
- `label`, `skill` (`args.ts:25`) accumulate multiple string occurrences
  joined by `REPEATED_FLAG_SEPARATOR` (U+0000, `args.ts:24`); every other
  flag name simply overwrites on a later occurrence (last value wins).
  (Tests: `args.test.ts:173-183`)

### Conditionally global `page` flag
- `supportsBrowserPageFlag(spec.path)` (`args.ts:97-132`) makes `page` an
  additional global-equivalent flag for eligible commands, without requiring
  the command's own spec to list it. In the current catalog: **84** commands
  are page-eligible, **150** are not. 6 commands (`tab show`, `tab switch`,
  `tab profile set`, `tab profile show`, `tab profile use-default`,
  `tab profile clone`) redundantly also declare `page` literally in
  `allowedFlags` even though they're already page-eligible.

### Handler-typed flags — 194 of 236, no parser-level type system
- Every catalog flag name that is not global, not boolean, not
  repeatable-string, and not `page` gets **no** parser-enforced
  required/optional/default/enum/numeric constraint. `validateCommandAndFlags`
  checks only **name membership**, never a value shape.
- **This is the population the task calls out explicitly:** a flag not in the
  boolean set is *not* universally optional, and its type is *not* validated
  by the parser. Whatever required/default/type semantics it actually has is
  a per-command **handler** concern, not proven here (see Obligations).

### Positional arguments
- `normalizeCommandPositionals` (`args.ts:187-221`) binds `positionalArgs[i]`
  names from trailing bare tokens into the same flags map used for
  validation, only if that name isn't already present from an explicit flag;
  a same-name collision is recorded in `positionalFlagConflicts` and rejected
  with `Pass --<flag> either positionally or as a flag, not both.`
  (`args.ts:240-247`) before the allowedFlags check runs.
- **Cross-check against the 234-command catalog:** every declared
  `positionalArgs` name, in every command that has one, is *also* present in
  that command's `allowedFlags` — **0 counterexamples**. This is an emergent
  property of the current catalog, not an enforced invariant in these 4
  files (nothing rejects a mismatched declaration at authoring time).

### Passthrough mode
- `effectiveAllowedFlags` (`args.ts:135-146`) returns `[]` immediately when
  `argumentMode === 'passthrough'`. In the current catalog exactly **1**
  command uses it: `claude-teams`.
- **Open question, not settled by these 4 files:** whether
  `validateCommandAndFlags` is even invoked for a passthrough command, or is
  skipped upstream by the dispatch layer before flags are checked at all.

### Unknown command / unknown flag errors
- Unknown command → `RuntimeClientError('invalid_argument', 'Unknown command: …', unknownCommandData(...))`
  (`args.ts:230-238`). Suggestions: same-depth candidates only, hidden specs
  always excluded, destructive specs/aliases excluded unless the mistyped
  token is itself within Levenshtein distance ≤ 1 of a destructive verb;
  remaining candidates within distance ≤ 3, sorted, capped at 3.
  (`command-suggestion.ts:8-45, 53-59`)
- Unknown flag → accepted iff global, or declared in `spec.allowedFlags`, or
  `page` on a page-eligible command; else
  `RuntimeClientError('invalid_argument', 'Unknown flag --<flag> …', unknownFlagData(...))`
  (`args.ts:249-261`). `unknownFlagData` sorts the valid-flags list
  alphabetically, ranks suggestions the same way as commands (no destructive
  suppression for flags), and always appends a `Valid flags: …` next step.

### Help resolution
- `resolveHelpPath` (`args.ts:81-89`) has two independent triggers:
  `commandPath[0] === 'help'` (a literal first token) OR `flags.has('help')`
  (the global boolean flag). Neither is gated by `validateCommandAndFlags`.

## Flag classification reconciled against the 234-command catalog

236 distinct `allowedFlags` names appear across the current catalog. The four
disjoint, non-empty buckets below sum exactly to 236 (global flags are never
redeclared in the catalog, so that bucket contributes 0):

| Category | Count | Note |
| --- | --- | --- |
| Global (`help`, `json`, `pairing-code`, `environment`) | 0 in catalog (4 total) | never redeclared; always allowed |
| Boolean-typed | 39 | of 41 declared; parsed as boolean, but still requires per-command declaration (except help/json) |
| Repeatable-string | 2 | `label`, `skill` |
| Conditionally-global (`page`) | 1 | eligible on 84/234 commands |
| **Handler-typed (no parser type system)** | **194** | see caution above |
| **Total** | **236** | matches the catalog's distinct `allowedFlags` count |

Full name lists for every bucket are in the JSON sibling
(`flagClassification.categories.*.names`).

## Handler obligations (open, not audited here)

This is **not** a claim of full per-command implementation coverage. Three
concrete, general obligations, each with a stated owner, are recorded instead
of a fabricated per-command matrix:

1. **`handler-typed-flag-semantics`** — each of the 194 handler-typed flag
   names needs its actual required/optional/default/type semantics confirmed
   against its owning command's handler. Resolve ownership per command via
   `parity-source-contracts.json → handlerGroupMembership.rows[].groups`
   (group-membership only; handler bodies were not read for this obligation).
   **Status: open.**
2. **`passthrough-dispatch-bypass-unverified`** — confirm whether the
   dispatch layer actually skips `validateCommandAndFlags` for `claude-teams`,
   or whether it still runs against an empty `effectiveAllowedFlags()`.
   Owner: the dispatch layer (e.g. `src/cli/index.ts`), not read in this
   pass. **Status: open.**
3. **`known-value-flags-path-unverified`** — confirm whether
   `findCliCommandIndex`'s unused-by-`parseArgs` `knownValueFlags` path would
   change command-boundary resolution for any real CLI invocation against the
   actual 234-command value-flag names. Owner: `args.ts:39` call site.
   **Status: open.**

## What this document does not claim

- It does not claim full CLI contract closure — handler bodies, RPC
  attribution, and dispatch-layer passthrough behavior remain unread.
- It does not claim that a flag outside the boolean set is optional, typed,
  or defaulted — only that these 4 parser files impose no such constraint;
  the actual constraint, if any, lives in a handler this audit did not read.
