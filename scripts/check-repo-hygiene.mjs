#!/usr/bin/env node
// Submission-hygiene scan (R16-BQ): history-free sweep of the working tree
// for secrets and private paths. Fails closed: any finding not covered by
// scripts/check-repo-hygiene.allowlist.json exits non-zero with a JSON
// report. Run: node scripts/check-repo-hygiene.mjs [--root <dir>].
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const ALLOWLIST_SCHEMA = "drogon.repo-hygiene-allowlist/1";

// rule id -> { pattern, description }. Every pattern must be specific enough
// to stay silent on ordinary product code; the allowlist covers the rest.
export const RULES = {
  "orchestration-id": {
    pattern: /dcap_[A-Za-z0-9_-]{6,}|term_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|msg_[0-9a-f]{8,}/,
    description: "Orca orchestration capability/dispatch/terminal/message id",
  },
  "owner-path": {
    pattern: /\/Users\/carlos|\/private\/tmp/,
    description: "absolute private path from the maintainer machine",
  },
  "secret-token": {
    pattern: /sk-ant-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bap]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    description: "provider-shaped API token or private key block",
  },
  "reference-cdp": {
    pattern: /127\.0\.0\.1:9445/,
    description:
      "read-only reference CDP endpoint: pass it via --ref/$ORCA_REFERENCE_CDP, never hard-code it",
  },
  email: {
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
    description: "e-mail address (fixtures use @example.*)",
  },
};

// Synthetic addresses that are never real identities. Kept in code (not the
// allowlist) so fixture authors do not need an allowlist entry per test:
// RFC 2606 reserved names, mDNS .local fixture identities, bot "noreply"
// trailers asserted by git-fixture tests, retina asset names
// (icon_16x16@2x.png) and name@version patch filenames, which merely look
// like addresses.
const EMAIL_FIXTURE_ALLOW =
  /@example\.(com|org|net)$|\.test$|\.invalid$|\.local$|^git@github\.com$|^git@gist\.github\.com$|^noreply@(openai|github)\.com$|@\dx\.[a-z0-9]+$|@\d+\.\d+\.\d+/i;

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "dist",
  "out",
  ".preflight",
  ".qa",
]);
// The allowlist documents the exemptions it grants, so it necessarily names
// them; it is reviewed config, not scanned content.
const SKIP_FILES = new Set([
  ".git",
  "pnpm-lock.yaml",
  "Cargo.lock",
  // The allowlist documents the exemptions it grants, so it necessarily
  // names them; it is reviewed config, not scanned content.
  "check-repo-hygiene.allowlist.json",
]);
const MAX_BYTES = 5 * 1024 * 1024;

export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && !SKIP_FILES.has(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

export function scanText(relPath, text) {
  const findings = [];
  for (const [rule, { pattern }] of Object.entries(RULES)) {
    const global = new RegExp(pattern.source, "g");
    let match;
    let count = 0;
    while ((match = global.exec(text)) !== null && count < 5) {
      count += 1;
      const value = match[0];
      if (rule === "email" && EMAIL_FIXTURE_ALLOW.test(value)) continue;
      const lineStart = text.lastIndexOf("\n", match.index) + 1;
      const lineEnd = text.indexOf("\n", match.index);
      findings.push({
        rule,
        path: relPath,
        match: value.slice(0, 120),
        line: text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim().slice(0, 200),
      });
    }
  }
  return findings;
}

export function loadAllowlist(root) {
  const raw = JSON.parse(
    readFileSync(join(root, "scripts", "check-repo-hygiene.allowlist.json"), "utf8"),
  );
  if (raw?.schema !== ALLOWLIST_SCHEMA || !Array.isArray(raw.entries)) {
    throw new Error("invalid hygiene allowlist");
  }
  for (const entry of raw.entries) {
    if (
      typeof entry?.rule !== "string" ||
      typeof entry?.reason !== "string" ||
      (typeof entry?.path !== "string" && typeof entry?.pathPrefix !== "string")
    ) {
      throw new Error("invalid hygiene allowlist entry");
    }
  }
  return raw.entries;
}

export function isAllowed(finding, entries) {
  return entries.some(
    (entry) =>
      entry.rule === finding.rule &&
      (entry.path === finding.path ||
        (typeof entry.pathPrefix === "string" && finding.path.startsWith(entry.pathPrefix))) &&
      (!entry.match || finding.line.includes(entry.match)),
  );
}

export function checkRepoHygiene(root, entries) {
  const violations = [];
  let scanned = 0;
  for (const full of listFiles(root)) {
    let buffer;
    try {
      buffer = readFileSync(full);
    } catch {
      continue;
    }
    if (buffer.length > MAX_BYTES || buffer.includes(0)) continue;
    scanned += 1;
    const relPath = relative(root, full);
    for (const finding of scanText(relPath, buffer.toString("utf8"))) {
      if (!isAllowed(finding, entries)) violations.push(finding);
    }
  }
  return {
    schema: "drogon.repo-hygiene-check/1",
    ok: violations.length === 0,
    scanned,
    violations,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { root: { type: "string" } } });
    const root = resolve(
      values.root ?? join(dirname(fileURLToPath(import.meta.url)), ".."),
    );
    const result = checkRepoHygiene(root, loadAllowlist(root));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
