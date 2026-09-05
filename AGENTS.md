# Drogon rewrite

- Current scope is the approved Drogon rewrite. Follow the current Task's narrower phase, file ownership and acceptance criteria; implementation starts only after the coordinator accepts its prerequisite gates.
- Write only in this repository and your assigned paths. The previous implementation at `/Users/carlos/Documents/Drogon-mentu-session` is an explicitly authorized read-only migration reference, not an editing target. Never modify credentials, global settings or frozen challenge inputs.
- Coordinator owns shared files, root manifests/lockfiles, Git commits/pushes, repository operations and integration. Workers must not commit, push, open PRs, install dependencies or start background services unless explicitly assigned that scoped action.
- Use the live Orca Task/Dispatch instructions. No nested Agent, Fork, subagent, child task or new Run. Report failure honestly and stop after `worker_done`.
- For future coordinator launches, the user requests non-interactive tool permissions: Claude and AGY use `--dangerously-skip-permissions`; this OpenCode version uses `--auto` (explicit denies remain enforced). Apply per invocation, not global settings. This does not expand task ownership or authorize destructive/out-of-scope operations.
- Use `apply_patch` for file edits when available. Never include secrets or raw provider transcripts in tracked files.
- Preserve upstream copyright/license notices for reused code. Do not copy old cloud credentials, telemetry destinations, update feeds or private artifacts.
- Future architecture: Rust core/service/CLI with versioned contracts; Electron renderer isolated from execution. Reuse the established Orca visual system. All features require real tests, not model assertions.
- Preserve SSH host ownership, folder workspaces and remote mixed-version compatibility. Loss of contact means `unverifiable`, never proof of process exit. Use `live` / `unverifiable` / `exited` for liveness verdicts.
- Use domain-specific filenames, concise non-obvious comments, platform-appropriate paths/shortcuts, and no max-lines lint overrides. Follow the prior source's applicable design and execution-boundary references before migrating those subsystems.
- Mentu recipes, when created or edited, require the installed official writing-recipes skill and successful `mentu-recipes check` and `mentu-recipes doctor --strict`. Raw run records are not proof of formal Commitment Protocol records.
