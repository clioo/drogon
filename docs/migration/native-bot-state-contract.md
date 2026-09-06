# Native Bot state and responsibility ownership

Next CAP dependency after input-parser acceptance, not a replacement for Bot
execution. Source pin: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.
Root read the complete Bot service, persistence implementation, owner/history
projection, session rotation, shared normalization and IPC admission modules,
plus the Bot-owned automation persistence tests. This document does not launch
another worker or transfer ownership from an active task.

## One native store, distinct lifetimes

Use the existing host-owned SQLite connection in `drogon-core::Engine`. New Bot
tables/migrations must join that connection, not open another database or copy the
TypeScript store. Bot identity persists independently of PTY sessions. Rotating a
conversation must not reset instructions, memories, character, responsibilities
or history. A stored session reference is not proof of process liveness.

Keep input admission separate from persisted-data normalization. The source
normalizer has legacy defaults and permits stored model strings that the current
IPC parser rejects. Reusing the strict parser to load history would discard valid
existing data. Preserve every field and distinguish malformed records from absent
records; never silently replace an unreadable database with an empty Bot list.
Any source migration behavior that drops malformed projections must be explicit,
tested, and leave the original import recoverable rather than overwrite user data.

Normalize names, handles and titles with actual ECMAScript trim. Handles also
remove leading `@`; empty normalized handles/titles/models become null. Keep all
18 character choices, known-ID recognition, supported session references and
recipe references. IDs/timestamps are supplied by native production facilities;
tests can inject deterministic values without replacing production behavior.
Preserve original ordering semantics, including locale-aware display-name sorting;
binary UTF-8 sorting is not presumed equivalent. Escalate an unavailable collation
dependency instead of quietly narrowing the supported names.

## Ownership and atomicity

- Creating/updating a Bot preserves its ID and original creation time. Partial
  updates affect only submitted fields. Internal responsibility updates are not
  authorized merely because the public parser accepts other Bot updates.
- A scheduled responsibility must reference an existing automation owned by that
  Bot. Missing or foreign ownership is rejected before mutation. Reactive
  responsibilities do not acquire an automation merely to share a code path.
- Creating a scheduled responsibility and its automation must commit together.
  The original service compensates when updating the Bot fails; one SQLite
  transaction must retain that observable no-orphan guarantee, including reopen.
- Deleting a Bot preserves global automations and their run history, removes only
  their Bot ownership, and retains recorded execution evidence. Do not cascade
  into another Bot, workspace, automation or live process.
- Deleting a global automation removes its scheduled responsibility projections.
  Migration repairs ownership from real responsibility links, removes references
  to missing automations, and does not give one automation to two distinct Bots.
  Preserve source ordering when resolving legacy conflicting ownership.
- Recording a responsibility run checks Bot, responsibility, matching automation
  and actual automation-run link. A non-null automation-run ID deduplicates the
  record; updates preserve its ID and previous end/recipe/host observation when
  those incoming values are null. A null automation-run ID is not a global
  deduplication key.
- History is newest-first and retains orphaned evidence with null joins rather
  than inventing deleted responsibilities or inferred automation outcomes.
  `live` / `unverifiable` / `exited` observations remain evidence, not automation
  status or a Mentu completion verdict.

Automation records must be the native global automation authority, not a Bot-only
shadow copy. Preserve complete source automation fields and scheduling options.
Before adding their schema, inspect existing candidate work and coordinate root
ownership with the automation package. A test-only repository is not durable
integration. Real scheduler invocation belongs to its later execution gate, but
ownership checks must already use real records in the same transaction.

## Execution remains explicit

The Bot service delegates scheduled work through the automation runner. Disabled
responsibilities refuse execution. Reactive work cannot run from the manual
scheduled-run action: a connected deterministic adapter must supply the event.
The future adapter reserves durable receipts before opening a harness session;
polling without an event does not call a model. Proactive timers are deterministic
too; the agent's judgment after wakeup is the nondeterministic part.

Keep the Bot as accountable owner while its chosen harness performs the work with
the appropriate skills. Do not infer installed models from the known-ID catalog.
No external review, network subscription, cron activation or real recipe execution
is authorized by a storage test. Mentu links must come from actual run records.

## Tests-first acceptance

Port all assertions from the original Bot contract, responsibility-owner and
Bot-owned automation persistence suites. Keep the existing admitted baselines;
additional source runs need verified isolated capsules, never the reference cwd.
Cover create/update/list, both session rotations, normalization/defaults, owner
migration, scheduled creation rollback, Bot deletion without automation/history
loss, automation deletion, valid/invalid run links, deduplication and history joins.
Add actual SQLite reopen, two-connection stale update/ownership contention and
commit-failure rollback tests. Preserve host/folder scope and no cross-host reads.

Raw SQLite byte equality is not a JSON-store contract. Assert logical records,
transaction boundaries and reopened state. Record source baseline, genuine
assertion RED, native production GREEN and unresolved gaps separately. Final
acceptance requires real Engine/RPC/CLI callers and rendered Bot flows; passing
repository-unit tests alone does not establish a usable Bot feature.

Root owns shared schema registration, Engine/RPC/CLI contracts, imports from the
old profile, integration and installation. A future Sol-CAP dispatch must assign
exclusive implementation/test paths to one approved non-OpenAI leaf and retain
only direction/review work at Sol. Existing active parser ownership is unchanged.
