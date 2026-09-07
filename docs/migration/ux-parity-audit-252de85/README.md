# UX Parity Audit 252de85 — Archived Text Evidence

This directory is a **mechanical, bounded evidence handoff**, not a new audit and
not full audit acceptance. It archives sanitized text evidence from a completed
local read-only audit so the five vertical leaders can read it without access to
the original audit host or its ephemeral working directory.

## Source

- Original audit working directory (local-only, not portable, not included
  here): `/tmp/drogon-ux-parity-audit-252de85c2fd2`
- Original manifest: `audit-manifest.json` (copied verbatim into this
  directory; lists 42 files with size + sha256 as recorded by the audit).
- Source revision: `c97906287bb7a390b25e2025b600d9fb3c25d9c3` (whole-fork
  reference, `clioo/drogon-orca`, upstream `stablyai/orca`).
- Candidate revision: `252de85c2fd28bbdc4c09c70c16063a0c7eb901e`
  (`clioo/final-audit` branch). See `report.md` for full identity detail.

Every one of the 42 files listed in the original `audit-manifest.json` was
independently re-hashed (sha256) and re-sized against the live source
directory before any file was selected for archiving; all 42 matched their
recorded size and hash exactly.

## What is archived here (16 files)

Only plain text (JSON/Markdown) evidence needed by the five vertical leaders
was selected, copied **verbatim, byte-for-byte**, from the 42-file source set:

- `report.md`
- `matrix.json`, `matrix.md`
- `coverage.json`
- `validation.json`
- `baseline.json`, `baseline-original.json`
- `reference-evidence.json`
- `artifact-retention.json`
- `evidence-index.json`
- `navigation-visual-index.json`
- `cli-results.json`
- `mentu-evidence-characterization.json`
- `lifecycle.json`
- `release-receipts.json`
- `audit-manifest.json` (the original 42-file manifest, copied verbatim)

Plus one new file produced for this handoff:

- `archive-hash-manifest.json` — sha256/size for each archived file, cross-
  checked against the corresponding entry in the original `audit-manifest.json`
  (or, for `audit-manifest.json` itself, against a direct re-hash of that file).
  All 16 files matched their source hash/size exactly (`allVerbatimAndMatchSource: true`).

**No sanitization/content transformation was applied.** All 16 files were
reviewed line-by-line for secrets, API keys/tokens, credentials, raw provider
transcripts, and account data — none were found. Because no transformation was
needed, the archived bytes are identical to the source bytes, so the original
hash and the archive hash are the same value for every file.

## Explicitly NOT copied

Per the authorized scope, the following were never copied into this
directory, regardless of what the archived text references:

- Binaries, the packaged `Drogon.app` bundle, or any build artifacts.
- Screenshots / reference-capture images (`.png` files).
- Raw provider transcripts.
- Scripts (`.py`, `.mjs`, `.sh`) from the source audit directory — e.g.
  `assemble-report.py`, `validate-audit.py`, `run-audit-checks.sh`,
  `characterize-mentu-evidence.mjs`, `audit-cli.py`, `verify-*.mjs`.
- Any of the `workers/*.md` / `workers/*.json` per-worker review files, or
  other source-directory files not in the 16-file list above (e.g.
  `checkpoint.md`, `github-baseline.json`, `root-integrations-review.md`,
  `root-runtime-review.md`, `root-shell-review.md`,
  `.mentu/plans/drogon-rewrite-preflight.md`,
  `harness/.preflight/acceptance/.../report.json`).

`report.md` mentions several of the files above by name in its prose. Where a mentioned file **is** in the
16-file archive list, it is present here under the same filename. Where a
mentioned file is **not** in the archive list (the items in the bullet just
above), it is **unavailable / local-only** — it exists only in the original
audit host's working directory and was not, and could not honestly be
described as, copied here. The report's relative matrix links resolve within
this archive. Other source/runtime references retain their original, explicitly
local-only meaning; no missing linked evidence is claimed to be present.

## Local-only paths inside the archived files

Five of the archived files contain **absolute local filesystem paths** from
the original audit host (usernames, build directories, screenshot paths).
These paths were left exactly as recorded (not rewritten), because doing so
would break their sha256 provenance without removing any actual secret — they
contain no credentials, only local directory structure. They are already
non-portable by construction (absolute paths under `/Users/...` and
`/tmp/drogon-ux-parity-audit-252de85c2fd2/...`), and none of the referenced
targets (build bundle, receipt files, screenshots) are included in this
archive:

- `report.md` — mentions the original `Drogon-mentu-session` reference
  checkout path, the candidate worktree path, a local Node runtime path, and
  the local screenshot-capture directory path. Explicitly states rights-
  uncertain artwork and private-host terminal captures are "not embedded or
  redistributed."
- `baseline.json`, `baseline-original.json` — reference the candidate
  worktree path and a packaged-app bundle path/receipt path on the audit
  host. The `.app` bundle and receipt JSON themselves are **not** archived.
- `artifact-retention.json` — references the original and retained bundle
  paths for the packaged app. The bundle itself is **not** archived.
- `reference-evidence.json` — lists three `.png` screenshot paths plus their
  sha256 hashes. The screenshots themselves are **not** archived; only the
  path + hash records are.

No image bytes or provider transcripts are archived. Referenced historical
captures may contain rights-uncertain artwork and remain local-only.
No redaction was applied; the limitation is documented here
instead, per the "explicit local-only reference, never claim portable
evidence was copied" requirement.

## Evidence limitations preserved from the original audit (unchanged)

These characterizations come directly from the archived files and are
reproduced here only as a summary pointer, not a re-derivation — see
`matrix.json`/`matrix.md` and `coverage.json` for the authoritative detail:

- `matrix.json` / `matrix.md`: **86 rows**, all with unique `id` values —
  verified by direct parse of the archived `matrix.json`.
- `coverage.json`: `sourceIndexCount: 50` — **50 source IDs** mapped
  (anti-omission bookkeeping), explicitly noted as "NOT 100% UX fidelity or
  state coverage." This is 86 test rows against a 50-ID source index, **not**
  whole-repo parity.
- Per `report.md`: 11/12 source-characterization groups are reconciled; E5
  remains open. The audit records 14 positive rendered results,
  2 P1 navigation failures, and 16 CLI probes — see `report.md` for the full
  breakdown and caveats; this README does not restate or re-verify each of
  those individual figures beyond the 86-row/50-ID structural check above.
- Source reference `c97906287bb7a390b25e2025b600d9fb3c25d9c3` is the original
  application, not the candidate. Candidate `252de85c2fd28bbdc4c09c70c16063a0c7eb901e`
  and artifact-source `dc12c7ab4c8a5b82802da5f54dcc17824f9eb90f` share complete
  tree `ba24aee8aa84c02c8a9b761867d825d03384f64e`; only those two trees are equal.

## Coordinator verification

On 2026-09-07 at 09:55 UTC, root independently rehashed all 42 original
manifest entries and all 16 archived entries; every size/hash matched.
The archive has 18 files total, including 15 JSON files (not 18 JSON files).
The matrix has 86 distinct finding IDs and the coverage map has 50 source rows.
Root corrected this README's original source-tree, E5-count and hyperlink
descriptions; the 16 original evidence files remain byte-for-byte unchanged.
Current implementation authority and staffing come from the latest user
instructions and project AGENTS.md, not historical recommendations in the audit.

## Scope disclaimer

This is a **bounded evidence copy** produced mechanically from an already-
completed audit. It is not a new audit, not independent re-verification of
the audit's findings, and not full audit acceptance. No source files, audit
originals, or audit scripts were modified or re-run to produce this archive.
