# Seti/Original notice reconciliation

Candidate for root review only. The **Seti import origin and notice are now characterized**, including the mixed/custom transformation route. **SN-U1 remains genuinely missing evidence:** the source image and notice for the current Ruby replacement. This is not complete E5 closure or publication clearance.

Audit remains **11/12 = 91.7%, delta 0**, medium source confidence; flexible 24-hour risk is high, with no defensible ETA. Root owns acceptance and the next gate. Source reference remains read-only at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`; Nerd pin is `fa7b859994228a9c8759f99c55a8d31ee92a1b5e`. Prior Nerd/Geist/FontLogos/other glyph/Devicons results are reused unchanged.

## Actual origin, with a bounded stopping point

Nerd import [`4ada58a…`](https://github.com/ryanoasis/nerd-fonts/commit/4ada58a6607160e8006cb6ab4de168a6081998c4) expressly identifies **Seti `fd20793e5a75b350eab8d489165fb9b420df3f62`**. All **168 imported SVG Git blobs** match that revision's `icons/` members. The machine report retains every pair, API response fingerprints and exact revision. This establishes that historical import's content identity, not every current glyph's history or a publisher signature.

At this actual revision, [package.json:1–7](https://github.com/jesseweed/seti-ui/blob/fd20793e5a75b350eab8d489165fb9b420df3f62/package.json#L1) declares version **1.11.0** and MIT. [LICENSE.md:1–20](https://github.com/jesseweed/seti-ui/blob/fd20793e5a75b350eab8d489165fb9b420df3f62/LICENSE.md#L1) supplies **Copyright (c) 2014 Jesse Weed**, permission, inclusion condition and disclaimer; its 1,054 bytes hash to `d4d2d888c6a0a220a7b0e2d6013cf37539b0e05ef937002b3b33bdb364575b88`. That notice happens to equal the earlier v0.8.1 candidate notice. The old candidate's aggregate SVG font is **not** the asserted source of these 168 standalone files.

The following adjacent commits explain the combination:

| Record | Actual declaration/effect |
| --- | --- |
| [`589b0df…`](https://github.com/ryanoasis/nerd-fonts/commit/589b0dfd9dbe0a52d708d9a4b4f168a999e3c837) | Mix custom icons into Seti, suffix custom filenames with `_nf`, adapt the mapping database. |
| [`2beed43…`](https://github.com/ryanoasis/nerd-fonts/commit/2beed43447f41736be489e3a13cf1262380c4c5b) | Select among duplicates, retain both C/C++ alternatives, choose Seti Windows/Puppet, omit certain colored/duplicate variants and retain disappeared older Seti forms as custom. |
| [`974249b…`](https://github.com/ryanoasis/nerd-fonts/commit/974249b5340de072bab2bc6a0024ca952a9d5a6a) | Move the combined set into `src/svgs` and update the live mapping. |

The current [README:3–13](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/src/svgs/README.md#L3) and [icons.tsv:15–226](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/src/svgs/icons.tsv#L15) select **191 outlines and 21 aliases**, with 40 `_nf.svg` filenames and 151 others. These are filename conventions, not 40 authenticated new artworks versus 151 unchanged upstream copies. In particular, `i_custom_windows` selects `windows.svg`; several `i_seti_*` names alias custom outlines. Keep all mappings. The JSON binds the existing 191 selections to current bytes; title/Sketch/Inkscape declaration scans do not prove geometry or rights.

## Notice and transformation contract

Nerd [LICENSE:1–31](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/LICENSE#L1) declares original code/default source MIT with **Copyright (c) 2014 Ryan L McIntyre**, while [license-audit.md:24–44](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/license-audit.md#L24) specifically describes Original Source as modified Seti-UI under MIT. Preserve the **complete Jesse Weed and Ryan L McIntyre notices**, the source revisions and modification records, alongside all previously accepted component notices. Neither the adjacent application OFL nor the aggregate MIT label alone describes that full notice set. These are factual upstream declarations, not an independent legal conclusion about every underlying logo.

[generate-original-source.py:1–179](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/bin/scripts/generate-original-source.py#L1) credits its original code idea to a Font Logos v1.0.1 generator; retain that comment without assuming another version's license. It reads decimal offsets and aliases from `icons.tsv`, imports each outline through FontForge, scales uniformly to fit bounds `[53,0,947,900]`, centers it, sets width 1000/em 1024 and adds a space glyph. It generates the OTF and then the shell mapping with codepoints shifted by `0x100`: current outlines occupy **E4FA–E5B8**, mapped to **E5FA–E6B8**. Invalid names are sanitized, conflicting filenames are reported, and an out-of-range codepoint exits; malformed offsets, missing outlines or zero bounding dimensions have no general recovery wrapper. This is source behavior, not a successful build.

[optimize-original-source.sh:1–59](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/bin/scripts/optimize-original-source.sh#L1) invokes Inkscape simplification and adopts output only below 80% of the old size with `doit`. Even its “dry” mode invokes Inkscape and writes `temp.svg`; none was run. [packsvgs.yml:1–83](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/.github/workflows/packsvgs.yml#L1) triggers on the relevant paths/manual dispatch, installs unversioned system dependencies, simplifies, conditionally commits, regenerates using the previous timestamp for comparison, and conditionally regenerates/commits with the current timestamp.

The accepted OTF is **167,512 bytes**, SHA256 `3fed9b17232a907588d8abf27ba44a00f443c1d48786c4e61d6e12e52270cba2`, metadata **3.3.0**, 193 glyphs. The current generator says **3.4.0**. The transformation recipe is characterized; this does not establish that the current script reproduced that component, nor repeat the accepted aggregate WOFF join.

## Named residuals and next actions

| ID | Disposition and concrete next action |
| --- | --- |
| **SN-U1: Ruby source/notice** | Current `ruby_nf.svg` exactly matches [`88eae283…`](https://github.com/ryanoasis/nerd-fonts/commit/88eae283f65b95ab6c347cf753e490e83288fbc8), which describes tracing an unnamed “free” pixel image. Its image identity, creator and terms are genuinely missing from this evidence. Obtain that input and notice/authorization before reuse publication, or have root commission an independently created same-role replacement with recorded provenance and mapping/visual acceptance. No replacement is authorized or made here. |
| **SN-R1: modified brand forms** | Current Firebase and Bazel bytes match their documented modifications. [Firebase `e13ef508…`](https://github.com/ryanoasis/nerd-fonts/commit/e13ef508610ec831c9711a69efc7406d54f3a5de) explicitly records a monochrome logo-usage conflict; [Bazel `7d7ab4c…`](https://github.com/ryanoasis/nerd-fonts/commit/7d7ab4c3d6b43d90c50af8d9c1ab4050bcf2cfdb) describes reconstructing filled outlines from the upstream skeleton, acknowledging Ezekiel Warren's idea. Preserve those records and obtain a publication decision; do not turn the MIT declaration into brand clearance. |
| **SN-R2/R3: faithful notices** | Carry both full family notices and accepted aggregate notices into the actual package. The current Chuck bytes match [the hand-drawn contribution](https://github.com/ryanoasis/nerd-fonts/commit/f65bde546fcaf1ccc4dc1f3d48795bdb655a69bf); that source declaration does not authenticate all custom artwork. |
| **SN-T1–T3: execution debt** | Later authorized work must reproduce the component with recorded tools/timestamps, compare mappings/outlines/metrics, exercise renderer fallback/clipping and all role/alias cases, and inspect distributed notices. These are unrun obligations, not a substitute for SN-U1's missing evidence. |

**SN-L1 is an explicit scope limit:** individual prior creator chains for every retained/custom shape were not pursued. It is not a claim of unknown unread local implementation or a request for recursive archaeology. The specific Seti import is proven; the known missing Ruby input stays separately named.

## Evidence and retained gate

[Machine evidence](seti-notice-reconciliation.json) provides 16 anchored HTTP sources, scoped history fingerprints, all 168 historical import joins and the existing 191 selected-file fingerprints/mappings. SHA256 covers exact bytes; line ranges are 1-based inclusive, byte offsets 0-based half-open, and newlines remain intact. API evidence is identified by response hash plus JSON pointer and immutable revisions; no signature was authenticated.

No builds, product tests, source imports, downloaded scripts, services, installs, Git commands, source/product writes or child workers ran. No original assertion bodies are newly claimed as executed or proven by this notice audit. The **9037-original-file/46-package allocation**, **T1–T4**, **GL-T1–T6**, screenshots/journeys and platform/SSH/folder/mixed-version behavior remain intact. Root decides whether this finite source characterization is accepted while preserving the named missing evidence and publication gates; actual Sol implementation remains gated on complete root source-audit acceptance.

