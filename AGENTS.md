# Drogon rewrite

- Current scope is environment and three-harness orchestration preflight, not product implementation.
- Work only in this repository and your assigned `.preflight/<lane>/` directory. Do not edit other workspaces, credentials, global settings, tests or challenge inputs.
- Coordinator owns shared files, Git commits/pushes, repository operations and integration. Workers must not commit, push, open PRs, install dependencies or start background services in the preflight.
- Use the live Orca Task/Dispatch instructions. No nested Agent, Fork, subagent, child task or new Run. Report failure honestly and stop after `worker_done`.
- For future coordinator launches, the user requests non-interactive tool permissions: Claude and AGY use `--dangerously-skip-permissions`; this OpenCode version uses `--auto` (explicit denies remain enforced). Apply per invocation, not global settings. This does not expand task ownership or authorize destructive/out-of-scope operations.
- Use `apply_patch` for file edits when available. Never include secrets or raw provider transcripts in tracked files.
- Preserve upstream copyright/license notices for reused code. Do not copy old cloud credentials, telemetry destinations, update feeds or private artifacts.
- Future architecture: Rust core/service/CLI with versioned contracts; Electron renderer isolated from execution. Reuse the established Orca visual system. All features require real tests, not model assertions.
