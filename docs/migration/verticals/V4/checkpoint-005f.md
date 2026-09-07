# V4 checkpoint-005f: W1 vacuous endedAt assertion fix (test-only)

Vertical / scope / base SHA / head SHA / branch / worktree:
V4 Capabilities on codex/vertical-04-capabilities, worktree
/Users/carlos/orca/workspaces/Drogon-rewrite/codex-vertical-04-capabilities.
Follows checkpoint-005e (1a5a3a9). W-track test fix only, per ROOT
msg_c061e9562fb3 (+ msg_9658ecaf5b07 same-fix note).

Capabilities and original contract/test IDs:
WP-CAP-BOTS history scope fence (W1/W2/W3 storage already accepted in
checkpoint-005b); this checkpoint fixes one vacuous test assertion, no
production change.

Changed paths; shared-file patch requested:
- crates/drogon-core/tests/bot_history_scope.rs ONLY (test file):
  record_responsibility_run_refuses_a_cross_scope_dedup_replay_against_a_fully_stamped_row
  replaced survivor["ended_at"] (missing snake_case key in the serde
  camelCase envelope, always Null: vacuous) with
  survivor.get("endedAt") == Some(&Value::Null); added byte-exact
  before/after payload pin (new raw_payload_json_string helper;
  raw_payload_json now delegates, same signature) proving a refused
  replay leaves the row untouched; trimmed overlong comments in the
  touched test to concise WHY style, no behavior change.
- This doc. No production files, no DDL, no new codes. Nothing requested
  of ROOT except the already-sent A6d stage proposal (separate track).

Baseline evidence; behavioral RED (honestly labeled); GREEN + counts:
Genuine RED without production edits: scratch check against a corrupted
payload {"endedAt": 1.0} showed the OLD form passing vacuously while the
NEW form failed with left Some(Number(1.0)) vs right Some(Null); scratch
removed before delivery. Leader independently re-ran:
cargo test -p drogon-core --locked --offline --test bot_history_scope ->
10 passed / 0 failed; cargo fmt -p drogon-core -- --check clean. Leaf
additionally reported clippy --all-targets -D warnings clean.
git status confirms exactly one modified file (two untracked WP-CAP
port dirs are pre-existing settled-dispatch remnants, untouched).

Integrated/rendered/platform evidence; exact package identity if applicable:
None (test-only change; fence behavior unchanged).

Unverified, missing, source defects, deliberate approved deltas:
A6d pure-stage implementation awaits ROOT approval of the forwarded
proposal; production comment trim in bots/storage.rs deferred to the
next stable checkpoint touching that file.
