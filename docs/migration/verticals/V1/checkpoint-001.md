Vertical / scope / base SHA / head SHA / branch / worktree:
V1 runtime/CLI, first checkpoint: native daemon/CLI dogfood (fixture +
real-model legs) and CLI argument-parity closure (22/22). Base
596ddbd9e8b6fdc5d5fa26616479e910b34ba604; head SHA recorded at commit
time below. Branch codex/vertical-01-runtime-cli, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-01-runtime-cli.
Child Run run_797122265fda. Two leaves, both through real Orca
orchestration (no native subagents): Sonnet 5 high (dogfood) and OpenCode
ZAI GLM-5.3-Flash (parity/implementation).

Capabilities and original contract/test IDs:
orchestration.native.v1 (PR9, 18 entry points); WP-ENG-RUNTIME, WP-ENG-CLI,
WP-ENG-DAEMON, WP-ENG-HARNESS (harness side: discovery/launch reuse only).
Source contracts: docs/migration/parity-cli-argument-contract.md/.json
(legacy c9790628, read-only). Distinction kept throughout: FIXTURE leg
proves daemon/CLI orchestration wiring with zero network; REAL-MODEL leg
proves the shared spawn engine reaches a real provider. Neither claims the
full autonomous workerStart-with-callback dogfood (open, separately costed).

Changed paths; shared-file patch requested:
New: crates/drogon-cli/tests/native_dogfood.rs,
crates/drogon-cli/tests/argument_parity.rs,
docs/migration/verticals/V1/dogfood-evidence.md,
docs/migration/verticals/V1/cli-parity-gaps.md,
docs/migration/verticals/V1/checkpoint-001.md (this file).
Edited: crates/drogon-cli/src/cli.rs (+109/-6: G1 args_override_self,
G2 num_args 0..=1 + NUL default_missing_value with source-exact wording,
G3 static Valid-flags lines, G4 inherent Cli::try_parse dropping leading
bare --), crates/drogon-cli/src/main.rs (one approved line: drop now-unused
`use clap::Parser as _;`). No shared files (Cargo manifests/lockfiles,
drogon-protocol, lib.rs/db.rs, registries, .github) touched; none requested.

Baseline evidence; behavioral RED; GREEN commands + exit codes/counts:
Baseline: no test drove a real drogond end to end (existing suites use an
in-process mock transport); argument-parity port found 4 behavioral REDs
(V1-G1..G4) with assertions at full source strength. Leader re-ran every
claim: `cargo test -p drogon-cli --locked` exit 0 — lib 53, main 0,
argument_parity 22/22, integration 49, native_dogfood 2 (1 fixture + 1
real-model skip-path), orchestration_auth 6, orchestration_commands 52,
parser 7; total 191 passed / 0 failed. `cargo clippy -p drogon-cli
--all-targets --locked -- -D warnings` clean; `cargo fmt -p drogon-cli --
--check` clean. Real-model leg additionally verified opted-in by the
leader: DROGON_DOGFOOD_REAL_MODEL=1, 1 passed in ~6s wall (real
`claude --print`, marker bytes through a real daemon PTY read).

Integrated/rendered/platform evidence; exact package identity if applicable:
Source-tree dogfood only (macOS arm64, rustc/cargo 1.98.0, unix-only
tests). No packaged/installed build; packaging stays V5/integrator owned.
Real-model spend: ~$0.09 across leaf probes + ~$0.02 leader verification,
each call itemized in dogfood-evidence.md Checkpoint 2.

Unverified, missing, source defects, deliberate approved deltas:
- Full autonomous workerStart-with-real-model-callback dogfood: open.
- ask/reply/check, worker-stop/abandon signal paths, reuse-session
  (unimplemented, returns unsupported_feature), 26 extra catalog harness
  ids: open, listed in evidence doc.
- argument_parity "2 passed" style counts include the real-model skip-path
  pass; documented, not silent.
- Windows: daemon serve/token/endpoint unix-gated (UnsupportedPlatform);
  V5 answered via ROOT relay (pipe name confirmed, gates retained).
- V4 trigger->dispatch: no path exists in V1 code; dispatch-side
  guarantees + spec request sent via ROOT relay.

Dependencies requested; next bounded checkpoint:
None blocking. Next: cancellation/mail/receipts concurrent+rollback+reopen
tests, then remaining command/harness families. Needs ROOT: relay of V5/V4
seam answers (direct cross-run sends blocked by dispatch_run_mismatch;
pledged to keep peer sends through ROOT).

Owned processes: session/incarnation/host, settlement/release receipts:
Dogfood Sonnet dispatch ctx_74c4337fef08 completed, follow-up
ctx_91fc08a58e1c completed, terminal released (released). GLM dispatch
ctx_0fc9be2fe56c completed, terminal retained/external (no process action);
follow-up ctx_b04f2bbd182f completed/succeeded/settled (worker_done transport
rejected but state settled; content verified by leader re-run). Ephemeral
daemon data dirs removed per-test; no surviving processes. Retained GLM
terminal term_a89aa8cb-e027-471c-9a8c-a2cfba19b8df idle at prompt, reusable.

Rollback; data/credentials/privacy check:
Nothing durable outside the worktree; tempdirs removed. No credentials
written/copied/provisioned (real-model leg reuses host Keychain creds,
never persists them). Rollback: revert this commit; no migrations.

Ready for independent review: yes (not self-accepted).
