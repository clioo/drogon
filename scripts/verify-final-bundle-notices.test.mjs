// node --test suite for the NR-1 final-bundle notices verifier.
// Run: /Users/carlos/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test scripts/verify-final-bundle-notices.test.mjs
// The suite binds to the checked-in manifest (drogon.release.final-bundle-notices.v1)
// and assembles fixture shipped-notices bytes strictly from the manifest's own
// verbatim texts plus the documented section grammar — never from generator
// output. Negative cases assert fail-closed RESULTS (missing/changed/extra/
// duplicates/corpusIncomplete/errors naming keys or causes), never vacuous
// passes.
//
// The checked-in manifest is a SOURCE-CORPUS slice, not proof of complete
// packaged-dependency closure: the rewrite runtime's own package.json pins
// lucide 1.41.0 and @fontsource-variable/geist 5.3.0, not the historical
// lucide-react@0.577.0/1.26.0 pins this manifest carries. A green result
// here says the held source-corpus notices are byte-exact; it does not
// attest to the currently-packaged dependency set.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { bundlePaths } from "./desktop-artifacts.mjs";
import {
  parseNoticeSections,
  verifyFinalBundleNotices,
} from "./verify-final-bundle-notices.mjs";

const MANIFEST_PATH = path.join(
  import.meta.dirname,
  "..",
  "docs",
  "migration",
  "final-bundle-notices.manifest.json",
);

function loadManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

// Entries that carry verbatim expected text (the corpus we actually hold).
function assertableEntries(manifest) {
  return manifest.sections.filter((s) => !s.corpusIncomplete);
}

// Assemble shipped-notices bytes from manifest texts per the documented
// grammar: [rootPreamble, ...package sections] joined with a single "\n",
// where the preamble element is LICENSE + "\n" + THIRD_PARTY_NOTICES.md and
// each package element is "\n\n## key — license\n" + body.
function assembleShipped(entries, { omitKeys = [], mutate = null, extraHeadings = 0, duplicateKey = null, dropPinSourceLine = false } = {}) {
  const elements = [];
  for (const entry of entries) {
    if (entry.kind === "rootPreamble") {
      elements.push(entry.parts.license + "\n" + entry.parts.thirdParty);
      continue;
    }
    if (omitKeys.includes(entry.key)) continue;
    let text = entry.text;
    if (dropPinSourceLine && entry.pin) {
      text = text.replace(/Source: [^\n]*\n\n/, "");
      assert.notEqual(text, entry.text, "pin source line must have been dropped");
    }
    elements.push(text);
    if (duplicateKey === entry.key) elements.push(text);
  }
  for (let i = 0; i < extraHeadings; i++) {
    elements.push(`\n\n## filler-pkg-${i} — Other\n### LICENSE\nfiller body ${i}`);
  }
  if (mutate) elements[mutate.element] = mutate.apply(elements[mutate.element]);
  return Buffer.from(elements.join("\n"), "utf8");
}

const manifest = loadManifest();
const assertable = assertableEntries(manifest);

test("GREEN: full held corpus verifies byte-exact, naming every key", () => {
  assert.ok(assertable.length >= 6, "expected the npm + pin + root corpus");
  const shipped = assembleShipped(assertable);
  const result = verifyFinalBundleNotices({ shippedBytes: shipped, expectedManifest: manifest });
  assert.equal(result.ok, false, "checked-in manifest stays fail-closed while font corpus is incomplete");
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.extra, []);
  assert.deepEqual(result.duplicates, []);
  assert.ok(result.corpusIncomplete.length >= 5, "font/Seti corpus must be listed as incomplete");
  assert.ok(
    result.corpusIncomplete.some((k) => k.includes("SN-E8")),
    `corpusIncomplete must name the Seti evidence id, got ${JSON.stringify(result.corpusIncomplete)}`,
  );

  // The same corpus restricted to entries with text must pass outright.
  const textOnlyManifest = { schema: manifest.schema, sections: assertable };
  const green = verifyFinalBundleNotices({ shippedBytes: shipped, expectedManifest: textOnlyManifest });
  assert.deepEqual(green, {
    ok: true,
    errors: [],
    missing: [],
    changed: [],
    extra: [],
    duplicates: [],
    corpusIncomplete: [],
  });
});

test("parseNoticeSections names every shipped section key", () => {
  const shipped = assembleShipped(assertable);
  const sections = parseNoticeSections(shipped);
  const keys = sections.map((s) => s.key);
  for (const entry of assertable) {
    assert.ok(keys.includes(entry.key), `parsed sections must name ${entry.key}`);
  }
});

test("RED: an omitted section fails while naming the key", () => {
  const shipped = assembleShipped(assertable, { omitKeys: ["katex@0.16.47"] });
  const textOnly = { schema: manifest.schema, sections: assertable };
  const result = verifyFinalBundleNotices({ shippedBytes: shipped, expectedManifest: textOnly });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["katex@0.16.47"]);
});

test("RED: a single-byte change fails with expected/actual sha mismatch", () => {
  const lucide = assertable.find((s) => s.key === "lucide-react@1.26.0");
  const idx = assertable.indexOf(lucide);
  const shipped = assembleShipped(assertable, {
    mutate: {
      element: idx,
      apply: (text) => text.replace("Permission is hereby granted", "Permission is hereby granted!"),
    },
  });
  const textOnly = { schema: manifest.schema, sections: assertable };
  const result = verifyFinalBundleNotices({ shippedBytes: shipped, expectedManifest: textOnly });
  assert.equal(result.ok, false);
  assert.equal(result.changed.length, 1);
  assert.equal(result.changed[0].key, "lucide-react@1.26.0");
  assert.equal(result.changed[0].expectedSha256, lucide.sha256);
  assert.notEqual(result.changed[0].actualSha256, result.changed[0].expectedSha256);
  assert.equal(result.missing.length, 0);
});

test("anti-count: right heading count with wrong bodies must fail naming keys", () => {
  // 5 real package headings + 186 filler headings = 191 package-shaped
  // headings total; one package body is altered, so a heading-COUNT-only
  // checker would pass this fixture while the bytes are wrong.
  const shipped = assembleShipped(assertable, {
    extraHeadings: 186,
    mutate: {
      element: assertable.findIndex((s) => s.kind === "package"),
      apply: (text) => text + " ",
    },
  });
  const textOnly = { schema: manifest.schema, sections: assertable };
  const result = verifyFinalBundleNotices({ shippedBytes: shipped, expectedManifest: textOnly });
  assert.equal(result.ok, false);
  const headingCount = (shipped.toString("utf8").match(/\n\n## [^\n]+ — [^\n]+\n/g) || []).length;
  assert.equal(headingCount, 191, "fixture must have exactly 191 package-shaped headings");
  assert.equal(result.changed.length, 1, "the mutated package body must be flagged");
  assert.ok(result.changed.every((c) => c.expectedSha256 !== c.actualSha256));
  assert.equal(result.extra.length, 186);
  assert.ok(result.extra.every((k) => k.startsWith("filler-pkg-")));
});

test("react-remove-scroll-bar pin is required: absent pin section fails by key", () => {
  const textOnly = { schema: manifest.schema, sections: assertable };
  const withoutPin = assembleShipped(assertable, { omitKeys: ["react-remove-scroll-bar@2.3.8"] });
  const result = verifyFinalBundleNotices({ shippedBytes: withoutPin, expectedManifest: textOnly });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["react-remove-scroll-bar@2.3.8"]);
});

test("react-remove-scroll-bar pin Source line is byte-required", () => {
  const textOnly = { schema: manifest.schema, sections: assertable };
  const shipped = assembleShipped(assertable, { dropPinSourceLine: true });
  const result = verifyFinalBundleNotices({ shippedBytes: shipped, expectedManifest: textOnly });
  assert.equal(result.ok, false);
  assert.ok(result.changed.some((c) => c.key === "react-remove-scroll-bar@2.3.8"));
});

test("extra sections are rejected and named", () => {
  const textOnly = { schema: manifest.schema, sections: assertable };
  const shipped = assembleShipped(assertable, { extraHeadings: 1 });
  const result = verifyFinalBundleNotices({ shippedBytes: shipped, expectedManifest: textOnly });
  assert.equal(result.ok, false);
  assert.deepEqual(result.extra, ["filler-pkg-0"]);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.changed, []);
});

test("duplicate sections are rejected and named", () => {
  const textOnly = { schema: manifest.schema, sections: assertable };
  const shipped = assembleShipped(assertable, { duplicateKey: "katex@0.16.45" });
  const result = verifyFinalBundleNotices({ shippedBytes: shipped, expectedManifest: textOnly });
  assert.equal(result.ok, false);
  assert.deepEqual(result.duplicates, ["katex@0.16.45"]);
});

test("synthetic mkdtemp bundle path via bundlePaths().notices (NOT installed-bundle proof): fails closed absent, verifies real file bytes once written", () => {
  // This fixture is a synthetic scratch directory built by this test, never
  // an actual packaged/installed Drogon bundle. It only proves the verifier
  // reads real bytes off a real path shaped by bundlePaths(); it is not
  // evidence about what a real packaging step actually produces.
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), "dg-notices-bundle-"));
  try {
    const noticesPath = bundlePaths(path.join(bundle, "Drogon.app"), "darwin").notices;
    assert.equal(path.basename(noticesPath), "DEPENDENCY-NOTICES.txt");
    assert.equal(fs.existsSync(noticesPath), false, "fixture bundle must start without a notices file");
    // Absent file semantics: empty shipped bytes fail closed, naming every
    // expected package key as missing (and the preamble as changed).
    const absent = verifyFinalBundleNotices({
      shippedBytes: fs.existsSync(noticesPath) ? fs.readFileSync(noticesPath) : Buffer.alloc(0),
      expectedManifest: { schema: manifest.schema, sections: assertable },
    });
    assert.equal(absent.ok, false);
    const packageKeys = assertable.filter((s) => s.kind === "package").map((s) => s.key);
    assert.ok(packageKeys.length >= 5, "expected the npm + pin package corpus");
    for (const key of packageKeys) {
      assert.ok(absent.missing.includes(key), `absent notices must name ${key} as missing`);
    }
    assert.ok(absent.changed.some((c) => c.key === "__root_preamble__"));

    // Present file: write full-corpus bytes to the REAL derived path and verify
    // the actual file bytes read back from disk, naming keys with matching shas.
    const shipped = assembleShipped(assertable);
    fs.mkdirSync(path.dirname(noticesPath), { recursive: true });
    fs.writeFileSync(noticesPath, shipped);
    const result = verifyFinalBundleNotices({
      shippedBytes: fs.readFileSync(noticesPath),
      expectedManifest: { schema: manifest.schema, sections: assertable },
    });
    assert.deepEqual(result, {
      ok: true,
      errors: [],
      missing: [],
      changed: [],
      extra: [],
      duplicates: [],
      corpusIncomplete: [],
    });
    const parsed = parseNoticeSections(fs.readFileSync(noticesPath));
    for (const entry of assertable) {
      const section = parsed.find((s) => s.key === entry.key);
      assert.ok(section, `real file must contain ${entry.key}`);
      assert.equal(section.sha256, entry.sha256, `${entry.key} bytes must match the manifest sha`);
    }
  } finally {
    fs.rmSync(bundle, { recursive: true, force: true });
  }
});

// --- Manifest-validation regression tests (ROOT-reproduced defect #1) ---
// verifyFinalBundleNotices({ shippedBytes: Buffer.from(arbitrary), expectedManifest: { sections: [] } })
// must never return ok:true: an empty/malformed expected manifest has
// nothing to check against, so it must fail CLOSED naming the cause, not
// vacuously pass because every result array happens to stay empty.

test("empty-manifest rejection: {sections: []} fails closed instead of vacuously passing", () => {
  const result = verifyFinalBundleNotices({
    shippedBytes: Buffer.from("arbitrary bytes, not a real bundle", "utf8"),
    expectedManifest: { sections: [] },
  });
  assert.equal(result.ok, false, "an empty manifest must never verify as ok:true");
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0, "must name a cause");
  assert.ok(result.errors.some((e) => /non-empty array/.test(e)));
});

test("missing-preamble rejection: a manifest without __root_preamble__ fails closed", () => {
  const bodyText = "\n\n## some-pkg@1.0.0 — MIT\n### LICENSE\nbody\n";
  const result = verifyFinalBundleNotices({
    shippedBytes: Buffer.from("whatever", "utf8"),
    expectedManifest: {
      schema: "drogon.release.final-bundle-notices.v1",
      sections: [{ key: "some-pkg@1.0.0", text: bodyText, sha256: sha256(Buffer.from(bodyText, "utf8")) }],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("__root_preamble__")));
});

test("duplicate expected keys rejection: two manifest entries sharing a key fail closed", () => {
  const preambleText = "root preamble";
  const pkgText = "\n\n## dup-pkg@1.0.0 — MIT\n### LICENSE\nbody\n";
  const result = verifyFinalBundleNotices({
    shippedBytes: Buffer.from("whatever", "utf8"),
    expectedManifest: {
      schema: "drogon.release.final-bundle-notices.v1",
      sections: [
        { key: "__root_preamble__", text: preambleText, sha256: sha256(Buffer.from(preambleText, "utf8")) },
        { key: "dup-pkg@1.0.0", text: pkgText, sha256: sha256(Buffer.from(pkgText, "utf8")) },
        { key: "dup-pkg@1.0.0", text: pkgText, sha256: sha256(Buffer.from(pkgText, "utf8")) },
      ],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("dup-pkg@1.0.0")));
});

test("invalid-UTF-8 shipped bytes fail closed", () => {
  // 0xC3 expects a UTF-8 continuation byte (0x80-0xBF); 0x28 is not one.
  const invalidUtf8 = Buffer.from([0x4c, 0xc3, 0x28, 0x4d]);
  const textOnlyManifest = { schema: manifest.schema, sections: assertable };
  const result = verifyFinalBundleNotices({ shippedBytes: invalidUtf8, expectedManifest: textOnlyManifest });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /utf-?8/i.test(e)));
});

// --- Byte-vs-character preamble span regressions (ROOT-reproduced defect #2) ---
// preamble.end must be a UTF-8 BYTE offset. A JS string character index is
// wrong whenever the preamble contains a multi-byte character (e.g. "©"):
// using the character count as a byte offset truncates (or overruns) the
// hashed span by however many extra bytes those characters contributed,
// making an exactly-matching shipped preamble register as "changed".

function buildUnicodePreambleFixture() {
  const preambleText = "Copyright © 2026 Drogon contributors";
  const pkgKey = "demo-pkg@1.0.0";
  const pkgElement = `\n\n## ${pkgKey} — MIT\n### LICENSE\nDemo license body.\n`;
  const shippedBytes = Buffer.from(preambleText + "\n" + pkgElement, "utf8");
  const expectedManifest = {
    schema: "drogon.release.final-bundle-notices.v1",
    sections: [
      { key: "__root_preamble__", text: preambleText, sha256: sha256(Buffer.from(preambleText, "utf8")) },
      { key: pkgKey, text: pkgElement, sha256: sha256(Buffer.from(pkgElement, "utf8")) },
    ],
  };
  return { preambleText, pkgKey, pkgElement, shippedBytes, expectedManifest };
}

test("Unicode preamble byte-exactness: a non-ASCII preamble that matches verbatim verifies GREEN", () => {
  const { shippedBytes, expectedManifest } = buildUnicodePreambleFixture();
  const result = verifyFinalBundleNotices({ shippedBytes, expectedManifest });
  assert.deepEqual(result, {
    ok: true,
    errors: [],
    missing: [],
    changed: [],
    extra: [],
    duplicates: [],
    corpusIncomplete: [],
  });
});

test("byte-shifted negative: a genuine mutation after a non-ASCII preamble is still caught", () => {
  const { preambleText, shippedBytes, expectedManifest } = buildUnicodePreambleFixture();
  // Flip one ASCII byte inside the (post-©) preamble span itself, proving the
  // fix still detects a real content change and hasn't just gone permissive.
  const mutated = Buffer.from(shippedBytes);
  const charIdx = preambleText.indexOf("contributors");
  const byteIdx = Buffer.byteLength(preambleText.slice(0, charIdx), "utf8");
  assert.equal(mutated[byteIdx], "c".charCodeAt(0));
  mutated[byteIdx] = "C".charCodeAt(0);
  const result = verifyFinalBundleNotices({ shippedBytes: mutated, expectedManifest });
  assert.equal(result.ok, false);
  assert.ok(result.changed.some((c) => c.key === "__root_preamble__"));
});
