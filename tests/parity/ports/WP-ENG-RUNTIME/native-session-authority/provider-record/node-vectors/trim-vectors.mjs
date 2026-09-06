// Verifies the exact ECMAScript String.prototype.trim character set against
// which the port's is_js_trim_whitespace is pinned. Complements
// generate-vectors.mjs; captured with the pinned Node 24 runtime.
// Source uses only ASCII: every tested character is spelled as a JS \uXXXX
// escape via the TOKENS below (patched in place, see report.md disclosures).
//
// Execution (working directory: Drogon-rewrite repo root; runtime read-only):
//   /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
//     tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/trim-vectors.mjs
// Runtime: Node v24.19.0. SHA256 recorded in report.json.
const t = (s) => s === s.trim();
console.log(
  JSON.stringify({
    // U+0085 NEL: NOT in the ECMAScript trim set -- padded value stays valid.
    nelPadded: t('\u0085field\u0085'),
    // U+FEFF ZWNBSP: IS trimmed -- padded value becomes invalid.
    feffPadded: t('\uFEFFfield\uFEFF'),
    nelOnlyTrimmedLength: '\u0085'.trim().length,
    // U+000B VT: trimmed.
    vtPadded: t('\u000Bf\u000B'),
    // U+180E Mongolian vowel separator: NOT trimmed (removed from WhiteSpace in ES6).
    mongolianPadded: t('\u180Ef\u180E'),
    // U+2009 thin space: trimmed (inside U+2000..U+200A).
    thinSpacePadded: t('\u2009f\u2009'),
    // U+2028/U+2029 line/paragraph separators: trimmed.
    lineSepPadded: t('\u2028f\u2028'),
    paraSepPadded: t('\u2029f\u2029'),
    // U+2060 word joiner and U+200B zero-width space: NOT trimmed.
    wordJoinerPadded: t('\u2060f\u2060'),
    zeroWidthSpacePadded: t('\u200Bf\u200B')
  })
);
