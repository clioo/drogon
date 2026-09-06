// Captures the JavaScript ground-truth vectors asserted by the candidate
// tests (JSON.stringify escaping, handle-key encodings, UTF-16 lengths,
// launch-args byte bound). All string literals use ASCII escape sequences
// only, so the file itself contains no control bytes.
//
// Provenance (review correction round, task_409e1056b0a9 / ctx_09689a2eb286):
// originally generated 2026-09-06 by the worker at the temporary path
// /var/folders/8g/w9x4n8ws4mx6vxjhmnrnwy640000gn/T/opencode/jsvec.mjs (a
// deviation from owned-path hygiene, disclosed in report.md); that exact
// temporary file was deleted and this generator placed under the owned
// subtree.
//
// Execution (working directory is the Drogon-rewrite repo root, never the
// read-only reference checkout; runtime is read-only):
//   /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
//     tests/parity/ports/WP-ENG-RUNTIME/native-session-authority/provider-record/node-vectors/generate-vectors.mjs
// Runtime: Node v24.19.0 (pinned Node24 path from AGENTS.md).
// SHA256 of this file is recorded in report.json.
const J = JSON.stringify;
const out = {
  nul: J('\u0000'),
  ctl01: J('\u0001'),
  ctl08: J('\u0008'),
  ctl0c: J('\u000c'),
  ctl1f: J('\u001f'),
  del7f: J('\u007f'),
  sep2028: J('\u2028'),
  sep2029: J('\u2029'),
  combining: J('e\u0301'),
  keyNul: 'claude:' + J(['a\u0000b', null]),
  utf16: { twoEmoji: '\u{1F600}\u{1F600}'.length, at512: 'x'.repeat(512).length },
};
const mk = (n) => '[' + J('x'.repeat(n)) + ']';
out.launchBound = {
  ok16382: Buffer.byteLength(mk(16382), 'utf8'),
  over16383: Buffer.byteLength(mk(16383), 'utf8'),
};
console.log(JSON.stringify(out));
