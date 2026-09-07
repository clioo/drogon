// NR-1 final-bundle notices verifier (leaf task, read-only inputs).
//
// Byte-exact sha256 per section of shipped DEPENDENCY-NOTICES.txt bytes vs an
// expected manifest transcribed VERBATIM from accepted E5 evidence (never
// generator/shipped-artifact output). Fails closed on missing/changed/
// duplicate/extra sections, incomplete-corpus entries, an invalid manifest,
// invalid UTF-8, or a grammar-violating inter-section byte.
//
// The checked-in manifest is a SOURCE-CORPUS slice, not proof of complete
// packaged-dependency closure: it pins lucide-react@0.577.0/1.26.0 from the
// historical source, while the rewrite runtime's own package.json pins
// lucide 1.41.0 and @fontsource-variable/geist 5.3.0. A green result here
// attests only that the held source-corpus notices are byte-exact.
//
// Section grammar (read from scripts/package-notices.mjs, not imported):
// elements joined with a single "\n"; element 0 is the root LICENSE file and
// element 1 the root THIRD_PARTY_NOTICES.md (together the "rootPreamble");
// each package element is "\n\n## <key> — <license>\n" followed either by
// the pinned fallback ("Source: <url>\n\n" + text, react-remove-scroll-bar
// only) or one "### <filename>\n<text>" block per bundled license file.
import crypto from "node:crypto";

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

const HEADING_PATTERN = /\n\n## ([^\n]*) — ([^\n]*)\n/g;
const SUPPORTED_SCHEMAS = new Set(["drogon.release.final-bundle-notices.v1"]);

// Splits shipped bytes into sections anchored on package heading lines
// "\n\n## <key> — <license>\n" (root files' own headings carry no em-dash,
// so they never split a package). Returns [{ key, license, start, end,
// sha256, text }] with byte-offset (never char-index) [start, end) spans,
// excluding the single "\n" join between elements, plus a leading
// { key: "__root_preamble__" } span for everything before the first heading.
// NOTE: this only locates spans; it does not itself validate the excluded
// byte is really a lone LF — verifyFinalBundleNotices's separator check does.
export function parseNoticeSections(shippedBytes) {
  const text = Buffer.from(shippedBytes).toString("utf8");
  const matches = [...text.matchAll(HEADING_PATTERN)];
  const byteLength = (slice) => Buffer.byteLength(slice, "utf8");
  const sections = [];
  const firstStart = matches.length ? matches[0].index : text.length;
  const preambleEndChar = matches.length ? firstStart - 1 : text.length;
  const preambleText = text.slice(0, preambleEndChar);
  sections.push({
    key: "__root_preamble__",
    license: null,
    start: 0,
    end: byteLength(preambleText),
    text: preambleText,
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

// Buffer#toString("utf8") silently substitutes U+FFFD instead of throwing on
// invalid sequences, so a round-trip compare is required to actually detect
// invalid UTF-8 shipped bytes.
function isValidUtf8(bytes) {
  return Buffer.compare(Buffer.from(bytes.toString("utf8"), "utf8"), bytes) === 0;
}

// Every byte excluded from a hashed span (the gap between consecutive
// sections) must be exactly one 0x0A join byte — otherwise a mutated,
// added, or removed separator byte sits outside every span and is never
// hashed or checked, letting it pass unnoticed. Byte-domain (Buffer
// indexes), not char arithmetic, so multi-byte characters adjacent to a
// boundary can't shift or split a span.
function validateSeparators(bytes, sections) {
  const errors = [];
  for (let i = 0; i + 1 < sections.length; i++) {
    const prev = sections[i];
    const next = sections[i + 1];
    const gap = bytes.subarray(prev.end, next.start);
    if (gap.length !== 1 || gap[0] !== 0x0a) {
      errors.push(
        `separator between "${prev.key}" and "${next.key}" must be exactly one 0x0A (LF) byte, found ${gap.length} byte(s): ${JSON.stringify([...gap])}`,
      );
    }
  }
  return errors;
}

// Structural validation of the expected manifest itself, independent of any
// shipped bytes. Empty result means well-formed enough to compare; this is
// what makes an empty/malformed manifest fail CLOSED instead of vacuously
// reporting ok:true because every diff array happened to stay empty.
function validateManifest(expectedManifest) {
  const errors = [];
  if (!expectedManifest || typeof expectedManifest !== "object") {
    errors.push("expectedManifest must be an object");
    return errors;
  }
  if (!SUPPORTED_SCHEMAS.has(expectedManifest.schema)) {
    errors.push(
      `expectedManifest.schema must be one of [${[...SUPPORTED_SCHEMAS].join(", ")}], got ${JSON.stringify(expectedManifest.schema)}`,
    );
  }
  if (!Array.isArray(expectedManifest.sections) || expectedManifest.sections.length === 0) {
    errors.push("expectedManifest.sections must be a non-empty array");
    return errors;
  }
  const seenKeys = new Set();
  const duplicateKeys = new Set();
  let rootPreambleCount = 0;
  expectedManifest.sections.forEach((entry, index) => {
    if (!entry || typeof entry.key !== "string" || entry.key.length === 0) {
      errors.push(`expectedManifest.sections[${index}] is missing a non-empty string key`);
      return;
    }
    if (seenKeys.has(entry.key)) {
      duplicateKeys.add(entry.key);
    }
    seenKeys.add(entry.key);
    if (entry.key === "__root_preamble__") {
      rootPreambleCount += 1;
    }
    if (entry.corpusIncomplete) {
      return;
    }
    if (typeof entry.text !== "string" || typeof entry.sha256 !== "string" || entry.sha256.length === 0) {
      errors.push(
        `expectedManifest.sections entry "${entry.key}" must have text and sha256 unless marked corpusIncomplete`,
      );
      return;
    }
    const selfSha = sha256Hex(Buffer.from(entry.text, "utf8"));
    if (selfSha !== entry.sha256) {
      errors.push(
        `expectedManifest.sections entry "${entry.key}" has sha256 that does not match its own text (manifest is self-inconsistent)`,
      );
    }
  });
  for (const key of duplicateKeys) {
    errors.push(`expectedManifest.sections has a duplicate expected key: "${key}"`);
  }
  if (rootPreambleCount !== 1) {
    errors.push(`expectedManifest.sections must contain exactly one "__root_preamble__" entry, found ${rootPreambleCount}`);
  }
  return errors;
}

/**
 * verifyFinalBundleNotices({ shippedBytes, expectedManifest }) ->
 * { ok, errors[], missing[], changed[{key, expectedSha256, actualSha256}],
 *   extra[], duplicates[], corpusIncomplete[] }.
 *
 * ok is true only when every array is empty. `errors` names structural
 * problems that make comparison meaningless — an invalid/empty manifest,
 * non-UTF-8 shipped bytes, or a grammar-violating inter-section byte — and
 * always fails closed without attempting the per-key comparison.
 * corpusIncomplete: true entries never match shipped bytes and always fail
 * closed.
 */
export function verifyFinalBundleNotices({ shippedBytes, expectedManifest } = {}) {
  const errors = validateManifest(expectedManifest);
  const bytes = Buffer.isBuffer(shippedBytes) ? shippedBytes : Buffer.from(shippedBytes ?? Buffer.alloc(0));
  if (!isValidUtf8(bytes)) {
    errors.push("shippedBytes are not valid UTF-8");
  }
  const result = {
    ok: false,
    errors,
    missing: [],
    changed: [],
    extra: [],
    duplicates: [],
    corpusIncomplete: [],
  };
  if (errors.length > 0) {
    return result;
  }

  const shipped = parseNoticeSections(bytes);
  const separatorErrors = validateSeparators(bytes, shipped);
  if (separatorErrors.length > 0) {
    result.errors.push(...separatorErrors);
    return result;
  }

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
    if (entry.corpusIncomplete) {
      result.corpusIncomplete.push(entry.key);
      continue;
    }
    expectedKeys.add(entry.key);
    const section = shippedByKey.get(entry.key);
    if (!section) {
      result.missing.push(entry.key);
      continue;
    }
    const actualSha = sha256Hex(bytes.subarray(section.start, section.end));
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
    result.errors.length === 0 &&
    result.missing.length === 0 &&
    result.changed.length === 0 &&
    result.extra.length === 0 &&
    result.duplicates.length === 0 &&
    result.corpusIncomplete.length === 0;
  return result;
}
