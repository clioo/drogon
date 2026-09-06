# Native locale ordering dependency

Root decision, 2026-09-06. The Bot storage leaf found no existing native locale
comparator. Locale-aware ordering is required, not deferred out of scope. Root
added exact `icu_collator = 2.2.1` and `icu_locale = 2.2.0` dependencies to the
core crate, with compiled collation data. Cargo resolved 28 additive packages;
`cargo check -p drogon-core` passed. Root performed this scoped dependency fetch;
workers remain under their no-install/no-network rule and use locked offline
Cargo. Existing locked packages were not deliberately upgraded.

The [ICU4X collator API](https://docs.rs/icu_collator/2.2.1/icu_collator/)
supports explicit locale preferences and options; its
[manifest](https://docs.rs/crate/icu_collator/2.2.1/source/Cargo.toml) declares
Unicode-3.0 and compiled data. Packaging must retain the supplied Unicode notice;
dependency compilation is not packaged-notice or ordering acceptance.

## Required implementation and tests

CAP's existing Sonnet leaf may additionally own new
`crates/drogon-core/src/locale_ordering.rs` and
`crates/drogon-core/tests/locale_ordering.rs`. This shared native comparator must
accept an explicit execution-host locale, validate it and return an error rather
than panic or silently select binary sorting. Use the real ICU4X implementation,
not a fixture comparator, OS subprocess or JS backend. Preserve stable ordering
for names the collator considers equal. Bot storage receives this comparator;
other future consumers can reuse the same module. Root owns public registration
and host-default-locale initialization and will bind those before integrated
list acceptance. Do not choose the paired client's locale for a remote host.

Source behavior uses default `localeCompare`, so do not turn on numeric sorting,
ignore case/accents or choose a primary-only strength without source evidence.
Generate bounded source-executed comparisons and whole-list order fixtures for
the observed default plus explicit en-US, es-MX, sv, tr, de and a non-Latin locale.
Cover accent/case differences, canonical-equivalent names, punctuation, numeric
substrings and equal-name stable ties. Preserve the exact locale/options used.
Compare actual ICU4X results against those expectations; report divergences rather
than rewriting fixtures to fit the candidate.

## Known version boundary

Root's installed Node24 baseline runtime reports ICU 78.3, CLDR 48.0, Unicode
17.0, default en-US, variant sensitivity, numeric false, caseFirst false and
ignorePunctuation false. The installed `icu_collator_data-2.2.0/README.md` reports
CLDR 48.2.0 and ICU release-78.1rc. These are not identical datasets. The selected
library is a candidate implementation to validate, not evidence of universal
string-order equivalence. Record source/target versions and affected cases; do
not claim exhaustive Unicode/platform parity from a finite corpus. Root owns
resolving material observed incompatibilities and execution-host locale discovery.
