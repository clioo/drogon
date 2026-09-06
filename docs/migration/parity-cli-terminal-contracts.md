# Terminal CLI — 11 bounded source contracts

Coordinator-reviewed v2 at frozen source
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The JSON companion records
22 independently checked source hashes, exact cohort membership and anchors.
All11 terminal registry entries are included; switch's focus alias is not
a12th command. No terminal command or original test from this cohort ran.

## Targeting and defaults

Eight handlers use getTerminalHandle (selectors.ts:206-218):
show/read/send/wait/rename/switch/split/single-close. A nonempty explicit
terminal is used verbatim; otherwise terminal.resolveActive receives the
worktree selected by getBrowserWorktreeSelector (selectors.ts:175-201).
That helper maps all to undefined, resolves active/current locally, normalizes
other selectors for caller WSL context, and lets omitted remote context be
server-decided. Omitted local context attempts cwd resolution but catches
**all** errors, not only "not in a workspace." Failed discovery can therefore
fall back to an unfiltered active target; do not interpret this as host health.

List uses an optional worktree selector without cwd fallback. Stop and
close --all require an explicit worktree value. Those three paths do not
special-case all like the browser helper. Create uses the browser helper,
but first rejects a remote client lacking the worktree flag entirely.
An empty string or all can still reach the helper's undefined result.
Active/current are rejected against remote runtimes: client cwd is not host cwd.

## Per-command contracts

| Command | Observable CLI behavior |
| --- | --- |
| list | Text requests visual layouts by default; JSON only when the flag exists. Adds omitted-host selectors to the result in place before printing. Empty text list returns only empty-list text and scope; populated list can include topology/truncation. |
| show | agentWait undefined renders unknown/not evaluated; null renders none. These are not interchangeable. |
| read | Optional cursor is digits-only then parseInt, without safe-integer/finite bound. Empty cursor becomes omitted. Screen plus cursor rejects; screen with absent response source rejects as incompatible_runtime. screen-unavailable is allowed with an accumulated-output warning. Draft is composer text, not output. Limit uses the shared positive-integer validator. |
| send | Sends text/enter/interrupt and fixed client identity. agentPrompt is included only for truthy text plus enter without interrupt. Prints receipt then sets exitCode1 for any falsy accepted field. |
| wait | Requires a nonempty for string but does not validate its enum here. Positive domain timeout is forwarded separately from transport timeout: requested+5000ms, otherwise300000ms. Unsatisfied strictly-false result sets exitCode1. |
| stop | Hidden, deprecated compatibility path; worktree required. Still calls terminal.stop and prints a stopped count, with no CLI liveness classification. Its runtime effects were not traced. Missing destructive spec metadata is NOT proof the operation is nondestructive. |
| rename | Missing/empty title becomes null; spec describes resetting the automatic name. |
| create | Focus independently adds presentation:focused. Only local interactive classification adds rendererBacked:true and activate:focus. Remote focus still gets presentation without those renderer fields. |
| switch / focus | One canonical handler calls terminal.focus with fixed navigation:host. Text distinguishes navigated:false from successful focus. |
| close | Three RPC names in two branches: all -> closeAll; otherwise tab -> closeTab, else close. All rejects terminal/tab and requires worktree; worktree without all rejects. Bulk method_not_found becomes incompatible_runtime. |
| split | Direction validates exactly horizontal/vertical when nonempty; missing direction is forwarded undefined for the runtime to decide. |

The terminal-wait source comment mentions a historical15s generic timeout.
The inspected RuntimeClient constructor defaults to60000ms, not15000ms.
The explicit terminal-wait transport budget is established by its handler;
other transport/retry/host mechanics are not fully traced in this slice.

## Close failures are not uniform

- Single close: ptyKilled truthy OR missing verdict produces no CLI error.
  Otherwise live maps to terminal_stop_live; other supplied values map to
  terminal_stop_unverifiable. JSON emits a failure envelope retaining the close
  receipt; text prints the existing receipt. Both set exitCode1 on failure.
- Bulk close: falsy verdict produces no CLI error. A truthy verdict maps to
  live/unverifiable failure; there is **no ptyKilled bypass**. Both JSON and text
  call reportCliError; text is an error on stderr, not the single-close receipt.
- Single-close formatter returns tab-only text immediately for closeMode:tab.
  Otherwise a truthy kill flag adds "PTY killed."; literal live/unverifiable
  add warnings; missing or other verdict values add none. Do not claim a
  warning is always visible on every failing text path.
- Missing legacy verdict can yield a non-failing receipt without positive
  evidence of death. The process vocabulary remains live/unverifiable/exited;
  host unreachability is never an inferred exited verdict.

Anchors: handlers/terminal.ts:53-85,226-286;
terminal-format.ts:208-227; format.ts:132-158.
The host's actual stop implementation remains a separate obligation.

## JSON and omitted-host scope

printResult serializes the envelope; its screenshot helper returns unchanged
when result lacks screenshotStatus. This does not make every output raw server
data: list already added omittedHostSelectors, and close failures use an error
envelope. Missing hostScope prints an unverifiable scope, not complete coverage.
Omitted selectors describe selectability, not liveness. Paired environments
are read locally and SSH targets can require a round trip; this is not a ping.

## Independently checked test declarations — not execution

| Source-relative test under src/cli | Direct | Table rows | Total |
| --- | --- | --- | --- |
| index-terminal-list-host-scope.test.ts | 3 | 0 | 3 |
| terminal-format-draft.test.ts | 1 | 0 | 1 |
| index-terminal-commands.test.ts | 18 | 0 | 18 |
| terminal-list-host-scope-format.test.ts | 5 | 0 | 5 |
| terminal-read-screen.test.ts | 6 | 0 | 6 |
| terminal-format.test.ts | 4 | 0 | 4 |
| handlers/terminal.test.ts | 13 | 3 | 16 |
| Total | 50 | 3 | 53 |

Coordinator AST traversal verified these literal declarations/table rows and
all22 hashes without importing source modules. Names are routing pointers,
not per-assertion coverage. Full original test execution, runtime-side RPC
behavior, host ownership/version skews and candidate results remain owed.
Interactive classification's own function was read; deeper tokenization and
executable/subcommand helpers remain named, not independently characterized.
