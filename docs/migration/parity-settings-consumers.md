# Parity settings consumers — bounded AST reference census (E2 consumer routing)

**Bounded checkpoint, not full-coverage closure.** Summary only — full per-field references, exact line/receiver-evidence citations, and unresolved-bucket entries are in the machine companion `docs/migration/parity-settings-consumers.json` (schema `drogon.inventory.settings-consumers.v1`, status `bounded-checkpoint`), never repeated here. Read-only AST census across the frozen legacy checkout `/Users/carlos/Documents/Drogon-mentu-session` at `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (matches pinned baseline). No implementation, no execution of any original test/app/daemon. Canonical field list loaded from `docs/migration/parity-settings-properties.json` (declared field count 214).

## Status note

Bounded AST routing evidence, not type-checker proof or full E2 consumer coverage. Direct references require a syntactically traced annotation/return type; imports must resolve relatively to src/shared/global-settings-types.ts (not a matching basename), and re-exports do not introduce local bindings. Type-name collisions are conservatively excluded module-wide; value-name collisions are excluded function-wide, including destructured and catch bindings. Pick/Omit and union field restrictions apply to member accesses and literal writes. Untyped local getters cannot fall back to shadowed module getters. These are bounded approximations, not full lexical/type resolution. Files without the raw GlobalSettings token are not scanned. No observed reference never means unused; counts include test/default construction sites, not just observable UI consumers. Coordinator regression tests exposed13 false-positive forms and passed after correction; real-corpus counts did not change. No original test or product behavior executed.

## Scan scope

Candidate files = tracked *.ts/*.tsx files under src/ whose raw text contains the literal token "GlobalSettings" (via `git grep -lI`). out/ and node_modules/ are never tracked in this checkout and are never scanned.
Files enumerated: **472**; parsed: **472**; parse failures: **0**.

## Methodology

Two-mode AST resolution per module, no cross-file resolution: (a) does an identifier's own type annotation resolve to GlobalSettings or a field subset? (b) for an ObjectPattern destructure, does the CONTAINER type's named member resolve the same way? Both modes chase bounded same-module type-alias/interface hops (MAX depth 6) and unwrap Partial/Readonly/Required/Pick/Omit and non-null unions. A same-module (or same-scope parameter) getter whose declared return type resolves the same way is treated identically at its call sites. Every MemberExpression/OptionalMemberExpression on a confirmed receiver is classified read (default) or write (assignment/update-expression target). Every destructured field off a confirmed container is a read; an ObjectExpression that is the direct initializer of a settings-typed variable, or the direct return value of a settings-typed-returning function, has its own top-level non-computed non-spread keys recorded as writes. Anything the two modes cannot resolve this way (untyped aliases, computed/dynamic keys, `...rest`, unresolved containers) is recorded in a separate unresolved bucket, never guessed into a field reference.

## Counts

- `canonicalFieldCount`: **214**
- `filesEnumerated`: **472**
- `filesParsed`: **472**
- `filesParseFailed`: **0**
- `fieldsWithAtLeastOneReference`: **204**
- `fieldsWithNoObservedReference`: **10**
- `totalDirectReferences`: **1093**
- `readReferences`: **583**
- `writeReferences`: **510**
- `byReceiverEvidence`: `typed-return-object-literal`=450, `typed-param`=338, `typed-param-nested-container`=207, `typed-variable`=16, `typed-call-return`=72, `typed-variable-object-literal-init`=10
- `unresolvedAliasAccesses`: **1**
- `unresolvedCandidateAccesses`: **896**
- `unresolvedComputedDynamicAccesses`: **2**
- `unresolvedDestructureRestUnresolved`: **2**
- `unresolvedDestructureComputedUnresolved`: **0**

No percentage-complete or "fully mapped" figure is stated anywhere in this document. `no-observed-reference` is an explicit scan result, never an absence-of-usage claim (see Status note). Counts are reported candidly even where they are smaller after a correction pass than an earlier, less conservative run.

## Fields with no observed reference (this bounded scan)

no reference observed by this bounded scan across the prefiltered file set — NOT a claim that the field is unused anywhere in the source tree:

`browserSshWorkspaceRoutingProbeSkippedTargetIds`, `keybindings`, `dismissedSkillFreshnessNudges`, `experimentalSidekick`, `agentsSidebarIntroShown`, `agentsSidebarMigratedFromExperimental`, `experimentalAgentDashboardShowIdle`, `experimentalCompactWorktreeCards`, `gitlabProjects`, `tabSwitchKeybindingSeed`

## Unresolved buckets (counts only — never silently attributed to a field)

Full itemized entries (path/line/context) for each bucket are in the JSON companion under `unresolved.<bucket>`.

- `aliasAccesses`: **1**
- `candidateAccesses`: **896**
- `computedDynamicAccesses`: **2**
- `destructureRestUnresolved`: **2**
- `destructureComputedUnresolved`: **0**

## Unsupported forms (enumerated, never silently dropped)

- Cross-module call-target resolution is not performed: `const s = importedGetSettings()` is never traced into the imported module, even if that module's function has an explicit GlobalSettings-ish return type.
- Only bare-identifier call expressions (`getSettings()`) are traced to a getter; a method-call form (`store.getSettings()`, `deps.getSettings()`) is never resolved even when the receiver object's own type declares that method's return type as GlobalSettings-ish — e.g. `gitlab-project-recents.ts`'s `getSettings(): Pick<GlobalSettings, 'gitlabProjects'>` interface method is not traced at its call sites, which is why `gitlabProjects` shows no-observed-reference despite this real, present source pattern.
- Type-alias/interface resolution is module-global by declared name, not lexically block-scoped: a name declared MORE THAN ONCE anywhere in the module (as an alias, an interface, or both) is excluded from resolution entirely (conservatively ambiguous) rather than resolved to whichever declaration was seen first or last.
- A binding's identity is only traced within its own immediate function/program scope; a nested closure that captures an outer typed binding (without redeclaring the name) is not traced into and its accesses are absent from this census, not misattributed.
- Within one function/program scope, a name declared more than once (a param later shadowed by a block-local of the same name, two sibling blocks each declaring it differently) is treated as ambiguous for the WHOLE scope, not just the shadowed sub-block — this is a scope-wide approximation, not true lexical/block scoping, and can under-attribute a param that is validly used before an unrelated later same-named local appears.
- Canonical import evidence uses exact relative-path normalization to src/shared/global-settings-types.ts. Package aliases, barrels and re-exports are not resolved as local bindings. Generic/local/imported type-name collisions are excluded conservatively across the module; utility types may not be locally shadowed.
- A union type with more than one non-null alternative resolves only when EVERY alternative independently matches; the attributed field set is then the intersection across alternatives (fields only present on some alternatives are not attributed), never the first-recognized member alone.
- Interface `extends` clauses are not resolved — only an interface's own body members are inspected.
- `...rest` destructure elements capturing an unknown subset of fields are recorded in destructureRestUnresolved, never expanded to individual field references.
- Computed (bracket) access with a non-string-literal key on a confirmed settings receiver is recorded in computedDynamicAccesses with no field attributed, even though the real key range is provably a subset of the 214 fields (e.g. `key: keyof GlobalSettings`).
- An object-literal is treated as a write site only when it is the direct initializer of a settings-typed variable or the direct return value of a settings-typed-returning function/arrow; a literal built through an intermediate reassignment, spread-only merge, or multi-step builder contributes no per-field write evidence here (spread elements themselves are always skipped, sibling literal keys on the same object are still recorded).
- Files whose raw text never contains the literal token "GlobalSettings" are excluded from the scan surface entirely (not even as unresolved candidates) — a file reaching a settings field only through a fully untyped/`any`-cast or otherwise textually-indirect path is invisible to this pass.
- candidateAccesses (unknown-receiver) are only searched for within the same prefiltered file set as confirmed references, not across the whole src/ tree, to keep the unresolved bucket proportionate to the scan surface rather than a whole-repo property-name grep.

## Remaining gaps

- This census does not resolve nested nested nested access beyond a field's own top-level member expression (e.g. `settings.worktreeVisibilityDefaults.external` is recorded as a reference to `worktreeVisibilityDefaults`; the further `.external` access on its value is out of scope).
- IPC/RPC boundary crossings (main<->renderer) are not traced — a field read in main-process code and a field read in renderer code from the same logical settings object are recorded as independent references with no cross-process linkage claimed.
- No completeness or "fully mapped" claim is made for any field or for the census as a whole; see statusNote and unsupportedForms.

## Full detail

Every one of the 214 canonical fields, its `referenceStatus`, and (where observed) its complete list of `{path, line, kind, accessForm, receiverEvidence, testTitle?}` reference entries is in `docs/migration/parity-settings-consumers.json` → `fields[]`, in the same canonical order as `parity-settings-properties.json`. This document intentionally does not repeat that data.
