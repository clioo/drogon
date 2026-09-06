# Native Bot input boundary — Sol focused review

## Outcome

The bounded native input slice is ready for root acceptance as **uncommitted working-tree work**. It exposes and tests the five source-backed admission functions `parse_bot_create`, `parse_bot_update`, `parse_bot_session`, `parse_responsibility_create`, and `parse_bot_id` through the provisionally registered public `drogon_core::bots::input` module. This is not a claim that Bot execution, RPC wiring, persistence, packaging, installation, or full WP-CAP-BOTS product fidelity is complete.

## Source and candidate evidence

- Read-only source: `/Users/carlos/Documents/Drogon-mentu-session` at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`; `bot-schemas.ts` SHA-256 `6f3316eea51381dc341b772278a43afaa3f0c80d82fe092e27a355731b3f14d5`.
- The existing admitted schemas baseline was reused. Fixture generation ran in `.preflight/parity-baseline/wp-cap-bots-native-input-fixtures-DGsVyZ`, never with the source checkout as cwd or a write target, using Node 24 and pinned source Vitest 4.1.11.
- Root independently replayed **144/144** source fixtures: **102 accepted, 42 rejected**. Root also independently confirmed the exact 36-ID source recognition set and fixture SHA-256 `bf074a1d5f7beda2ba10738f52b2efdafc794e0cb4f0ea0402a13dc270dabd8b`.
- Sol focused verification used:

  ```text
  CARGO_NET_OFFLINE=true cargo test -p drogon-core --test bot_input -- --test-threads=1
  CARGO_NET_OFFLINE=true cargo test -p drogon-harness --test known_tui_agents -- --test-threads=1
  shasum -a 256 tests/parity/ports/WP-CAP-BOTS/native-input/fixtures/expected.json
  python3 -m json.tool tests/parity/ports/WP-CAP-BOTS/native-input/evidence.json >/dev/null
  ```

  Results: `bot_input` **9/9 PASS**, `known_tui_agents` **6/6 PASS**, expected fixture digest matched, and evidence JSON parsed. Root independently reproduced the same 9/9 and 6/6 focused results. The relevant pre-existing `drogon-core` targets listed in the leaf record sum to **69**, so the correct combined arithmetic is **69 existing + 9 Bot = 78**; the leaf README/evidence sentence claiming “76 + 9 = 78” is retained as historical evidence but is superseded by this correction.

The source/candidate contract covers strict unknown-field rejection (including nested objects), bounded strings and collections, absent/null distinctions, all 36 recognized TUI-agent IDs, all character presets, partial Bot updates, session admission, responsibility trigger/schedule exclusivity, and error category/path privacy. String length follows the observed Zod 4.5.4 Unicode-code-point behavior. Trimming reuses `crate::claim_identity::js_trim` to match ECMAScript whitespace behavior: U+FEFF is stripped while U+0085, U+001C, and U+200B are retained. Finite nonnegative timestamps are preserved without a saturating `u64` conversion; the explicit serialized-output regression detects the reviewed large-integer saturation defect, while the numeric comparison helper is only evidence against irrelevant serde integer/float storage-kind differences and is not a general integer-loss detector. Unknown-key diagnostics expose only the enclosing schema path and were checked not to echo user-controlled key text through path, display, debug, or serialization.

The 36-ID source recognition catalog remains distinct from the 14 resumable identities and the 4 installed/launchable `HarnessId` variants. Root provisionally registered the public modules and `js_trim` re-export in uncommitted working-tree files; that registration is integration-test enablement, not acceptance, RPC capability, install evidence, or a Git commit.

## Tests-first provenance

The leaf recorded two genuine behavioral RED phases before the current GREEN: an initial deliberately incomplete compiling boundary produced 4 failures out of 6, and the reconstructed stale parser produced 5 failures out of 9 for ECMAScript trim, large timestamps, and unknown-key privacy. Those RED results are leaf evidence, not a root reproduction. Root independently verified only the final 144-fixture source replay and the 9/9 + 6/6 candidate tests.

No source or implementation rerun was requested or performed for the final report-only correction. The implementation, tests, fixtures, and evidence are all uncommitted working-tree artifacts; no report wording should be read as a prior commit.

## Delegation and settlement

Exactly one depth-2 Claude terminal was used: `term_92216223-9ebd-47c2-becf-81068d9830f7`. Its original launch receipt, Dispatch `ctx_962337f3057b` / Task `task_20f54b0c0cc0`, records requested and effective `claude` / `claude-sonnet-5` / `medium`; terminal evidence showed per-invocation bypass permissions enabled. Scoped corrections reused that exact terminal rather than launching another worker.

The final implementation correction, Task `task_0cc6cb6e246e` / Dispatch `ctx_aa41ae7449a9`, settled `completed/succeeded` at `2026-09-06 17:06:21 UTC`. The report-only provenance correction, Task `task_68c8383e13f1` / Dispatch `ctx_7b711a294ad7`, settled `completed/succeeded` at `2026-09-06 17:10:48 UTC`; its `worker_done` is inbox message `msg_70c6d1b8e166`. Sol issued `worker-release` before acknowledging the final delivery: release receipt `f271cef1-9691-4df9-b359-0ec8baeab69c` returned `retained` / `external_terminal` / `processAction: none`, then acknowledgement receipt `b4c1d19c-3aa7-4a21-beae-007d84ebd729` accepted delivery `delivery_0814882ea5d5`. Retained/external correctly did not authorize closing the terminal.

## Deviation and limitations

During the leaf's earlier parser investigation, two throwaway Cargo probe crates under `/tmp` were run; one invocation updated the crates.io index and locked/fetched 11 packages into the temporary crate and ambient Cargo cache. This violated the no-install/no-network boundary. The temporary probe targets were removed and verified absent, and no repository manifest or lockfile was changed; the deviation remains part of the evidence rather than being erased.

The plain whole-crate test was affected by unrelated concurrent `session_authority` compilation work, so focused targets were used for this acceptance review. The historical individual-target accounting is preserved, with its arithmetic corrected above. Remaining root-owned integration includes caller/RPC wiring, persistence, packaging/install verification, and the later durable Bot state, execution, responsibility, UI, and service behavior; no Bot was executed here.

Audit closure remains **11/12 capability groups = 91.7%**, medium confidence, delta **0**. This slice advances test migration/product implementation evidence but does not close the remaining audit group or full Bots fidelity. The next milestone is root acceptance and integration of this native input boundary; 24-hour deadline risk remains medium because state/execution and E5 work remain separate.
