# E5 font provenance: exact reproduction and notice discrepancies

## Decision

Accept a reproducible byte-origin join for the bundled Symbols Nerd Font Mono file and an exact Geist1.7.0 distribution/source-font match. **Do not accept complete glyph notice clearance, installed-package completeness or full E5 closure.** This narrows AO-NOTICES-01 without changing glyphs or the visual system.

The source checkout remains read-only at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. All five source font/notice files were compared with pinned Git blobs.

## Symbols Nerd Font Mono

The original WOFF2 metadata identifies Nerd Fonts3.4.0 with10,413 glyphs. The public3.4.0 tag resolves to `fa7b859994228a9c8759f99c55a8d31ee92a1b5e`. Fetching its pinned SymbolsOnly TTF and converting it in memory with FontTools4.64.0/Brotli1.2.0 reproduces **every byte** of the source WOFF2:

- Upstream TTF:2,507,556 bytes, SHA256 `f0f624d9b474bea1662cf7e862d44aebe1ae1f6c7f9cb7a0ca5d0e5ac9561c60`.
- Reproduced/source WOFF2:1,177,916 bytes, SHA256 `8efa6ba89f0a1f3eefde028f36aa64a13e36282e15ea0ca6929c664501037467`.

This establishes a reproducible origin candidate at an immutable revision; it is not an independently verified publisher signature or proof of the historical download route.

**The source's adjacent OFL notice is not a faithful copy of the matching upstream folder's MIT notice.** The upstream repository also documents multiple glyph-source licenses; do not replace the aggregate accounting with a blanket MIT label. Its pinned audit's ambiguous Font Logos “Unlicensed” entry is resolved below as the actual Unlicense declaration, not missing permission. These are observed declarations, not a legal opinion.

Sources: [exact SymbolsOnly notice](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/patched-fonts/NerdFontsSymbolsOnly/LICENSE), [root licensing distinctions](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/LICENSE), [version-specific glyph license audit](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/license-audit.md).

Follow-up: preserve the exact applicable upstream notices and resolve the glyph-source declarations before public packaging. Do not remove or replace private-use terminal glyphs implicitly. No product notice or asset was edited here.

### Font Logos ambiguity resolved

The exact Nerd3.4.0 source component `src/glyphs/font-logos.ttf` matches `font-logos-1.3.0/assets/font-logos.ttf` in the upstream GitHub release byte for byte:48,592 bytes,134 glyphs, SHA256 `7f0b055275bb3710afee586519884f3e302ec295a2f4ff4158daacf437c49852`. Release ZIP SHA256 is `53376d5496cfbc78035ca60f58791ba5b2bfec6a9e751ac521aace6acdacb012`.

The release license also matches [the exact1.3.0 tag's Unlicense text](https://github.com/lukas-w/font-logos/blob/e92426e28ee5bbf4ca328b33e3a393b7a5045f01/LICENSE). Therefore the shorthand “Unlicensed” must not be reported as absence of a license. Preserve the separate [upstream brand-identity warning](https://github.com/lukas-w/font-logos/blob/e92426e28ee5bbf4ca328b33e3a393b7a5045f01/README.md); this is not blanket trademark clearance.

The npm package with the same1.3.0 label is **not** a matching binary: its TTF reports internal1.2.0 and133 glyphs. Its registry integrity matched, but that does not make it the same font. The negative observation is retained in the evidence; no substitution was performed.

This source-component/release/notice join does not reproduce the entire aggregate Nerd font build from all glyph sources. Other glyph-family notices and final package inspection remain required. The extended verifier passed exact component,141-entry release, tag license and README checks with pinned hashes, entirely in memory. Four separate mocked-fetch ZIP fixtures passed (valid, duplicate member, wrong font, wrong license); those are audit-tool checks, not product tests.

### Component notice checkpoint

The exact Nerd3.4.0 revision now has15 checked declaration/modification files across nine glyph families in `e5-nerd-component-notices.json`. The extended verifier downloaded all15 and matched exact sizes/SHA256; the existing Nerd/Geist binary joins also still passed. Six separate offline rejection/traversal fixtures passed via `uv run --no-project --with 'fonttools[woff]==4.64.0' --with 'brotli==1.2.0' --with 'zopfli==0.4.3' python scripts/verify-e5-font-provenance.test.py`. These fixtures test the audit tool, not Drogon.

Concrete distinctions for the eventual package:

- Codicons declares CC-BY4.0; its README records manual repairs to two glyphs. Retain the modification record.
- Font Awesome's supplied notice distinguishes SVG/JS icons, fonts and code. Nerd's README explicitly describes a6.5.1.custom font assembled from SVGs; preserve that route and the complete notice rather than choosing a license from the output extension alone.
- Pictogrammers references Apache2.0 for fonts, MIT for code and respective licenses for some icons. Its supplied notice is not the full Apache text; the README also records a repaired glyph and a dormant older font.
- Octicons and Powerline Extra supply concrete MIT notices. Powerline Symbols supplies MIT-form permission text despite the aggregate audit's generic Free License label.
- Pomicons explicitly declares its Reserved Font Name. Weather Icons' supplied OFL header still contains unfilled dates, holder and reserved-name placeholders: obtain exact upstream attribution, do not invent it.
- Devicons is documented as2.16.0.custom. No standalone notice exists at the immediate directory level inspected; deeper generated-source attribution must be resolved, not substituted with the older Vorillaz family automatically.

The catalog retains six finite follow-ups: Devicons, Font Awesome Extension, IEC and Seti-derived source notices; complete Weather attribution; aggregate transformation/final package verification. This checkpoint preserves exact source statements, not a legal clearance or completed build. No product asset, packaged notice or global environment was changed.

## Geist

Renderer and site files are byte-identical:69,436 bytes, SHA256 `e24cec106619c03f0b3519e31b9bc55e0d5e926b6a95b8d798cd8cef215b1505`. Their internal name table reports version1.800,973 glyphs and2024 Geist Project Authors; the checked-in site notice names2023 Vercel/basement.studio.

A pinned upstream1.800 TTF at `10dc7658f13c38a474cde201bb09a4617267545b` has975 glyphs and converts to69,760 bytes, **not** the source font. Six bounded historical WOFF2 candidates also differ; one older path returns404. None was installed or substituted. Matching family/version labels are insufficient to preserve exact glyph coverage and metrics.

The current [upstream OFL declaration](https://github.com/vercel/geist-font/blob/10dc7658f13c38a474cde201bb09a4617267545b/OFL.txt) supports the observed2024 Project Authors wording, not a byte-origin match for the bundled font. This was the initial unresolved result; the version-specific package check below resolves the distribution correspondence without replacing the font.

### Exact distribution match: geist1.7.0

The published `geist@1.7.0` archive contains `package/dist/fonts/geist-sans/Geist-Variable.woff2`, identical to both source files. Registry SHA512 and the recorded archive SHA256 match. All106 archive member names are unique; the exact font, package identity and `LICENSE.txt` were read without extraction or installation.

`package/LICENSE.txt` is4,368 bytes, SHA256 `930853ee1daa68554d9e35c8a9175affb74f699fad9a5da6ee5ebe76379d9137`. It names2023 Vercel/basement.studio and contains the same words as the source site's embedded OFL text; only whitespace differs. **The2023 notice is therefore not disproved by the font's2024 internal metadata.** Preserve both rather than replacing the packaged notice with a newer repository notice.

The archive is4,988,330 bytes, SHA256 `eacd923c2f0e6b2fc27a3a9068bcdba2b89ddd3f4304dbef414117f280e72965`; exact URL/integrity and selected member hashes are in the evidence. This establishes distribution-byte and notice correspondence, not the original author's download route, a verified npm publisher signature or final installed notices. The source has no Geist dependency lock entry; do not invent one to describe this historical vendoring.

## Reproduce and boundaries

```sh
uv run --no-project \
  --with 'fonttools[woff]==4.64.0' \
  --with 'brotli==1.2.0' \
  --with 'zopfli==0.4.3' \
  python scripts/verify-e5-font-provenance.py \
  /Users/carlos/Documents/Drogon-mentu-session
```

The extended verifier passed. It binds source Git bytes, upstream SHA256/size limits, inspection-tool versions, the full Nerd conversion and Geist package-member/notice correspondence. The earlier nonmatching Geist TTF remains explicitly rejected. Three separate in-memory helper fixtures passed previously (valid bytes, wrong hash, oversized response). Five new literal-archive fixtures passed: valid archive, duplicate member, wrong font bytes, wrong package identity and wrong notice. These fixture checks use mocked fetches, not network or product execution. [Machine evidence](e5-font-provenance-evidence.json) includes metadata, notices' hashes/URLs and rejected candidates. The first archive inspection failed because bsdtar interpreted `[wght]` as a pattern; literal tarfile lookup corrected that inspection error without changing product code or assertions.

Default/bundled Python lacked FontTools and fc-scan could not parse these files. The inspection used an isolated uv cached environment; no source/product dependencies or global Python settings were changed. Font downloads/conversions stayed in memory. This is an audit verification, not a product test, native/rendered glyph check, service action or release packaging check.

Audit stays11/12=91.7%, delta0, medium source-characterization confidence. Other asset/recording authorization and service decisions remain open; flexible24-hour risk remains high/no defensible ETA. Actual Sol implementation leads remain after complete source-audit acceptance.
