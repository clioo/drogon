#!/usr/bin/env node
// Docs link check (R16-BQ): every relative markdown link and image in the
// owned docs must resolve to a file in the working tree, and every same-file
// #anchor must match a heading in that file. External URLs are out of scope
// (no network in CI). Run: node scripts/check-docs-links.mjs [--root <dir>].
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const OWNED_DOCS = [
  "README.md",
  "CHANGELOG.md",
  "docs/demo-script.md",
  "docs/SUBMISSION.md",
  "docs/reference/packaging-icon-invariant.md",
  "docs/reference/perf-navigation.md",
];

export function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/`([^`]*)`/g, "$1")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function fileHeadings(text) {
  const headings = new Set();
  for (const line of text.split("\n")) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line.trimEnd());
    if (match) headings.add(slugifyHeading(match[2]));
  }
  return headings;
}

// Inline links/images plus <a href>/<img src>. Reference-style links are
// unused in the owned docs; bare URLs are external by construction.
export function extractTargets(text) {
  const targets = [];
  const inline = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = inline.exec(text)) !== null) targets.push(match[1]);
  const html = /<(?:a|img)[^>]*(?:href|src)="([^"]+)"/gi;
  while ((match = html.exec(text)) !== null) targets.push(match[1]);
  return targets;
}

export function checkDocsLinks(root, docs) {
  const broken = [];
  for (const doc of docs) {
    let text;
    try {
      text = readFileSync(join(root, doc), "utf8");
    } catch {
      broken.push({ doc, target: null, reason: "doc missing from working tree" });
      continue;
    }
    const headings = fileHeadings(text);
    for (const raw of extractTargets(text)) {
      if (/^(https?:|mailto:|data:)/i.test(raw)) continue;
      const [filePart, anchor] = raw.split("#");
      if (!filePart) {
        if (anchor && !headings.has(anchor.toLowerCase())) {
          broken.push({ doc, target: raw, reason: "same-file anchor has no heading" });
        }
        continue;
      }
      const resolved = resolve(root, dirname(doc), decodeURIComponent(filePart));
      let stat = null;
      try {
        stat = statSync(resolved);
      } catch {
        stat = null;
      }
      if (!stat) {
        broken.push({ doc, target: raw, reason: "relative target missing" });
        continue;
      }
      if (anchor && stat.isFile()) {
        let targetText = null;
        try {
          targetText = readFileSync(resolved, "utf8");
        } catch {
          targetText = null;
        }
        if (targetText !== null && !fileHeadings(targetText).has(anchor.toLowerCase())) {
          broken.push({ doc, target: raw, reason: "anchor has no heading in target" });
        }
      }
    }
  }
  return { schema: "drogon.docs-links-check/1", ok: broken.length === 0, docs: docs.length, broken };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { root: { type: "string" } } });
    const root = resolve(
      values.root ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
    );
    const result = checkDocsLinks(root, OWNED_DOCS);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
