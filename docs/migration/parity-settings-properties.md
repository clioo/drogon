# Settings properties census (bounded checkpoint, metadata only)

Top-level `GlobalSettings` declared fields plus builder defaults at frozen
source `c9790628`. Companion machine record:
`docs/migration/parity-settings-properties.json` (schema
`drogon.parity-settings-properties/2`, per-field rows with anchors).
No expression evaluated, nothing executed. This is **not per-field
UI/behavior closure**.

Recheck the metadata with `node scripts/check-parity-settings-properties.mjs`
(optional argument: another clean clone at the pinned source commit). This
checks hashes, declaration names/optional flags, exact locations, default
expressions/literals and summary counts; it does not run source behavior.

## 1. Counts derived from rows

Declared fields **214** (107 optional) in
`src/shared/global-settings-types.ts` (`export type GlobalSettings`).
Builder `buildDefaultSettings`
(`src/shared/default-global-settings.ts:20-31`) assigns
**187** keys. Coordinator AST verification found **143 direct literals**:
88 booleans (46 false), 33 strings, 10 numbers and 12 nulls. The remaining
44 values are 11 member expressions, 10 object expressions, 12 arrays,
8 identifiers, 2 calls and one binary expression. Exact source expressions
are retained in JSON without executing them. Imported/nested spread values
remain unresolved. The previous first-line extraction and its literal
counts were incorrect and are superseded by these AST-derived values.
**27 fields have no builder
default** (notably `keybindings`, `telemetry`, `hostSettingOverrides`,
`localAgentRuntime`, `localAgentWslDistro`, `computerAwakeMode`) — they
hydrate via migration/store or stay undefined: persistence-path follow-up.

Absent default ≠ null/false: 12 explicit `null`s and 46 explicit `false`s
are recorded as literals; absent means the
builder never assigns the key. Platform defaults live in callers, not the
builder (`getDefaultSettings`, `src/shared/constants.ts:164-178`:
workspace dir, fonts, middle-click paste + Linux stamp,
right-click-to-paste, notification/voice objects); the single in-builder
platform note is `showMenuBarIcon` default-true acting on darwin only.

## 2. Entrypoints (source evidence, not execution)

Defaults builder, platform injection (`constants.ts:164-178`),
load normalization (`normalize-loaded-global-settings.ts:16-60`: defaults
spread first, retired-stripped persisted settings over them, per-domain
normalizers + migration flags), profile preparation
(`prepare-loaded-profile-settings.ts` — body not fully read: gap),
persistence file (`user-data-path.ts:16-29`, `orca-data.json` + githubCache
sidecar), per-domain normalizers (no single `normalizeGlobalSettings`).
Tests: `state-write-round-trip.test.ts:77`,
`persisted-state-redundancy.test.ts`,
`project-execution-runtime.test.ts:41-54`,
`source-control-ai.test.ts:368`.

## 3. Target hypotheses (83 name-based suggestions; all 214 mappings unverified)

Prefix-based hypotheses, not verified UI bindings (terminal,
quick-commands, notifications, voice, shortcuts, ssh, mobile*,
linear, agents, automations, plugins, artifacts, orchestration, browser,
general-workspace, tasks). JSON uses `targetHypothesis`, never an accepted
target mapping. There are 131 fields without even a name-based suggestion;
all 214 actual UI/persistence associations remain verification obligations.

Coordinator checked the 214 declaration names and optional flags and the
187 direct builder properties against Babel AST nodes without evaluating
source. Their reported line anchors and source expressions were corrected
mechanically to the actual AST locations. The builder has zero top-level
spreads; imported sets occur within property values, not additional
top-level settings fields. This does not verify composite values or behavior.

## 4. Hashes, gaps

Per-read-file SHA256 in JSON `files`. Gaps: unresolved nested spreads/calls,
caller-injected resolution, 27
absent-default hydration paths, profile-preparation body, no UI/behavior
closure. Follow-up: full persistence-path inventory + per-field UI mapping.
