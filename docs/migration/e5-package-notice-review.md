# E5 exact dependency-notice evidence

Font follow-up: e5-font-provenance-review.md and e5-font-provenance-evidence.json now establish exact Nerd3.4.0 TTF-to-WOFF2 reproduction and Geist1.7.0 package/source-byte correspondence. The source Geist notice matches that package after whitespace normalization; Nerd mixed-glyph and complete installed notices remain open. This does not change the four package-archive results below.

Root accepts the bounded package-byte/notice join recorded in `e5-package-notice-evidence.json`, observed 2026-09-06. This narrows AO-NOTICES-01; it does not close E5, authorize unrelated assets or prove final distributable contents.

## Verified result

The four public npm package archives match both their registry integrity declarations and the exact SHA-512 resolutions in the pinned source lockfiles at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. The three existing installed `package.json` and LICENSE files match those archive members byte-for-byte. The docs-only Lucide version was inspected in its archive without installation.

| Exact package | Archive notice | Installed comparison |
| --- | --- | --- |
| lucide-react 0.577.0 | ISC plus Feather-derived MIT portions; 2,004 bytes | package.json and LICENSE match |
| lucide-react 1.26.0 | ISC plus explicit Feather-derived icon list and MIT notice; 3,208 bytes | No installation performed; package identity and notice read directly from matched archive |
| katex 0.16.45 | MIT declaration; 1,107 bytes | package.json and LICENSE match |
| katex 0.16.47 | MIT declaration; 1,107 bytes | package.json and LICENSE match |

**The two Lucide versions do not have interchangeable notice text.** Version 1.26.0 lists the Feather-derived icons and uses different attribution wording. The earlier unresolved docs-version notice now has exact version-specific evidence; copying the desktop version's notice alone would lose that distinction. Preserve the exact applicable text when those components are bundled.

Both KaTeX archives contain 61 font file entries but only the package LICENSE among the inspected LICENSE/COPYING/NOTICE/OFL filenames. This proves archive contents, not every font's earlier origin or an independent clearance. Do not extrapolate these four packages into a complete dependency census or final application notice set.

## Reproducibility and limits

Run `node scripts/verify-e5-package-notices.mjs SOURCE_ROOT`. It reads the two lockfiles and their pinned Git copies, fetches four public metadata records and four archives, checks integrity, lists members, and reads notices/package metadata through tar stdout. It does not extract files to disk, install dependencies, run lifecycle scripts, read credentials, provision services or change the source repository. The exact command succeeded under Node 26.0.0 on macOS; this is an audit check, not product tests or cross-platform packaging verification.

Two preliminary verifier attempts failed because its lockfile reader initially conflated package resolutions with snapshots, then assumed a single YAML document. The pinned root lock contains a separate package-manager document. The final reader searches package-resolution sections across all documents and requires exactly one selected resolution. Those were audit-tool failures, not source/candidate behavioral RED or product defects.

The evidence records archive SHA-256, locked SHA-512, metadata and source-lock hashes, full notice bytes and installed comparisons. Registry correspondence and locked integrity do **not** independently attest publisher identity or audit every installed package byte. Archive payloads were retained only in memory; exact reruns require registry access. Final bundled notices, native/component provenance, original asset/recording authorizations and service ownership/policy remain explicit obligations.

## Phase

Audit remains 11/12 = 91.7%, delta 0 groups. E3 is accepted by `e3-final-composition.md/json`; its prior pending references in the frozen publication review are historical. E5 still requires AO-RIGHTS-01, remaining AO-NOTICES-01, AO-RECORDINGS-01 and AO-SERVICE-01 dispositions. The pending user questions about authorization/replacements and service region/retention have not been answered. No new Astra task, Sol implementation task, deployment or preview replacement was started. Actual Sol leads and workers remain the implementation staffing after the full gate.
