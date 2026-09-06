# Root persisted declaration review

2026-09-06, 18:08 UTC. Current UI leaf: `ctx_323c1f3d8f61`, under Sol
`ctx_ccc470781ffd`. This is interim independent review, not final acceptance.

The read-only `scripts/verify-persisted-renderer-declarations.mjs` compares
candidate declarations and constant initializers against named files at source
pin `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. It uses existing Babel 7.29.8
through the desktop React plugin on Node v24.19.0; no dependency was installed
and no source module executed. `--details` adds source/candidate hashes and
per-declaration results. It requires the retained local source checkout; it is
not a portable CI gate or proof of import resolution/complete type selection.

Initial executable result: **128/129 declaration matches, exit 1**. The mismatch
is `SleepingAgentSessionRecord`, whose candidate hash was
`672db82f3b5cacec72004d5e0a4ac4bdd987b683cf7c67084fe82e9fab3dc7fc`.
Direct source inspection confirmed two omitted fields:
`automaticResumeBlockedBy?: 'legacy-orchestration-worker'` and
`restoreOnTabOpenOnly?: boolean`. These preserve orchestration reconciliation
and deferred cold-restoration intent. Root sent correction `msg_373b47ee996e`
to Sol for the same GLM; no root candidate implementation edit was made.

The four top-level declarations already matched: `PersistedOpenFile` (11
fields), `WorkspaceSessionState` (33), `WorkspaceSessionPatch`, and
`PersistedUIState` (115). Matching their declaration bodies does not validate
referenced imports or durable behavior. Root also requested reuse of the
exported generic checkpoint dependency type, and explicit treatment of the
test configuration's inherited `skipLibCheck: true` (`msg_c2dd40e4d65b`).

An earlier ad-hoc attempt expected a TypeScript JavaScript compiler API that
the installed TypeScript 7 package does not expose; it did not run a comparison.
The verified Babel comparison above supersedes that setup failure. No runtime
restart defect is claimed reproduced by these static checks.

## Independent post-correction check

The same unchanged comparator subsequently returned **129/129, exit 0** after
the GLM correction on `task_fa4d182c67ce / ctx_f2f252e21be9` (same terminal,
verified live at depth 2). Corrected `agent-session-resume.ts` SHA256:
`0869d62614f45ab5216be56bd6a73b27b631f2fab1b8eef821c9206da3374d10`.
Root confirmed both fields appear in the positive fixture and the invalid
blocking discriminator in the negative compile fixture. The envelope now aliases
the exported `ShutdownCheckpointPersistDeps` generic directly. Fixture presence
is not proof those tests pass; final leaf/lead results and root admission remain
pending. No candidate contract files are committed by this review checkpoint.
