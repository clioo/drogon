// NR-1 final-bundle notices verifier (leaf task, read-only inputs).
//
// Verifies the DEPENDENCY-NOTICES.txt bytes actually shipped inside a packaged
// bundle against an expected-manifest whose section texts were transcribed
// VERBATIM from accepted E5 evidence (never from generator output or any
// generated shipped artifact). Byte-exact per section: sha256 over the exact
// byte span, preserving full text, encoding and newlines. Fails closed on
// missing, changed, duplicate or extra sections, and on any expected entry
// whose corpus is still incomplete (font/Seti notice texts are not embedded
// in checked-in evidence yet — hashes/pointers only).
//
// Section grammar (read from scripts/package-notices.mjs, not imported):
// elements joined with a single "\n"; element 0 is the root LICENSE file and
// element 1 the root THIRD_PARTY_NOTICES.md (together the "rootPreamble",
// expected as LICENSE + "\n" + THIRD_PARTY); each package element is
// "\n\n## <key> — <license>\n" followed either by the pinned fallback
// ("Source: <url>\n" + "\n" + text, react-remove-scroll-bar@2.3.8 only) or
// one "### <filename>\n<text>" block per bundled license file.
import crypto from "node:crypto";

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

const HEADING_PATTERN = /\n\n## ([^\n]*) — ([^\n]*)\n/g;

/**
 * Splits shipped DEPENDENCY-NOTICES.txt bytes into sections per the grammar.
 * Package sections are anchored on full heading lines of the shape
 * "\n\n## <key> — <license>\n" (em-dash included); the root root files'
 * own markdown headings carry no em-dash, so they never split a package.
 * Returns [{ key, license, start, end, sha256, text }] where [start, end) is
 * the exact byte span of the element (excluding the single "\n" join between
 * elements), plus a leading { key: "__root_preamble__" } span for everything
 * before the first package heading.
 */
export function parseNoticeSections(shippedBytes) {
  const text = Buffer.from(shippedBytes).toString("utf8");
  const matches = [...text.matchAll(HEADING_PATTERN)];
  const byteLength = (slice) => Buffer.byteLength(slice, "utf8");
  const sections = [];
  const firstStart = matches.length ? matches[0].index : text.length;
  const preambleEnd = matches.length ? firstStart - 1 : text.length;
  sections.push({
    key: "__root_preamble__",
    license: null,
    start: 0,
    end: preambleEnd,
    text: text.slice(0, preambleEnd),
  });
  matches.forEach((match, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index - 1 : text.length;
    const element = text.slice(match.index, end);
    const startByte = byteLength(text.slice(0, match.index));
    sections.push({
      key: match[1],
      license: match[2],
      start: startByte,
      end: startByte + byteLength(element),
      text: element,
    });
  });
  for (const section of sections) {
    const bytes = Buffer.from(shippedBytes).subarray(section.start, section.end);
    section.sha256 = sha256Hex(bytes);
  }
  return sections;
}

/**
 * verifyFinalBundleNotices({ shippedBytes, expectedManifest }) ->
 * { ok, missing[], changed[{key, expectedSha256, actualSha256}], extra[],
 *   duplicates[], corpusIncomplete[] }.
 *
 * ok is true only when every array is empty. Manifest entries with
 * corpusIncomplete: true (no verbatim text held) never match shipped bytes
 * and always fail the verification closed.
 */
export function verifyFinalBundleNotices({ shippedBytes, expectedManifest }) {
  const result = {
    ok: false,
    missing: [],
    changed: [],
    extra: [],
    duplicates: [],
    corpusIncomplete: [],
  };
  if (!expectedManifest || !Array.isArray(expectedManifest.sections)) {
    return result;
  }
  const shipped = parseNoticeSections(shippedBytes ?? Buffer.alloc(0));
  const shippedByKey = new Map();
  for (const section of shipped) {
    if (section.key === null) {
      result.extra.push("(unparseable section)");
      continue;
    }
    if (shippedByKey.has(section.key)) {
      result.duplicates.push(section.key);
      continue;
    }
    shippedByKey.set(section.key, section);
  }
  const expectedKeys = new Set();
  for (const entry of expectedManifest.sections) {
    if (!entry || typeof entry.key !== "string") {
      result.extra.push("(manifest entry without key)");
      continue;
    }
    if (entry.corpusIncomplete) {
      result.corpusIncomplete.push(entry.key);
      continue;
    }
    expectedKeys.add(entry.key);
    if (typeof entry.text !== "string" || typeof entry.sha256 !== "string") {
      result.corpusIncomplete.push(entry.key);
      continue;
    }
    const section = shippedByKey.get(entry.key);
    if (!section) {
      result.missing.push(entry.key);
      continue;
    }
    const actualSha = sha256Hex(Buffer.from(shippedBytes ?? Buffer.alloc(0)).subarray(section.start, section.end));
    if (actualSha !== entry.sha256) {
      result.changed.push({ key: entry.key, expectedSha256: entry.sha256, actualSha256: actualSha });
    }
  }
  for (const [key] of shippedByKey) {
    if (!expectedKeys.has(key) && key !== "__root_preamble__") {
      result.extra.push(key);
    }
  }
  result.ok =
    result.missing.length === 0 &&
    result.changed.length === 0 &&
    result.extra.length === 0 &&
    result.duplicates.length === 0 &&
    result.corpusIncomplete.length === 0;
  return result;
}
