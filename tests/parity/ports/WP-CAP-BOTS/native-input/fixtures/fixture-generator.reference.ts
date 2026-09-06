// Not part of the pinned/admitted source baseline: a throwaway generator
// added only to this freshly-staged, hash-verified capsule so the actual
// pinned parsers can be executed on a bounded fixture battery to produce
// cross-language expected values for the native Rust port. Writes its
// output to the worker's own tests/parity/ports/WP-CAP-BOTS/native-input/
// directory (an absolute path outside this capsule), never back into the
// read-only source checkout.
import { writeFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  parseBotCreate,
  parseBotUpdate,
  parseBotSession,
  parseResponsibilityCreate,
  parseBotId
} from './bot-schemas'

const PARSERS: Record<string, (v: unknown) => unknown> = {
  botCreate: parseBotCreate,
  botUpdate: parseBotUpdate as (v: unknown) => unknown,
  botSession: parseBotSession,
  responsibilityCreate: parseResponsibilityCreate,
  botId: parseBotId
}

const HARNESS_IDS = [
  'claude', 'claude-agent-teams', 'openclaude', 'codex', 'autohand', 'opencode',
  'mimo-code', 'pi', 'omp', 'gemini', 'antigravity', 'aider', 'goose', 'amp',
  'kilo', 'kiro', 'crush', 'aug', 'cline', 'codebuff', 'command-code', 'continue',
  'cursor', 'droid', 'kimi', 'mistral-vibe', 'qwen-code', 'rovo', 'hermes',
  'openclaw', 'copilot', 'grok', 'devin', 'ante', 'trae', 'prime-agent'
]

const CHARACTER_PRESETS = [
  'none', 'arya', 'tyrion', 'jon-snow', 'daenerys', 'varys', 'ned-stark',
  'samwell', 'cersei', 'jaime', 'sansa', 'bran', 'brienne', 'the-hound',
  'melisandre', 'robb', 'oberyn', 'hodor'
]

const baseCreate = () => ({
  characterPreset: 'samwell',
  displayIdentity: { displayName: 'Archivist', handle: null, title: 'Researcher' },
  harnessPolicy: { defaultHarness: 'codex', explicitModel: null },
  instructions: 'Keep evidence linked.',
  memories: []
})

const baseResponsibilitySchedule = () => ({
  projectId: 'repo-1',
  workspaceMode: 'new_per_run',
  timezone: 'UTC',
  rrule: 'FREQ=DAILY',
  dtstart: 1
})

type Fixture = { id: string; parser: keyof typeof PARSERS; input: unknown }

const fixtures: Fixture[] = []
function fx(id: string, parser: keyof typeof PARSERS, input: unknown) {
  fixtures.push({ id, parser, input })
}

// --- parseBotCreate ---
fx('bot_create/valid_default', 'botCreate', baseCreate())
fx('bot_create/unknown_top_level_field', 'botCreate', { ...baseCreate(), privileged: true })
fx('bot_create/nonempty_responsibilities_rejected', 'botCreate', {
  ...baseCreate(),
  responsibilities: [{ id: 'renderer-invented-responsibility' }]
})
fx('bot_create/empty_responsibilities_accepted', 'botCreate', { ...baseCreate(), responsibilities: [] })
fx('bot_create/null_current_session_accepted', 'botCreate', { ...baseCreate(), currentSession: null })
fx('bot_create/non_null_current_session_rejected', 'botCreate', {
  ...baseCreate(),
  currentSession: { sessionId: 'x', harness: 'codex', model: null, startedAt: 1 }
})
fx('bot_create/nested_unknown_field_display_identity', 'botCreate', {
  ...baseCreate(),
  displayIdentity: { displayName: 'Archivist', handle: null, title: 'Researcher', extra: 'nope' }
})
fx('bot_create/nested_unknown_field_harness_policy', 'botCreate', {
  ...baseCreate(),
  harnessPolicy: { defaultHarness: 'codex', explicitModel: null, extra: 'nope' }
})
fx('bot_create/display_name_trimmed', 'botCreate', {
  ...baseCreate(),
  displayIdentity: { displayName: '  Archivist  ', handle: null, title: null }
})
fx('bot_create/display_name_whitespace_only_rejected', 'botCreate', {
  ...baseCreate(),
  displayIdentity: { displayName: '   ', handle: null, title: null }
})
fx('bot_create/display_name_string_handle_and_title_accepted', 'botCreate', {
  ...baseCreate(),
  displayIdentity: { displayName: 'Archivist', handle: 'archivist', title: 'Researcher' }
})
fx('bot_create/display_identity_missing_handle_rejected', 'botCreate', {
  ...baseCreate(),
  displayIdentity: { displayName: 'Archivist', title: 'Researcher' }
})
fx('bot_create/memories_exactly_1000_accepted', 'botCreate', {
  ...baseCreate(),
  memories: Array.from({ length: 1000 }, (_, i) => `memory-${i}`)
})
fx('bot_create/memories_1001_rejected', 'botCreate', {
  ...baseCreate(),
  memories: Array.from({ length: 1001 }, (_, i) => `memory-${i}`)
})
fx('bot_create/memories_non_string_element_rejected', 'botCreate', {
  ...baseCreate(),
  memories: [42]
})
fx('bot_create/instructions_262144_codepoint_accepted', 'botCreate', {
  ...baseCreate(),
  instructions: 'a'.repeat(262_144)
})
fx('bot_create/instructions_262145_codepoint_rejected', 'botCreate', {
  ...baseCreate(),
  instructions: 'a'.repeat(262_145)
})
// DISCOVERED SOURCE BEHAVIOR (see native-input evidence): zod v4.5.4's
// string .max()/.min() counts Unicode CODE POINTS (zod's own
// util.codePointLength: UTF-16 units minus valid surrogate-pair count), not
// JS's native UTF-16 .length. A string whose UTF-16 length exceeds the
// declared max but whose *code point* length does not is still accepted.
// 131072 U+1F600 emoji + 'a' = 262146 UTF-16 units (over the 262144 bound)
// but only 131073 code points (well under it) -- accepted, not rejected.
fx('bot_create/instructions_utf16_length_over_limit_codepoint_length_under_limit_accepted', 'botCreate', {
  ...baseCreate(),
  instructions: '\u{1F600}'.repeat(131_072) + 'a'
})
for (const preset of CHARACTER_PRESETS) {
  fx(`bot_create/character_preset_${preset}_accepted`, 'botCreate', { ...baseCreate(), characterPreset: preset })
}
fx('bot_create/character_preset_invalid_rejected', 'botCreate', { ...baseCreate(), characterPreset: 'invented' })
for (const harness of HARNESS_IDS) {
  fx(`bot_create/harness_${harness}_accepted`, 'botCreate', {
    ...baseCreate(),
    harnessPolicy: { defaultHarness: harness, explicitModel: null }
  })
}
fx('bot_create/harness_invalid_rejected', 'botCreate', {
  ...baseCreate(),
  harnessPolicy: { defaultHarness: 'invented-harness', explicitModel: null }
})
fx('bot_create/explicit_model_string_rejected', 'botCreate', {
  ...baseCreate(),
  harnessPolicy: { defaultHarness: 'codex', explicitModel: 'gpt-5' }
})
fx('bot_create/instructions_missing_rejected', 'botCreate', (() => {
  const { instructions, ...rest } = baseCreate() as Record<string, unknown>
  return rest
})())
fx('bot_create/handle_absent_rejected', 'botCreate', {
  ...baseCreate(),
  displayIdentity: (() => {
    const identity = { displayName: 'Archivist', handle: null, title: null } as Record<string, unknown>
    delete identity.handle
    return identity
  })()
})
fx('bot_create/not_an_object_rejected', 'botCreate', 'a string, not an object')

// --- parseBotUpdate ---
fx('bot_update/empty_object_accepted', 'botUpdate', {})
fx('bot_update/instructions_only_accepted', 'botUpdate', { instructions: 'Updated.' })
fx('bot_update/memories_only_accepted', 'botUpdate', { memories: ['a', 'b'] })
fx('bot_update/unknown_responsibilities_field_rejected', 'botUpdate', { responsibilities: [] })
fx('bot_update/unknown_current_session_field_rejected', 'botUpdate', { currentSession: null })
fx('bot_update/full_partial_accepted', 'botUpdate', {
  characterPreset: 'arya',
  displayIdentity: { displayName: 'Arya', handle: null, title: null },
  harnessPolicy: { defaultHarness: 'claude', explicitModel: null },
  instructions: 'Be quiet.',
  memories: ['a girl has no name']
})
fx('bot_update/invalid_character_preset_rejected', 'botUpdate', { characterPreset: 'invented' })

// --- parseBotSession ---
fx('bot_session/valid_accepted', 'botSession', { sessionId: 'session-1', harness: 'codex', model: null, startedAt: 1 })
fx('bot_session/unsupported_harness_rejected', 'botSession', {
  sessionId: 'session-1', harness: 'invented-harness', model: null, startedAt: 1
})
fx('bot_session/rotated_at_field_rejected', 'botSession', {
  sessionId: 'session-1', harness: 'codex', model: null, startedAt: 1, rotatedAt: null
})
fx('bot_session/model_string_rejected', 'botSession', {
  sessionId: 'session-1', harness: 'codex', model: 'gpt-5', startedAt: 1
})
fx('bot_session/started_at_negative_rejected', 'botSession', {
  sessionId: 'session-1', harness: 'codex', model: null, startedAt: -1
})
fx('bot_session/started_at_zero_accepted', 'botSession', {
  sessionId: 'session-1', harness: 'codex', model: null, startedAt: 0
})
fx('bot_session/session_id_whitespace_only_rejected', 'botSession', {
  sessionId: '   ', harness: 'codex', model: null, startedAt: 1
})
fx('bot_session/session_id_trimmed', 'botSession', {
  sessionId: '  session-1  ', harness: 'codex', model: null, startedAt: 1
})

// --- parseResponsibilityCreate ---
fx('responsibility/scheduled_valid_accepted', 'responsibilityCreate', {
  name: 'Daily watch',
  instructions: 'Inspect the workspace.',
  kind: 'scheduled',
  schedule: baseResponsibilitySchedule()
})
fx('responsibility/reactive_with_schedule_rejected', 'responsibilityCreate', {
  name: 'Invalid reactive schedule',
  instructions: 'Do not accept mixed trigger semantics.',
  kind: 'reactive',
  schedule: baseResponsibilitySchedule()
})
fx('responsibility/scheduled_without_schedule_rejected', 'responsibilityCreate', {
  name: 'Missing schedule',
  instructions: 'Needs a schedule.',
  kind: 'scheduled'
})
fx('responsibility/scheduled_with_nonempty_event_rejected', 'responsibilityCreate', {
  name: 'Bad event',
  instructions: 'No event on scheduled.',
  kind: 'scheduled',
  event: 'some-event',
  schedule: baseResponsibilitySchedule()
})
fx('responsibility/scheduled_with_empty_string_event_accepted', 'responsibilityCreate', {
  name: 'Empty event is falsy',
  instructions: 'Empty string event is JS-falsy, so the source superRefine check does not fire.',
  kind: 'scheduled',
  event: '',
  schedule: baseResponsibilitySchedule()
})
fx('responsibility/scheduled_with_null_event_accepted', 'responsibilityCreate', {
  name: 'Null event',
  instructions: 'Null event is allowed on scheduled.',
  kind: 'scheduled',
  event: null,
  schedule: baseResponsibilitySchedule()
})
fx('responsibility/reactive_with_event_accepted', 'responsibilityCreate', {
  name: 'Reactive with event',
  instructions: 'React to this.',
  kind: 'reactive',
  event: 'file-saved'
})
fx('responsibility/reactive_without_event_accepted', 'responsibilityCreate', {
  name: 'Reactive no event',
  instructions: 'React generically.',
  kind: 'reactive'
})
fx('responsibility/unknown_field_in_schedule_rejected', 'responsibilityCreate', {
  name: 'Bad schedule field',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), extra: 'nope' }
})
fx('responsibility/workspace_id_null_accepted', 'responsibilityCreate', {
  name: 'workspaceId null',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), workspaceId: null }
})
fx('responsibility/workspace_id_absent_accepted', 'responsibilityCreate', {
  name: 'workspaceId absent',
  instructions: 'x',
  kind: 'scheduled',
  schedule: baseResponsibilitySchedule()
})
fx('responsibility/workspace_id_string_accepted', 'responsibilityCreate', {
  name: 'workspaceId string',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), workspaceId: 'ws-1' }
})
fx('responsibility/workspace_mode_invalid_rejected', 'responsibilityCreate', {
  name: 'bad workspace mode',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), workspaceMode: 'invented' }
})
fx('responsibility/precheck_valid_accepted', 'responsibilityCreate', {
  name: 'precheck valid',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), precheck: { command: 'npm test', timeoutSeconds: 60 } }
})
fx('responsibility/precheck_null_accepted', 'responsibilityCreate', {
  name: 'precheck null',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), precheck: null }
})
fx('responsibility/precheck_unknown_field_rejected', 'responsibilityCreate', {
  name: 'precheck unknown field',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), precheck: { command: 'npm test', timeoutSeconds: 60, extra: 1 } }
})
fx('responsibility/precheck_timeout_zero_rejected', 'responsibilityCreate', {
  name: 'precheck timeout zero',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), precheck: { command: 'npm test', timeoutSeconds: 0 } }
})
fx('responsibility/precheck_timeout_86400_accepted', 'responsibilityCreate', {
  name: 'precheck timeout max',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), precheck: { command: 'npm test', timeoutSeconds: 86_400 } }
})
fx('responsibility/precheck_timeout_86401_rejected', 'responsibilityCreate', {
  name: 'precheck timeout over max',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), precheck: { command: 'npm test', timeoutSeconds: 86_401 } }
})
fx('responsibility/precheck_timeout_non_integer_rejected', 'responsibilityCreate', {
  name: 'precheck timeout non integer',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), precheck: { command: 'npm test', timeoutSeconds: 1.5 } }
})
fx('responsibility/setup_decision_valid_accepted', 'responsibilityCreate', {
  name: 'setup decision',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), setupDecision: 'inherit' }
})
fx('responsibility/setup_decision_invalid_rejected', 'responsibilityCreate', {
  name: 'setup decision invalid',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), setupDecision: 'invented' }
})
fx('responsibility/reuse_session_accepted', 'responsibilityCreate', {
  name: 'reuse session',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), reuseSession: true }
})
fx('responsibility/base_branch_null_accepted', 'responsibilityCreate', {
  name: 'base branch null',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), baseBranch: null }
})
fx('responsibility/base_branch_string_accepted', 'responsibilityCreate', {
  name: 'base branch string',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), baseBranch: 'main' }
})
fx('responsibility/name_whitespace_only_rejected', 'responsibilityCreate', {
  name: '   ',
  instructions: 'x',
  kind: 'reactive'
})
fx('responsibility/name_trimmed', 'responsibilityCreate', {
  name: '  Daily watch  ',
  instructions: 'x',
  kind: 'reactive'
})
fx('responsibility/enabled_false_accepted', 'responsibilityCreate', {
  name: 'disabled',
  instructions: 'x',
  kind: 'reactive',
  enabled: false
})
fx('responsibility/dtstart_negative_rejected', 'responsibilityCreate', {
  name: 'bad dtstart',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), dtstart: -1 }
})
fx('responsibility/timezone_whitespace_only_rejected', 'responsibilityCreate', {
  name: 'bad timezone',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), timezone: '   ' }
})
fx('responsibility/rrule_trimmed', 'responsibilityCreate', {
  name: 'rrule trim',
  instructions: 'x',
  kind: 'scheduled',
  schedule: { ...baseResponsibilitySchedule(), rrule: '  FREQ=DAILY  ' }
})

// --- parseBotId ---
fx('bot_id/trimmed', 'botId', '  abc  ')
fx('bot_id/whitespace_only_rejected', 'botId', '    ')
fx('bot_id/empty_rejected', 'botId', '')
fx('bot_id/max_16384_accepted', 'botId', 'a'.repeat(16_384))
fx('bot_id/16385_rejected', 'botId', 'a'.repeat(16_385))
fx('bot_id/not_a_string_rejected', 'botId', 12345)
fx('bot_id/unicode_combining_accepted', 'botId', 'e\u0301\u0301') // e + combining acute x2, plain codepoints, well under bound
// Code-point (not UTF-16-unit) boundary: 16384 emoji = 32768 UTF-16 units
// but exactly 16384 code points -- at the max, accepted. 16385 emoji is one
// code point over -- rejected. See the discovered-behavior note above.
fx('bot_id/codepoint_max_16384_accepted', 'botId', '\u{1F600}'.repeat(16_384))
fx('bot_id/codepoint_16385_rejected', 'botId', '\u{1F600}'.repeat(16_385))
fx('bot_id/utf16_length_over_limit_codepoint_length_under_limit_accepted', 'botId', '\u{1F600}'.repeat(8_192) + 'a')

// --- Root review 2026-09-06 16:49 UTC regressions: js_trim char set and
// finite-nonnegative timestamp precision, executed against the actual
// pinned parser (never hand-authored expected values). ---
fx('bot_id/feff_trimmed', 'botId', '\uFEFFabc\uFEFF')
fx('bot_id/u0085_retained', 'botId', '\u0085abc\u0085')
fx('bot_id/u001c_retained', 'botId', '\u001Cabc\u001C')
fx('bot_id/u200b_retained', 'botId', '\u200Babc\u200B')

const timestampCase = (id: string, startedAt: number) =>
  fx(id, 'botSession', { sessionId: 'session-1', harness: 'codex', model: null, startedAt })
timestampCase('bot_session/timestamp_0_accepted', 0)
timestampCase('bot_session/timestamp_0_5_accepted', 0.5)
timestampCase('bot_session/timestamp_2pow64_minus_2048_accepted', 2 ** 64 - 2048)
timestampCase('bot_session/timestamp_2pow64_accepted', 2 ** 64)
timestampCase('bot_session/timestamp_2pow64_plus_4096_accepted', 2 ** 64 + 4096)
timestampCase('bot_session/timestamp_number_max_value_accepted', Number.MAX_VALUE)

describe('native-input fixture dump (generator, not a behavioral assertion)', () => {
  it('executes every fixture through the actual pinned source parser and writes cross-language expected values', () => {
    const results = fixtures.map(({ id, parser, input }) => {
      const fn = PARSERS[parser]
      try {
        const output = fn(input)
        return { id, parser, input, expect: 'accept', output }
      } catch (error) {
        return {
          id,
          parser,
          input,
          expect: 'reject',
          errorName: error instanceof Error ? error.constructor.name : 'UnknownError'
        }
      }
    })
    const outPath =
      '/Users/carlos/Documents/Drogon-rewrite/tests/parity/ports/WP-CAP-BOTS/native-input/fixtures/expected.json'
    writeFileSync(outPath, JSON.stringify({ schemaVersion: 1, count: results.length, fixtures: results }, null, 2))
    expect(results.length).toBe(fixtures.length)
  })
})
