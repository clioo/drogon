# Proposed Codex goal — test-first full-fidelity Drogon rewrite

Status: proposed text, 2026-09-05. This file does not change the active Codex
goal and does not assert that the migration, planning gate or tests are complete.

## Objective

Plan, orchestrate, implement and independently validate the open-source Drogon
rewrite in `clioo/drogon`, with its own `drogon-cli` and Electron desktop app,
preserving 100% of the enumerated Orca user experience and all previously
implemented Drogon changes. Use the read-only migration baseline at revision
`c97906287bb7a390b25e2025b600d9fb3c25d9c3` and explicitly track differences from
the user's running Orca version. Do not substitute a reduced MVP for parity.

## Execution contract

- Close a source-backed inventory of capabilities, public commands, settings,
  shortcuts, host contracts, UI states and all existing test suites. Unknowns
  and environmental limitations remain visible gaps, not completed coverage.
- Apply tests-first migration: preserve original test expectations and provenance;
  establish a safe Orca baseline; reuse or port the complete suite with reviewed
  behavioral equivalence; prepare dual-target contract/journey tests and establish
  meaningful candidate RED before implementing missing behavior. Keep compile,
  fixture and environment failures separate. Do not skip or weaken tests to pass.
- Supplement existing tests with missing behavior characterization, matched
  screenshots and interactive Electron/Playwright CDP acceptance. Preserve the
  original React design system and interactions while replacing execution with
  the native Rust service and independent CLI. Reuse proven code with attribution
  where safe; no hidden dependency on the Orca executable in the finished product.
- Coordinate asynchronous, conflict-free Orca Task/Dispatch workers using Claude
  Sonnet 5, OpenCode GLM-5.3-Flash / Z.AI Coding Plan, DeepSeek V4 Flash 0731 /
  Alibaba Token Plan, Muse Spark 1.3 Contributor / OpenCode Go, and AGY 3.8 Flash
  when its quota is available. Run independent tasks concurrently, including
  multiple workers per available model. Observe actual provider availability and
  per-invocation permission flags; do not alter global permissions or bypass denies.
- Coordinator owns architecture, shared contracts, task dependencies, review,
  integrated testing, Git and release. After the current audit is complete and
  accepted, introduce the user-authorized three-level hierarchy: Astra → Sol
  area leads → disjoint leaf workers. Verify runtime support and a small nested
  lifecycle before expanding; no nesting during the current audit and no leaf
  delegation. No conflicting writers or unreviewed worker self-acceptance.
  Maintain durable provenance and settle existing assignments before transfer.
- Use the user-authorized separate worktrees and reviewable PRs for cohesive
  independent feature blocks after the audit gate. Base them on reviewed shared
  contracts, declare real stacked dependencies, centralize shared-file changes,
  and validate the integrated build rather than treating per-branch success as
  release evidence. Preserve active checkouts and uncommitted user/worker changes.
- Preserve local/SSH/WSL host ownership, mixed-version wire compatibility, Git
  compatibility, folder workspaces, platform behavior, persistence, recovery and
  all other enumerated contracts. Unreachable execution is `unverifiable`, not
  proof of exit. Protect user sessions, credentials, data and external systems.
- After each accepted implementation block, verify the actual package and keep
  an identified, versioned Drogon preview installed with rollback and previous
  data preserved. Never force-close user sessions to replace a build or daemon.
- After migration acceptance, complete the previously pending Mentu, Bots,
  deterministic trigger authoring/inspection, proactive responsibilities, Meetings
  and other handoff work without dropping any item. Preserve their already-built
  portions during migration, not only in this final phase.
- Use Pi with local Qwen on the DGX Spark for real product tests and the demanding
  with/without-Mentu comparison, not as development workers. No cloud fallback
  or cloud judge in that comparison. Use ample local tokens, measure usage honestly,
  preserve identical predeclared experimental conditions and report failures.
  Do not implement an inference-budget feature as a prerequisite.
- Justify any necessary Mentu upstream changes and PRs in English, with tests and
  narrow scope. Use locally built PR code for verification without waiting for
  upstream merge. Respect existing approval and attribution instructions.

## Completion criteria

The closed inventory has no unaccepted required capability; original test
obligations have executable, reviewed equivalents and passing evidence, including
negative/recovery and platform cases; source defects and deliberate product
deltas are explicitly resolved rather than hidden. All required screenshot and
interactive journeys pass against identified builds. The independent Drogon
application and CLI perform real orchestration without Orca underneath. The latest
verified release is installed, source and PR state are reconciled, and recipes,
handoff and evidence identify exactly what was executed. Do not call an unexecuted
recipe or worker report proof of completion.

Target roughly 24 hours for the rewrite and the September 14 hackathon deadline,
but surface schedule risk honestly: neither deadline authorizes feature removal,
weaker acceptance or a false completion claim.
