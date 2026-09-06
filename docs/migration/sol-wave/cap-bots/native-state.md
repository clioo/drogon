# Native Bot/automation state handoff

Status: **bounded storage slice delivered; full Bot feature not accepted or complete**. This is the nearest stable handoff after Carlos ended the Sol-lead orchestration model. Root owns all integration and any further correction.

## Delivered boundary

The single Claude leaf added native Bot and global Automation record/storage modules, actual public-crate tests, an ICU4X-backed locale ordering boundary, a source-assertion case map, and reproducible Node locale fixtures. The storage work includes full JSON record round trips, scoped Bot reads, global Automation records/runs, monotonic `rev` compare-and-swap writes, transactional scheduled-responsibility creation, atomic responsibility-run dedupe, deletion/history behavior, schema stepping/future-version refusal, reopen/rollback cases, and cross-scope maintenance tests.

Root provisionally registered these modules through working-tree changes to `crates/drogon-core/src/{lib.rs,bots/mod.rs,automations/mod.rs}`. Those registration files are root-owned and were uncommitted at this review; this report does not claim a Git commit, Engine migration registration, RPC/CLI exposure, packaging, or installation.

## Source provenance and case map

- Read-only source: `/Users/carlos/Documents/Drogon-mentu-session` at exact revision `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (validated as 40 lowercase hex).
- `src/main/bots/bot-responsibility-owner.test.ts`: SHA-256 `f4ae1f7e05c58cb3019c61777b0599821243535c378bb420b13c11e582edef6f`, 11 cases.
- `src/shared/drogon-bot-contract.test.ts`: SHA-256 `cf53484ae09bf95dff4da4095b1baf769b77ab1f5f1a89d32678a5bad094ce5f`, 7 cases.
- `src/main/persistence-bot-automation.test.ts`: SHA-256 `e2d8da6ccfdb08c992d92456832d16282c03ebcc34d347e5c6f336e2dbf84346`, 2 cases.
- Source host-fence references: `automation-owner-precondition.ts` SHA-256 `85ec1872b51ca3904cd3b95f4c09b2e874b43938894770f1f1637955e1fa624d`; `automation-owner-projection.ts` SHA-256 `4b2d0bff66c018ea55f4861c8cfa8caea81c7fca1d28128d732a6b5c83e3f68d`.
- Machine map: `tests/parity/ports/WP-CAP-BOTS/native-state/case-map.json`, 20/20 source case titles represented: **12 covered, 5 partial, 3 open**. “Partial” means only the record/storage portion is asserted; it is not feature parity.

The fully open source cases are history closing on final Automation status, scheduled-dispatch hydration, and session-context construction. Partial cases retain explicit gaps for run-link repair, automation-status interaction, and dispatch-time reactive execution refusal. The complete assertion pointers and bounded correction tests are in the case map.

## Focused verification

Parent review ran, from the rewrite checkout only:

```text
cargo test -p drogon-core --locked --offline --test bot_storage --test automation_records --test locale_ordering
```

Result: exit 0; `automation_records` **21 passed**, `bot_storage` **38 passed**, `locale_ordering` **5 passed**; total **64 passed, 0 failed, 0 ignored**. These tests import the actual root-registered public `drogon_core::{automations,bots,locale_ordering}` modules; no `#[path]` test seam remains.

```text
cargo check -p drogon-core --locked --offline
```

Result: exit 0.

```text
cargo fmt --all -- --check
```

Result: exit 1. The check reports formatting diffs in this slice and in unrelated dirty files. Under the nearest-stable-handoff instruction, Sol neither edited the leaf output nor opened another correction; root must format/review without overwriting concurrent user work. No costly source replay was run in this final review.

The leaf also reported a broader crate run where every owned suite passed but a pre-existing out-of-scope `session_authority.rs` assertion failed against another dirty `session.rs`; Sol did not use that broader run as whole-crate GREEN. The focused 64/64 and package check above are the independently reproduced results.

## RED/GREEN classification

- Historical genuine assertion RED (leaf evidence, not independently replayed by Sol): serde initially collapsed present JSON `null` and absent keys for `Option<Option<T>>`; `optional_and_nullable_fields_distinguish_absent_null_and_value` failed, then passed after the `double_option` deserializer.
- Root/Sol review found concrete storage defects after the first GREEN-looking pass: timestamp-based CAS clobbering, non-atomic run dedupe, create-by-upsert hijacking, incomplete rollback evidence, no stepwise old-version migration, and cross-scope cleanup errors. The same leaf added deterministic two-connection/reopen tests and production fixes; these cases are included in the current 64/64 result.
- Early test-local `#[path]` compilation was setup scaffolding, never accepted as behavioral GREEN, and was removed after root provisionally registered the real modules.
- The missing SSH host-authority registry/projection is neither behavioral RED nor partial GREEN. It is an unimplemented production dependency and a mandatory admission block.

## Mandatory follow-on gates

The Bot-ID `AutomationOwnerPrecondition` is only a Bot ownership check. It does **not** implement or approximate the source `assertAutomationOwnerFence`, which resolves `self` / `ssh(targetId, targetGeneration)` / `orphan` against live SSH-target generations, workspace host, and repo/connection state. Root explicitly declined a fabricated registry in this slice; therefore the real SSH host-authority fence remains fully open and must land before any global Automation mutation/deletion RPC is admitted.

Root must also integrate migrations into `Engine::open`/`db.rs`, bind host-default locale discovery, review the global deletion/cross-scope maintenance authority, expose versioned Engine/RPC/CLI contracts, complete the five partial/three open source behaviors, connect UI/execution paths, and perform locked whole-workspace/packaged-app acceptance. No Bot/model was executed, no service started, and no user data was read or imported. E5 publication/assets/service work remains held.

Audit closure remains **11/12 capability groups (91.7%, medium confidence, delta 0)**; this storage work does not change that denominator. Test migration for this 20-case subset is 12 covered / 5 partial / 3 open, while product fidelity remains incomplete. Full-fidelity 24-hour deadline risk remains **high**.

## Files and hashes

| File | SHA-256 |
|---|---|
| `crates/drogon-core/src/bots/records.rs` | `8e6651c683694e5e2d37dc782519055c3ae943cff3bec2c60b561a02be0d7e2c` |
| `crates/drogon-core/src/bots/storage.rs` | `e2f20d3ea376e419bcf0315a96eabfcd84e7d3b565a5b51adc80a290e4c964fb` |
| `crates/drogon-core/src/automations/records.rs` | `e71a82c5efda3964d7aeabd377145d22184b69ec52820927df5a3c82d756e5d2` |
| `crates/drogon-core/src/automations/storage.rs` | `10956b04a14513cfcb9a84ec6b5d64baef2d771a93f762121fea62b6a895e8fb` |
| `crates/drogon-core/src/locale_ordering.rs` | `7c3ee5fb1cd02241e880e79ca917a1169a2e46a1fa5ea425e7cf5cc4ddc87e37` |
| `crates/drogon-core/tests/bot_storage.rs` | `38bded95df7f52b30e2dad06128d579d95d36a75f381e39833f1354387ef3adc` |
| `crates/drogon-core/tests/automation_records.rs` | `ca881db36a376c58b4091aa849d4565755afe660fd38978b6b16de6a77f988e3` |
| `crates/drogon-core/tests/locale_ordering.rs` | `15b83c5dd343915169ed236c5d64104e9caf0e192ca06fdc2250f5744b08054a` |
| `tests/parity/ports/WP-CAP-BOTS/native-state/EVIDENCE.md` | `3016c3209abbb43cc83a24c2a332399539f7d3c4fe5db73ba1167818dfaeee54` |
| `tests/parity/ports/WP-CAP-BOTS/native-state/case-map.json` | `5a51b9ec3d62ec9410ddae7356e175bd97b86651a69aa9f6be22a80918d17118` |
| `tests/parity/ports/WP-CAP-BOTS/native-state/locale-ordering/gen-locale-fixtures.mjs` | `5b4e164e1e7afe2bcc174b35207f4e69b13f418918e3bba599bc9e4035c7226a` |
| `tests/parity/ports/WP-CAP-BOTS/native-state/locale-ordering/node-fixtures.json` | `4560622c1d8dfbb2f3cb7e780c7445cdeb911651fcc6a858c805abbe799b398c` |

## Child provenance and settlement

Exactly one external terminal was used: `term_92216223-9ebd-47c2-becf-81068d9830f7`. Its original verified launch receipt is Task `task_20f54b0c0cc0` / Dispatch `ctx_962337f3057b`, requested and effective `claude` / `claude-sonnet-5` / `medium`; the terminal preview showed per-invocation bypass permissions enabled. The current Run reused that exact terminal, so reuse receipts intentionally show null model overrides.

Current Run `run_8423468a5d2a` deliveries were:

1. `task_3890a143c777` / `ctx_ec035066fe68`, succeeded/settled at 17:51:47 UTC.
2. `task_22d37d4b6e77` / `ctx_613d1c90de2a`, succeeded/settled at 18:08:55 UTC.
3. Last child: `task_e7b5da6c276b` / `ctx_00b3f8b9d6b0` / terminal `term_92216223-9ebd-47c2-becf-81068d9830f7`, succeeded/settled at 18:16:32 UTC. Release receipt `91553a85-af23-40d1-8d60-9a34cd29a3c3` returned `retained` / `external_terminal`, `processAction: none`; delivery `delivery_a3bc3d15512b` was acknowledged only after release. The terminal was never force-closed.

Process deviations remain material: the leaf used one forbidden provider-native internal `Agent(fork)` for read-only source research, and later briefly used the reference checkout as cwd for a read-only status check. Root audited/adjudicated continuation; no writes, installs, network calls, or services occurred, and later source checks used `git -C` from the rewrite cwd. These deviations are not counted as Orca delegation or proof and remain fully recorded in `EVIDENCE.md`.
