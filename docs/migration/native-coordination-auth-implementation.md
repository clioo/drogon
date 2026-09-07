# Native coordination authentication

This slice verifies dispatch credentials at the real daemon entry point. It does not issue credentials or implement orchestration mail, attempts, final reports, or revoked-receipt recovery. It does not advertise orchestration.native.v1.

## Implementation

- An additive coordination_access v1 migration runs within the existing aggregate startup transaction. Only SHA-256 digests are stored, bound to host, run, task, dispatch, session and incarnation. Internal registration/revocation hooks are not RPCs.
- The admin service credential retains its existing dispatcher. Worker credentials enter a separate dispatcher and may only request status or their own typed send/check/ask/reply/requestShow scope. Other methods and coordinator/bootstrap scopes fail before receipts or effects.
- The authenticated WorkerBinding retains its credential digest privately. Each later transaction must recheck that exact digest and every identity field, not merely look up the dispatch ID. Debug output omits the digest; raw secrets are never stored in the binding.
- Status is implemented. The five scoped orchestration methods currently return method_not_found after authorization. Their future transaction bodies must recheck the binding inside the same transaction as their effects; the entry check is not sufficient.

## Independent review evidence (2026-09-07)

The initial worker revision discarded the binding and entered the admin dispatcher. Its follow-up introduced a separate worker dispatcher and a real revocation-race regression.

Root then reproduced a further failure: after genuine authorization, changing the stored host still allowed the stale binding to obtain status. The regression failed at the host case before the fix. After exact digest/full-binding rechecking, that test passes for host, run, task, session, incarnation and digest replacements, alongside the separately committed revocation case. Core library result: 73 passed, 0 failed.

Root replaced the socket fixture's unjoined server thread and external sqlite3/shasum commands with the compiled drogond executable and cached rusqlite/sha2 test dependencies. Each daemon runs with a cleared environment, private temporary directory, bounded startup/socket deadlines and exact child cleanup on fixture drop. Five real executable/socket tests pass: valid worker status, raw session refusal with no receipt/session effects, scope and coordinator escalation refusal, revoked credential refusal and unchanged admin status.

The nine Engine-entry integration tests are direct Engine/SQLite tests, not daemon subprocess tests. Unknown-credential denial before fixture registration is a negative case, not a historical RED regression. The worker also recorded a genuine admin-only callsite RED using its earlier socket fixture in .preflight/native-auth/evidence.md.

Existing startup atomicity coverage now expects the additive schema version. The remaining dead-code warnings identify seams awaiting integration; no warning suppression is used for registration/revocation. Unix executable/socket coverage does not establish Windows transport or remote-host parity.

## Remaining integration

workerStart must mint and register the credential atomically with attempt/session admission, then inject only the scoped credential into the exact child. Attempt settlement and cancellation must revoke in the same transaction as domain changes. Mail/report/receipt paths must use the bound actor and transaction-scoped recheck, including explicitly designed recovery for a settled credential. No production registration or lifecycle effect is claimed here.
