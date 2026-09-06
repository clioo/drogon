# E5 font provenance: exact reproduction and notice discrepancies

## Decision

Accept a reproducible byte-origin join for the bundled Symbols Nerd Font Mono file. **Do not accept complete notice clearance, Geist provenance, installed-package completeness or full E5 closure.** This narrows AO-NOTICES-01 without changing glyphs or the visual system.

The source checkout remains read-only at `c97906287bb7a390b25e2025b600d9fb3c25d9c3`. All five source font/notice files were compared with pinned Git blobs.

## Symbols Nerd Font Mono

The original WOFF2 metadata identifies Nerd Fonts3.4.0 with10,413 glyphs. The public3.4.0 tag resolves to `fa7b859994228a9c8759f99c55a8d31ee92a1b5e`. Fetching its pinned SymbolsOnly TTF and converting it in memory with FontTools4.64.0/Brotli1.2.0 reproduces **every byte** of the source WOFF2:

- Upstream TTF:2,507,556 bytes, SHA256 `f0f624d9b474bea1662cf7e862d44aebe1ae1f6c7f9cb7a0ca5d0e5ac9561c60`.
- Reproduced/source WOFF2:1,177,916 bytes, SHA256 `8efa6ba89f0a1f3eefde028f36aa64a13e36282e15ea0ca6929c664501037467`.

This establishes a reproducible origin candidate at an immutable revision; it is not an independently verified publisher signature or proof of the historical download route.

**The source's adjacent OFL notice is not a faithful copy of the matching upstream folder's MIT notice.** The upstream repository also documents multiple glyph-source licenses; do not replace the aggregate accounting with a blanket MIT label. Its pinned audit lists Font Logos as “Unlicensed,” which must remain an explicit component follow-up rather than an inferred permission. These are observed declarations, not a legal opinion.

Sources: [exact SymbolsOnly notice](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/patched-fonts/NerdFontsSymbolsOnly/LICENSE), [root licensing distinctions](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/LICENSE), [version-specific glyph license audit](https://github.com/ryanoasis/nerd-fonts/blob/fa7b859994228a9c8759f99c55a8d31ee92a1b5e/license-audit.md).

Follow-up: preserve the exact applicable upstream notices and resolve the glyph-source declarations before public packaging. Do not remove or replace private-use terminal glyphs implicitly. No product notice or asset was edited here.

## Geist

Renderer and site files are byte-identical:69,436 bytes, SHA256 `e24cec106619c03f0b3519e31b9bc55e0d5e926b6a95b8d798cd8cef215b1505`. Their internal name table reports version1.800,973 glyphs and2024 Geist Project Authors; the checked-in site notice names2023 Vercel/basement.studio.

A pinned upstream1.800 TTF at `10dc7658f13c38a474cde201bb09a4617267545b` has975 glyphs and converts to69,760 bytes, **not** the source font. Six bounded historical WOFF2 candidates also differ; one older path returns404. None was installed or substituted. Matching family/version labels are insufficient to preserve exact glyph coverage and metrics.

The current [upstream OFL declaration](https://github.com/vercel/geist-font/blob/10dc7658f13c38a474cde201bb09a4617267545b/OFL.txt) supports the observed2024 Project Authors wording, not a byte-origin match for the bundled font. Exact origin and applicable packaged attribution remain open.

## Reproduce and boundaries

```sh
uv run --no-project \
  --with 'fonttools[woff]==4.64.0' \
  --with 'brotli==1.2.0' \
  --with 'zopfli==0.4.3' \
  python scripts/verify-e5-font-provenance.py \
  /Users/carlos/Documents/Drogon-mentu-session
```

The verifier passed. It binds source Git bytes, upstream SHA256/size limits, inspection-tool versions and the full Nerd conversion result; the nonmatching Geist candidate is reported as nonmatching, not cleared by the successful command. Three separate in-memory helper fixtures passed (valid bytes, wrong hash, oversized response), without network or product execution. [Machine evidence](e5-font-provenance-evidence.json) includes metadata, notices' hashes/URLs and rejected candidates.

Default/bundled Python lacked FontTools and fc-scan could not parse these files. The inspection used an isolated uv cached environment; no source/product dependencies or global Python settings were changed. Font downloads/conversions stayed in memory. This is an audit verification, not a product test, native/rendered glyph check, service action or release packaging check.

Audit stays11/12=91.7%, delta0, medium source-characterization confidence. Other asset/recording authorization and service decisions remain open; flexible24-hour risk remains high/no defensible ETA. Actual Sol implementation leads remain after complete source-audit acceptance.
