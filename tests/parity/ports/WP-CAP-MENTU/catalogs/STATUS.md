# WP-CAP-MENTU / catalogs (skills) — status

## Binding result (V4-B2R, 2026-09-07): **BOUND — frozen suite GREEN 2/2, test file unmodified**

- Original test: `src/shared/agent-skill-sharing-contract.test.ts`
  (sha256 `6755dc9e58eb62727b93f7c710fd4b416bcc665fc5aad7524c17fc50b79d84ef`,
  pinned `c97906287bb7a390b25e2025b600d9fb3c25d9c3`; re-verified unchanged
  after binding). 2 cases, original imports preserved.
- Frozen-suite history: recorded byte-identical in checkpoint-001 while
  candidate modules were absent; the attempted run then FAILED AT COLLECTION
  (`Cannot find module './agent-skill-sharing-contract'`, 0 tests run) —
  recorded honestly as test preparation (blocked binding), not behavioral RED.
- Candidate modules added under `src/shared/` (each a byte-identical port of
  the pinned blob, provenance = this file; no headers inserted into the files):

  | Port | sha256 (== pinned blob) | Role |
  | --- | --- | --- |
  | `src/shared/agent-skill-sharing-contract.ts` | `c421ef3c78680e1771b746a13d8391766b63cafc96c567207789656c8c081d75` | `AgentSkillShareRequestSchema` (selectors 1..512 of trimmed 1..4096-char strings, strict object, `bundleName` DNS-like regex, `releaseNotes` ≤10000 default `''`, optional `SkillDiscoveryTarget`), error codes, `AgentSkillSharingError` |
  | `src/shared/skills.ts` | `95503dd18c577b15b76fef1df767882e64ab56fec1d3c645c9aaca230adc0b64` | `SkillDiscoveryTargetSchema` + discovery types; its two `import type` lines reference source modules (`./agent-status-types`, `./project-execution-runtime`) that are not part of this bounded tree — type-only, erased at runtime, no runtime effect |
  | `src/shared/skill-cloud-contract.ts` | `e4d0e5b9e0cfcfbb0c5d2c3de230c8754e4cb9f7cd2d701d680d8154b01f1c45` | share-result/operation types consumed by the contract module (type-only usage) |
  | `src/shared/skill-package-manifest.ts` | `52f29f85154f1873fbb17c0797be587a1a8e4bbbe92c6aa55c34ef497c6c244f` | pure type module (no imports) |
  | `src/shared/skill-bundle-manifest.ts` | `dd364902ea0da60f7c9500a9e9e56dcfa65700f93fe0426805eaa26548b192c3` | pure type module (no imports) |

- Dependency wiring (coordinator-authorized via orchestration `ask`, 2026-09-07,
  answer "A"): the bare `zod` specifier does not resolve from `tests/parity/ports/`
  under pnpm's isolated layout, so `vitest.config.ts` in this directory aliases
  `zod` to the exact worktree-installed copy `apps/desktop/node_modules/zod`
  (**4.5.4**, the version the pinned source pins). Nothing was installed,
  substituted, vendored or mocked; no lockfile/manifest outside this directory
  was touched. The config exports a plain object because `vitest/config` itself
  is not resolvable from this path.
- No product code changed anywhere in the rewrite: these are port modules
  inside the test-port tree, preserved verbatim, exercising nothing outside
  the zod schema validation.

## Verification (exact commands, worktree root, Node 24.19.0 runtime)

```sh
node apps/desktop/node_modules/vitest/vitest.mjs run --root tests/parity/ports/WP-CAP-MENTU/catalogs src/shared/agent-skill-sharing-contract.test.ts
```

- Before candidate modules existed (checkpoint-001 record): `Test Files 1
  failed (1)`, `Tests no tests` — collection failure (blocked binding), **not
  behavioral RED, not a skip, not a pass**.
- With candidate modules but before the zod alias: `Test Files 1 failed (1)`,
  `Tests no tests` — `Cannot find package 'zod'` (environment dependency,
  still collection failure, not behavioral RED).
- Final: **`Test Files 1 passed (1)`, `Tests 2 passed (2)`** — the frozen file
  ran unmodified to GREEN; both pinned behaviors hold (Windows discovery cwd
  preserved verbatim; arbitrary `sourceDirectory` and 513 selectors refused).

## Scope note

The skills/provider catalog implementation ownership remains WP-ENG-CLI /
WP-ENG-PLUGINS / WP-CAP-INT per
`docs/migration/parity-skill-provider-catalog.md`. This binding makes the
frozen assertions executable against the ported contract only; real
skill-sharing journeys (discovery, publication, install targets) remain open
obligations of their owners and of the MENTU pending register, which is
unaffected (the frozen test hash it pins did not change).
