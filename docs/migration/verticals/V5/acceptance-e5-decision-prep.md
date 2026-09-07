# V5 acceptance — E5 decision prep

2026-09-07. Worktree `codex-vertical-05-platform-release`, branch
`codex/vertical-05-platform-release`, HEAD `596ddbd9e8b6fdc5d5fa26616479e910b34ba604`,
clean tree at observation time. Doc-first leaf deliverable: this file is the
only artifact; no code, manifest, lockfile, protocol, CI or script was edited;
nothing was installed, provisioned, published or deployed. The read-only
reference at `/Users/carlos/Documents/Drogon-mentu-session` was not used as a
cwd and was not modified. This is planning/evidence inventory, not E5 closure
and not product parity.

## 1. Acceptance/packaging runner inventory (what still runs from this seed)

### 1.1 Combined runners declared in `package.json`

| Script | Command shape | Notes |
| --- | --- | --- |
| `test` | `cargo test --workspace --locked && pnpm --filter @drogon/desktop test` | Rust workspace + desktop suite; not run in this block. |
| `test:packaging` | `node --test scripts/acceptance-bridge-observation.test.mjs scripts/acceptance-process.test.mjs scripts/desktop-artifacts.test.mjs scripts/packaged-runtime-admission.test.mjs scripts/packaged-fixture-daemon.test.mjs scripts/preview-install-lock.test.mjs scripts/probe-rendered-harness.test.mjs tests/parity/ports/WP-ENG-RUNTIME/package-admission/sealed-bundle-identity.test.mjs` | Eight packaging/admission test files in one lane; the sealed-bundle file is the one baselined below. |
| `accept:core-cli` / `accept:packaged` (`accept:desktop`) | `node scripts/accept-core-cli.mjs` / `node scripts/accept-desktop.mjs` | Full acceptance harnesses; spawn services/Electron (Playwright CDP). Not run here. |
| `package:desktop` | `node scripts/package-desktop.mjs` | Builds the bundle and generates notices via `writePackageNotices` (pnpm licenses + `cargo metadata --locked --offline` + `LICENSE` + `THIRD_PARTY_NOTICES.md`). Not run here. |
| `install:preview` | `node scripts/install-preview.mjs` | Installation gate; explicitly out of scope for this block. |
| `test:renderer-contracts` / `typecheck:renderer-contracts` | vitest/tsc over `tests/parity/ports/WP-UI-PRELOAD/**` | Not run here. |

### 1.2 Per-area runner scripts present in `scripts/`

- `accept-core-cli.mjs` — CLI/service acceptance harness (tmpdir, real daemon).
- `accept-desktop.mjs` — Playwright CDP desktop acceptance of the packaged/
  built app (the corrected 14-check instrument described in
  `docs/migration/packaged-integrated-acceptance.md`).
- `accept-live-child-crash.mjs` — live-PTY child vs SIGKILLed daemon
  liveness-classification acceptance; Windows refused by design.
- `accept-preload-close-guard.mjs` — plan/`--check` modes are read-only and
  spawn-free; only `--execute` spawns.
- `packaged-runtime-admission.test.mjs`, `desktop-artifacts.mjs` (+ test) —
  sealed-bundle identity v3 (final-seal format; legacy metadata-only receipts
  are not install authority). ROOT correction (2026-09-07): the 293 files /
  307,543,311 bytes figure quoted from the integrated-acceptance doc belongs
  to the older `ebbbb58c` candidate and is **not current**; the current
  accepted package is `83e9eca`, 293 files / 309,447,135 bytes. An
  acceptance run records the fresh sealed digest of the bundle it actually
  admits; neither historical figure is reused as authority.
- `verify-preflight.mjs` — validates recorded `.preflight/<lane>/` receipts
  (`agy|sonnet|glm`); read-only on existing receipts.
- `verify-e5-package-notices.mjs` — audit verifier taking `SOURCE_ROOT`;
  **cannot run against this seed's checkout as the pinned root**: it asserts
  `git rev-parse HEAD == c97906287bb7a390b25e2025b600d9fb3c25d9c3`, so it only
  runs against a checkout pinned at the original source revision (the
  read-only reference was the audited root) and requires registry network
  reads. Re-running it here would fail the pin assertion by design; no rerun
  was attempted or needed.
- `verify-e5-generated-localization-source.mjs`, `verify-e5-publication-source.mjs`,
  `verify-e3-*.mjs`, `verify-e5-font-provenance.py` (+ pytest-style fixture
  file), `verify-native-*.mjs` — audit-only source verifiers; report-only,
  no product import; unchanged.
- `run-parity-baseline-capsule.mjs` / `run-parity-baseline-batch.mjs` —
  original-source baseline capsule tooling; must stage an isolated closure,
  never run with the read-only reference as cwd.
- `check-parity-work-packages.mjs`, `check-frozen-test-ports.mjs`,
  `inventory-source-*.mjs`, `probe-*.mjs` — inventory/probe tooling, present
  and unchanged in this seed.

### 1.3 Bounded baseline run (this worktree as cwd)

- Exact command:
  `/Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/parity/ports/WP-ENG-RUNTIME/package-admission/sealed-bundle-identity.test.mjs`
- Runtime: Node v24.19.0 (the declared `engines`-era runtime at its known
  cache path; system `node` is v26.8.1 — Node 24 was chosen to match the
  recorded baseline pattern; no runtime was installed or modified).
- cwd: this worktree. Exit code: **0**.
- Counts: tests 15, pass 15, fail 0, cancelled 0, skipped 0, todo 0,
  duration 263.5 ms. All 15 fixtures ran in OS tmpdirs; no repo writes
  (confirmed: `git status` clean afterward), no network.
- Interpretation: the sealed-bundle admission port is healthy from this seed.
  This is one file, not the combined `test:packaging` lane; the other seven
  files remain to be baselined by whoever runs the combined lane.

## 2. Resource/locale/notice exactness status

Summary of accepted evidence (all against source pin
`c97906287bb7a390b25e2025b600d9fb3c25d9c3`; see the e5 review docs for exact
hashes). "Byte-exact" means recorded byte/hash correspondence at an immutable
revision; none of it attests publisher identity or final shipped contents.

Byte-exact / accepted:

- npm archives: lucide-react 0.577.0 and 1.26.0, katex 0.16.45 and 0.16.47 —
  registry integrity matches pinned lockfile SHA-512; installed
  `package.json`/LICENSE match archive members byte-for-byte (docs-only
  Lucide 1.26.0 read in archive, never installed).
- Geist 1.7.0: distribution/source font byte match; notice matches after
  whitespace normalization.
- Symbols Nerd Font Mono 3.4.0 WOFF2: every byte reproduced from the pinned
  upstream TTF (WOFF2 SHA-256 `8efa6ba8…50137467`).
- Font Logos 1.3.0: component TTF byte-matches the GitHub release asset;
  "Unlicensed" resolved to the actual Unlicense text. Negative retained: the
  same-version npm package is NOT the same binary (internal 1.2.0, 133
  glyphs).
- Nerd 3.4.0: 15 component declaration/modification files across 9 glyph
  families downloaded and SHA-matched (`e5-nerd-component-notices.json`).
- Devicons legacy origin: 18-SVG Vorillaz subtree checked; 17 byte-identical,
  1 documented modification (`e5-devicons-legacy-origin.json`).
- Seti: 191 current SVGs, 168 historical import blob identities, history API
  responses and 4 documented version-drift files byte-matched; 21 aliases
  match; 22/32 recorded history declarations are Signed-off-by-truncated
  excerpts, not full messages (evidence convention correction preserved).
- Locale catalogs: 7 resources, 78,204 string leaves over 14,003 English
  keys — structural/content reconciliation accepted (eager 2,588-key English
  subset is a resource, not a seventh language). Generated xterm bundle/map:
  186,122 VLQ segments verified (FG-UN1/FG-UN2 accepted at source boundaries).

Pending / not yet exact — the three remaining byte-exactness gaps are
**named residuals** (ROOT direction, 2026-09-07); the accepted evidence
above stays accepted:

- **Named residual NR-1 — final-bundle notice inspection.** The current
  accepted package (`83e9eca`) already carries **191 dependency notices**,
  generated and counted at package time (`packaged-integrated-acceptance.md`:
  "Electron 44.2.0; 191 dependency notices"). Notices are regenerated by
  `package-notices.mjs` from live pnpm/cargo state, so that count proves
  generation, not byte-exactness of what ships; no byte-level inspection of
  the notices inside the built bundle exists yet. The
  `react-remove-scroll-bar@2.3.8` special-case pin shows the generator
  already carries hand-maintained text, so a bundle diff against freshly
  generated output is not tautological.
- **Named residual NR-2 — aggregate license accounting.** The source's
  adjacent OFL notice next to the Nerd font is NOT a faithful
  copy of the upstream folder's MIT notice; the Nerd aggregate must keep its
  multi-glyph-source license accounting, never a blanket MIT label.
- Lucide 0.577.0 and 1.26.0 notices are non-interchangeable; the docs
  version's attribution wording must be preserved distinctly when bundled.
- **Named residual NR-3 — full dependency census.** Only 4 packages + font
  components have exact evidence; the remaining dependency set and publisher
  identity are unattested.
- Seti residuals: SN-U1 (unnamed input image/terms for Ruby), SN-R1 (Firebase
  brand-use concern), Bazel attribution retention; generator 3.4.0 vs
  accepted component 3.3.0 rebuild reproducibility (SN-T1); shipped
  rendering/mapping checks (SN-T2/T3).
- Locale residuals: linguistic quality, actual locale-chunk loading,
  i18next runtime behavior, ICU rendering and screenshots are execution
  obligations; source-map toolchain regeneration (GL-T1) is release-blocking,
  including unchanged omitted WebGL text.
- Codicons CC-BY 4.0 modification record (two manually repaired glyphs) must
  be retained in shipped attribution.

## 3. Concrete E5 decision options for Carlos

Constraints honored by every option below: no provisioning, no publishing,
no real-data submission, no service deployment, no preview installation in
this audit-only block. None of these options is pre-approved or implemented;
each needs an explicit Carlos decision and then root-scoped execution.

### AO-RIGHTS-01 (individual asset/component authorizations)

- **A. Verify-and-document**: commission the remaining named joins (SN-U1
  Ruby input image/terms; any remaining unnamed artwork origins) and record
  permission evidence before packaging. Lowest legal residual, slowest.
- **B. Replace**: authorize independent replacements for the specific
  unresolved artworks (e.g., redraw Ruby-related glyph art) with owned or
  clearly licensed equivalents, keeping attribution records for what remains.
- **C. Ship-with-recorded-obligation**: publish with the existing mixed
  license accounting and explicit documented residuals — a Carlos-owned risk
  acceptance, never a silent one; requires the aggregate Nerd multi-license
  text (not blanket MIT) and the brand-identity warnings to ship verbatim.

### AO-RECORDINGS-01 (missing marketing recordings)

- **A. Independent replacement**: record new Drogon demo material after the
  combined candidate exists; original captures are never reused without
  authorization. Requires no external permission.
- **B. Obtain authorization** for original capture/content from the original
  authors, with written permission retained in the audit record.
- **C. Omit explicitly**: ship without marketing recordings as a documented
  scope decision — allowed only as an explicit Carlos decision, not silent
  feature removal; revisit post-release.

### AO-NOTICES-01 (final packaged notices)

- **A. Gate on inspection**: make "final bundle third-party notices byte/
  content inspection" an explicit combined-release gate: run
  `package:desktop`, then diff the shipped notices file against the accepted
  evidence set (4 npm packages, Geist, Nerd aggregate accounting, Font Logos
  Unlicense + brand warning, Seti dual notices, Codicons CC-BY modification
  record, docs-Lucide wording). Root-owned at integration.
- **B. Bounded supplement audits first**: extend the exact-evidence set to
  the full installed-dependency census before any packaging run, so the
  gate diff is fully predetermined.
- **C. Phase**: gate only the currently exact subset at first packaged
  builds and track the census as a named residual with a due milestone.
  Fastest, but leaves the widest residual and must be recorded as such.

### AO-SERVICE-01 (missing cloud/service backend)

- **A. Independent implementation**: scope a Drogon-owned service
  (upload/delete/feedback/telemetry equivalents) in a later implementation
  wave, with Carlos deciding region, retention and consent policy up front;
  the six proposals and 26 proposed cases are design input only, never
  evidence of original backend behavior.
- **B. Explicit degradation**: ship desktop/local capability with
  cloud-dependent features visibly disabled and documented (named, not
  silent removal), each behind a capability flag with recorded status.
- **C. Defer decision**: keep AO-SERVICE-01 open through first release and
  re-decide when the combined candidate is otherwise ready; risks blocking
  release-adjacent work that assumes a backend.
- Not an option under current constraints: provisioning any service,
  publishing any endpoint, or submitting real data — all remain prohibited
  regardless of which option Carlos selects.

## 4. Limits of this document

Inventory and status are read from this seed's files and the cited review
docs; only the sealed-bundle test in §1.3 was executed here. No E5 group is
closed by this file; the audit percentages, gate ownership and staffing rules
in the cited root reviews are unchanged. All hashes, counts and receipts
remain those of the cited evidence documents, re-read not re-executed.
