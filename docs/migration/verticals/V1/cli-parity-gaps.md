# V1 CLI argument-parity gaps

Vertical: V1 runtime-cli. Task: `task_3430c9df30fa` (dispatch `ctx_0fc9be2fe56c`).
Companion suite: `crates/drogon-cli/tests/argument_parity.rs` (one test per
uncovered source assertion, assertion strength never weakened).

- Source contract: `docs/migration/parity-cli-argument-contract.md` +
  `.json` (schema `drogon.audit.cli-argument-contract.v1`).
- Source checkout: `/Users/carlos/Documents/Drogon-mentu-session`, pinned
  `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (read-only; file reads only).
- Candidate: `crates/drogon-cli` at `596ddbd` (branch
  `codex/vertical-01-runtime-cli`, clap 4.6.6 derive, default features).
- Method: read-only survey of `crates/drogon-cli/src/cli.rs` +
  `tests/parser.rs` coverage, then behavioral probes of the real binary with
  an isolated `DROGON_DATA_DIR`. RED = the test asserts the source behavior
  verbatim and the candidate fails it behaviorally. No assertion was weakened
  to turn a RED into a GREEN.

## Result

`cargo test -p drogon-cli --test argument_parity --locked`:
**18 GREEN / 4 RED** (RED = recorded gaps below, by design).
All other pre-existing `drogon-cli` targets remain green (lib 53,
integration 49, orchestration_commands 52, orchestration_auth 6, parser 7).

## RED gaps (source behavior missing in the candidate)

| Gap | Source anchor + assertion | Test | Candidate behavior observed |
| --- | --- | --- | --- |
| V1-G1 | `src/cli/args.test.ts:179-183`: a repeated non-repeatable string flag overwrites; last value wins (`--workspace old --workspace new` → `new`) | `tokenization::repeated_non_repeatable_flag_last_value_wins` | clap rejects the second occurrence outright: "the argument '--name <NAME>' cannot be used multiple times", exit 2. No last-value-wins overwrite anywhere in the grammar. |
| V1-G2 | `src/cli/args.ts:70-72` (+ `args.test.ts:49-54`): a non-boolean flag whose next token starts with `--` stores implicit boolean `true`; the following token is still parsed as a flag. This is the parser's only type inference. | `tokenization::flag_followed_by_flag_shaped_token_stores_implicit_boolean` | clap aborts the parse: "a value is required for '--data-dir <PATH>' but none was supplied", exit 2. No implicit-boolean inference exists. |
| V1-G3 | `src/cli/args.test.ts:305-326` + `src/cli/command-suggestion.ts:115-124`: unknown-flag errors ALWAYS carry the full valid-flag list (`data.validFlags`, alphabetically sorted) and append a `Valid flags: ...` next step even with zero suggestions. | `unknown_command_and_flag::unknown_flag_error_enumerates_the_valid_flags` | Candidate prints only the tip + usage line; no valid-flag enumeration in any channel (usage errors never emit the JSON envelope either). |
| V1-G4 | `src/shared/cli-argument-boundary.test.ts:21`: a bare `--` token has no terminator meaning; the following token still starts the command path (expected boundary index 1). | `command_boundary::bare_double_dash_does_not_block_command_resolution` | Candidate treats `--` as a hard escape: "unexpected argument 'status' found / tip: … remove the '--' before it", exit 2. |

## Structural gaps (no candidate surface; no behavioral test expressible)

These source features have no equivalent in the candidate grammar, so a
behavioral assertion cannot even be formed. They are parity debts of the
frozen first slice, not test failures:

1. **Repeatable string flags** (`label`, `skill`, U+0000
   `REPEATED_FLAG_SEPARATOR` accumulation; `args.ts:24-34`) — no candidate
   flag is repeatable, and no multi-occurrence accumulation exists (see V1-G1).
2. **Conditionally-global `page` flag** (`supportsBrowserPageFlag`,
   `args.ts:97-132`; 84/234 catalog commands page-eligible) — no browser/page
   concept in the candidate.
3. **Spec metadata for suggestion guards** — `destructive`, `hidden`,
   `aliases` (`command-spec.ts`); destructive-intent suppression
   (`DESTRUCTIVE_INTENT_THRESHOLD = 1`), hidden exclusion, alias-inclusive
   same-depth ranking, distance ≤ 3 / top-3 cap (`command-suggestion.ts`) —
   the candidate has no command registry metadata; suggestions come from
   clap's built-in did-you-mean, whose ranking/caps are clap's own.
4. **Positional name-binding** (`normalizeCommandPositionals`,
   `args.ts:187-221`; trailing bare tokens bind into flag names; explicit
   flag/positional collision → `Pass --<flag> … not both.`, `args.ts:240-247`)
   — candidate positionals are dedicated clap fields (`workspace add <PATH>`,
   `rpc <METHOD>`); no name-binding or collision surface.
5. **Command aliases** (`specPaths` canonicalization, `findCommandSpec`) —
   no candidate command has aliases.
6. **Spec-level passthrough (`argumentMode: 'passthrough'`)** — no
   `argumentMode` concept. The observable passthrough semantic (flag-shaped
   tokens past the boundary are never flag-validated) IS covered GREEN via
   the candidate's argv boundary: `passthrough::flag_shaped_tokens_after_the_argv_boundary_are_not_validated`
   (`terminal create … -- COMMAND ARGS`, clap `last = true`).
7. **`findCliCommandIndex` `knownValueFlags` third parameter** —
   `parseArgs` never passes it in the source either (contract marks the path
   open). The candidate's clap value parsing consumes the next token for
   every value flag unconditionally, which subsumes the disambiguation the
   heuristic approximates; GREEN tests
   `command_boundary::value_matching_a_registered_verb_consumed_as_value` and
   `…_command_group_…` pin the observable contract.
8. **Structured error-data channel** — source `RuntimeClientError` carries
   `unknownCommandData`/`unknownFlagData` (`suggestions`, `validFlags`,
   `nextSteps`) for agent recovery; candidate usage errors are plain stderr
   text, exit 2, stdout always empty. Human-channel tips partially cover
   suggestions (GREEN tests), the enumeration is V1-G3, and no structured
   channel exists for tools.

## GREEN mapping (source assertion → test)

| Source anchor | Assertion | Test |
| --- | --- | --- |
| `args.test.ts:29-33` | `--flag=value` splits on first `=`; value keeps inner `=` | `tokenization::equals_form_splits_on_the_first_equals_so_values_may_contain_equals` |
| `args.test.ts:35-39` | `--flag=` stores empty string, not absence/true | `tokenization::equals_form_empty_value_is_an_empty_string_not_absence` |
| `args.test.ts:22-27` | `=` form passes a `--`-leading value | `tokenization::equals_form_is_the_only_way_a_value_may_start_with_double_dash` |
| `args.test.ts:297-303` | unknown command-specific flag refused | `unknown_command_and_flag::unknown_flag_refused_on_a_subcommand` |
| `args.test.ts:49-54` (end state) | mistyped pre-command flag refused | `unknown_command_and_flag::unknown_pre_command_flag_refused` |
| `args.ts:230-238` | unknown command (depth 2) refused | `unknown_command_and_flag::unknown_command_refused_at_depth_two` |
| `args.test.ts:328-347` | unknown-command error suggests intended command | `unknown_command_and_flag::unknown_command_error_suggests_the_intended_command` |
| `args.test.ts:305-326` (suggestion half) | unknown-flag error suggests intended flag | `unknown_command_and_flag::unknown_flag_error_suggests_the_intended_flag` |
| `command-suggestion.test.ts:86-89` | near-miss ranking suggests same-depth candidates | `unknown_command_and_flag::unknown_depth_two_subcommand_suggests_similar_commands` |
| `args.test.ts:291-295` | empty `--flag=` on a required-value global flag refused | `global_flags::global_value_flag_empty_equals_value_refused` |
| `args.ts:250-254` | required-value global flag with no value token refused | `global_flags::global_value_flag_missing_value_token_refused` |
| `args.test.ts:272-283` | global flags accepted without per-command declaration | `global_flags::global_flag_accepted_after_subcommand_without_declaration` |
| `args.test.ts:89-94` | pre-command value consumed; command still resolves | `command_boundary::pre_command_value_consumed_and_command_still_resolves` |
| `args.test.ts:106-114` | verb-named value consumed as value | `command_boundary::value_matching_a_registered_verb_consumed_as_value` |
| `args.test.ts:116-124` | group-named value consumed as value | `command_boundary::value_matching_a_command_group_consumed_as_value` |
| contract `passthroughMode` | flag-shaped tokens past the argv boundary not flag-validated | `passthrough::flag_shaped_tokens_after_the_argv_boundary_are_not_validated` |
| `args.ts:81-84` | literal `help` first token resolves remaining path | `help_resolution::help_as_first_token_resolves_the_remaining_path` |
| `args.ts:85-88` | `--help` global flag short-circuits validation | `help_resolution::help_flag_short_circuits_per_command_validation` |

## Notes

- Candidate divergence kept as candidate behavior (not a gap): `--prompt`
  uses `allow_hyphen_values`, so a space-separated `--`-leading value IS
  consumed there, unlike the source lookahead rule. This is a documented
  candidate feature (`cli.rs` "Literal initial prompt"), exercised by its own
  unit tests; the source-contract strict form is pinned by V1-G2 for ordinary
  value flags.
- Out-of-scope per the contract (handler bodies, dispatch-layer behavior,
  per-command required/default/type semantics for handler-typed flags) was
  not tested.
- An untracked file `crates/drogon-cli/tests/native_dogfood.rs` appeared in
  this worktree during the task; it is not part of this vertical's delivery,
  was not modified, and was deliberately not executed.

## Implementation record (task_5ff3b9bf6f8d): V1-G1..G4 closed

All four REDs are now GREEN; `cargo test -p drogon-cli --test
argument_parity --locked` = **22 passed / 0 failed**, every other
`drogon-cli` target green (lib 53, integration 49, native_dogfood 2,
orchestration_commands 52, orchestration_auth 6, parser 7, doc 0), and
`cargo clippy -p drogon-cli --all-targets --locked -- -D warnings` +
`cargo fmt -p drogon-cli -- --check` clean. Production changes are confined
to `crates/drogon-cli/src/cli.rs` plus one coordinator-approved line in
`main.rs` (below); the frozen test file is untouched.

- **V1-G1 (last-value-wins on repeated non-repeatable flags)** —
  `args_override_self = true` on `Cli` and every cli.rs-owned leaf command
  (`status`, `rpc`, `workspace add|list`, `terminal
  create|list|read|send|resize|close`, `harness list|start`). Repeated
  occurrences now overwrite (source `args.ts:27-34` semantics) instead of
  clap's "cannot be used multiple times". Coverage note: leaves under
  `orchestration_cli.rs` keep clap's default (outside this task's edit
  scope); the source applies the overwrite rule to every flag.
- **V1-G2 (implicit boolean for a flag followed by a flag-shaped token)** —
  the three global value flags (`--data-dir`, `--request-id`,
  `--retry-request`) take `num_args = 0..=1` with
  `default_missing_value = "\u{0}"`. NUL is an unambiguous presence marker:
  `execve` argv can never contain it, so no real value can collide.
  `validate()` translates the marker into the source's exact refusal
  ("Flag --data-dir requires a value.", `args.ts:250-254`); `--request-id` /
  `--retry-request` markers are rejected by their existing control-character
  shape rules. Parse-level behavior matches `args.ts:70-72` (parse succeeds,
  following tokens parse normally — pinned by the frozen library-level test).
  Documented divergences: (a) per-command value flags keep clap's strict
  required-value error (still an exit-2 refusal, same observable class);
  (b) clap treats any `-`-leading token as flag-shaped, while the source
  only special-cases `--`-prefixed tokens, so a single-dash value
  (`--data-dir -x`) is refused rather than consumed.
- **V1-G3 (Valid flags enumeration on unknown-flag errors)** — static
  `override_usage` on `Cli` and every cli.rs-owned leaf appends an
  alphabetically sorted `Valid flags: …` line (mirror of the source's
  sorted `unknownFlagData.validFlags` + always-appended `Valid flags:`
  next step, `command-suggestion.ts:115-124`). No error paths, exit codes,
  or clap tips changed. Coverage note: `orchestration` leaves keep their
  dynamic usage (file out of edit scope).
- **V1-G4 (bare `--` is an inert token)** — the binary entry now goes
  through an inherent `Cli::try_parse()` (shadows the trait method) that
  drops leading bare `--` tokens before clap parsing; mid-argv `--`
  (the `terminal create` argv boundary) is untouched. Ambiguity recorded:
  the source parser retains the bare `--` as an empty-named flag, which the
  source's own `validateCommandAndFlags` would then refuse as an unknown
  flag for real commands; the frozen test's literal assertion (command
  resolves, run proceeds) was implemented per the task's ambiguity rule.
  Library-level `try_parse_from` callers are unaffected.
- **Sanctioned main.rs change** — coordinator approved (ask/answer on this
  dispatch) removing the now-unused `use clap::Parser as _;` import: the
  contract-aware inherent `Cli::try_parse()` in cli.rs shadows the trait
  method for the binary entry, leaving the trait import dead and failing
  the `-D warnings` gate. No other main.rs line changed.
