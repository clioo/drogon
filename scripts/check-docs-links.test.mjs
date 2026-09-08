import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkDocsLinks, extractTargets, fileHeadings, slugifyHeading } from "./check-docs-links.mjs";

test("slugifies headings the way GitHub anchors work", () => {
  assert.equal(slugifyHeading("Run locally"), "run-locally");
  assert.equal(slugifyHeading("`⌘K` command palette"), "k-command-palette");
  assert.equal(slugifyHeading("Feature tour: the twelve MVP journeys"), "feature-tour-the-twelve-mvp-journeys");
});

test("finds headings and extracts inline, image and html targets", () => {
  const text = [
    "# Title",
    "## Run locally",
    "[a](docs/x.md) ![b](img.png) [c](#run-locally) [d](https://example.com)",
    '<a href="other.md">e</a>',
  ].join("\n");
  assert.ok(fileHeadings(text).has("run-locally"));
  assert.deepEqual(extractTargets(text), [
    "docs/x.md",
    "img.png",
    "#run-locally",
    "https://example.com",
    "other.md",
  ]);
});

test("end to end: resolves files and same-file anchors, reports the rest", (t) => {
  const root = mkdtempSync(join(tmpdir(), "drogon-links-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "real.md"), "# Real Target\n");
  writeFileSync(
    join(root, "README.md"),
    [
      "# T",
      "[ok](docs/real.md)",
      "[ok-anchor](docs/real.md#real-target)",
      "[missing](docs/gone.md)",
      "[bad-anchor](docs/real.md#nope)",
      "[same-ok](#t)",
      "[same-bad](#nope)",
      "[external](https://github.com/clioo/drogon)",
    ].join("\n"),
  );
  const result = checkDocsLinks(root, ["README.md"]);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.broken.map((b) => b.target).sort(),
    ["#nope", "docs/gone.md", "docs/real.md#nope"],
  );
});

test("end to end: missing doc itself is reported, not thrown", (t) => {
  const root = mkdtempSync(join(tmpdir(), "drogon-links-missing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const result = checkDocsLinks(root, ["docs/SUBMISSION.md"]);
  assert.equal(result.ok, false);
  assert.match(result.broken[0].reason, /missing from working tree/);
});
