# Native Bot input boundary

Next Sol-CAP dependency after accepting its baseline runner. This is production
input validation for the future Rust Bot service, not Bot execution, UI completion
or a separate desktop-owned store. Root read the full pinned `bot-schemas.ts`, its
three original tests, the relevant Bot contract, and `isTuiAgent` implementation.
Source revision: `c97906287bb7a390b25e2025b600d9fb3c25d9c3`.

## Ownership and reuse

Sol delegates to one approved non-OpenAI worker; no manual implementation fallback.
The worker owns `crates/drogon-core/src/bots/input.rs`,
`crates/drogon-core/tests/bot_input.rs`, and
`tests/parity/ports/WP-CAP-BOTS/native-input/**` only. Root owns module registration,
shared manifests, protocol, caller wiring, persistence, Git and installation.
Tests may temporarily include the actual production input module by path.

Use existing serde/serde_json; no new validation framework or dependency changes.
Expose pure native equivalents of all five source parsers: create, update,
session, responsibility create and ID. Normalized JSON values are acceptable at
this boundary; errors must carry a stable invalid-input category and field path,
without echoing instructions, memories, credentials or arbitrary input content.
Do not create a TypeScript backend to satisfy the old candidate-binding import.

## Compatibility requirements

- Preserve strict unknown-field rejection at every source strict-object boundary,
  nullable versus absent fields, array/string bounds, trim and JS UTF-16 lengths,
  finite nonnegative timestamps, precheck integer/time bounds and all enums.
  Do not add defaults the source parser does not insert.
- Cover all fields/branches of `bot-schemas.ts`, including partial updates,
  empty-only responsibilities on create, null-only session/model-policy inputs,
  omitted rotatedAt for session admission and reactive/scheduled exclusivity.
  The broader TypeScript types allowing strings are not authority to relax the
  narrower parser's null-only model policy at this migration boundary.
- The source knows 36 TUI agent IDs. Keep known-ID validation separate from
  installed/supported-launcher discovery, and from the 14 resumable identities.
  Consult existing `drogon-harness` definitions before introducing constants;
  ask root for any shared-catalog change instead of silently duplicating an
  inconsistent registry. Recognizing an ID never authorizes or proves a launch.
- Character IDs are plain identifiers here; do not copy or publish images while
  E5 resource provenance is held. The user's optional name UX resolves a selected
  character's default name before this strict payload boundary; do not invent a
  requirement for users to manually fill a name or weaken the source test.
- Preserve source responsibility semantics precisely: scheduled requires schedule,
  reactive forbids it, and scheduled forbids a nonempty event. No cron, script,
  agent launch, service or network execution belongs in validation.

## Evidence and gates

Reuse the admitted schema baseline (3 passed) and immutable source manifest in
`tests/parity/ports/WP-CAP-BOTS/source-baselines/schemas/`. Retain all original
assertions and normalized-output mappings; collection failure is not behavioral
RED. Record real assertion failures before implementation, then GREEN against
the actual Rust module. Add boundaries for every parser, nested unknown fields,
all harness/character IDs, absent/null distinctions, exact limits and Unicode.

Generate cross-language expected values by executing the actual pinned source
parser in the admitted isolated capsule with its pinned Zod, not by reimplementing
expected values in JavaScript. Verify source/dependency hashes before execution;
never run with the original checkout as cwd. Retain bounded synthetic fixtures
and concise receipts, not provider transcripts or user data. Test source/candidate
acceptance and normalized output for the same cases. Unexpected source behavior
must be reported, not silently fixed while claiming parity.

Completion of this slice means native validation reviewed and ready for root
registration. Full Bots still requires durable identities, chat/harness sessions,
deterministic reactive triggers, proactive responsibilities, visible script/skill
configuration, automations, Mentu links, UI and real execution evidence. This
dependency does not reduce that agreed scope or authorize a new install by itself.
