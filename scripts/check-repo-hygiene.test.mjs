import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkRepoHygiene,
  isAllowed,
  loadAllowlist,
  scanText,
} from "./check-repo-hygiene.mjs";

const RULES = {
  orchestration: "dispatch dcap_SYNTHETIC0123456789abcdef--tA80 done",
  terminal: "from term_11111111-2222-3333-4444-555555555555 hello",
  message: "see msg_aaaabbbbccccdddd for context",
  ownerPath: "root /Users/carlos/Documents/x",
  privateTmp: "dir /private/tmp/xyz",
  token: "key ghp_abcdefghij1234567890",
  privateKey: "-----BEGIN EC PRIVATE KEY-----",
  cdp: "ref http://127.0.0.1:9445 here",
};

test("flags every rule family with its rule id", () => {
  const findings = scanText("a.ts", Object.values(RULES).join("\n"));
  const byRule = new Map(findings.map((f) => [f.match, f.rule]));
  assert.equal(byRule.get(RULES.orchestration.match(/dcap_\S+/)?.[0]), "orchestration-id");
  assert.equal(byRule.get("term_11111111-2222-3333-4444-555555555555"), "orchestration-id");
  assert.equal(byRule.get("msg_aaaabbbbccccdddd"), "orchestration-id");
  assert.equal(byRule.get("/Users/carlos"), "owner-path");
  assert.equal(byRule.get("/private/tmp"), "owner-path");
  assert.equal(byRule.get("ghp_abcdefghij1234567890"), "secret-token");
  assert.equal(byRule.get("-----BEGIN EC PRIVATE KEY-----"), "secret-token");
  assert.equal(byRule.get("127.0.0.1:9445"), "reference-cdp");
});

test("flags a non-allowlisted mailbox but skips fixture addresses", () => {
  const flagged = scanText("a.ts", "contact maintainer@internal.corp here");
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].rule, "email");
  for (const ok of [
    "fixture@example.com",
    "someone@example.test",
    "fixture@example.invalid",
    "acceptance@drogon.local",
    "git@github.com:clioo/drogon.git",
    "Co-authored-by: Codex <noreply@openai.com>",
    '["icon_16x16@2x.png", 32]',
    "vscode__windows-process-tree@0.8.0.patch",
  ]) {
    assert.deepEqual(scanText("a.ts", ok), [], `should skip: ${ok}`);
  }
});

test("keeps localhost fixtures silent (only the reference CDP port fails)", () => {
  assert.deepEqual(scanText("a.test.ts", "http://127.0.0.1:4173/ and localhost:8931"), []);
  assert.equal(scanText("a.ts", RULES.cdp)[0].rule, "reference-cdp");
});

test("allowlist matches exact paths, prefixes and match substrings", () => {
  const entries = [
    { rule: "owner-path", path: "AGENTS.md", reason: "test" },
    { rule: "email", pathPrefix: "docs/migration/", reason: "test" },
    { rule: "owner-path", path: "x.mjs", match: "Drogon-mentu", reason: "test" },
  ];
  assert.equal(
    isAllowed({ rule: "owner-path", path: "AGENTS.md", line: "x" }, entries),
    true,
  );
  assert.equal(
    isAllowed({ rule: "email", path: "docs/migration/n.md", line: "x" }, entries),
    true,
  );
  assert.equal(
    isAllowed({ rule: "owner-path", path: "x.mjs", line: "a Drogon-mentu b" }, entries),
    true,
  );
  assert.equal(
    isAllowed({ rule: "owner-path", path: "x.mjs", line: "unrelated" }, entries),
    false,
  );
  assert.equal(
    isAllowed({ rule: "email", path: "AGENTS.md", line: "x" }, entries),
    false,
  );
});

test("rejects malformed allowlists instead of passing open", () => {
  assert.throws(() => loadAllowlist("/nonexistent-root"), /ENOENT/);
});

test("end to end: planted violations fail, allowlisted ones pass", (t) => {
  const root = mkdtempSync(join(tmpdir(), "drogon-hygiene-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "clean.ts"), "export const x = 1;\n");
  writeFileSync(join(root, "leak.ts"), "const token = 'ghp_abcdefghij1234567890';\n");
  writeFileSync(
    join(root, "scripts", "check-repo-hygiene.allowlist.json"),
    JSON.stringify({ schema: "drogon.repo-hygiene-allowlist/1", entries: [] }),
  );
  const failing = checkRepoHygiene(root, loadAllowlist(root));
  assert.equal(failing.ok, false);
  assert.equal(failing.violations.length, 1);
  assert.equal(failing.violations[0].rule, "secret-token");
  const passing = checkRepoHygiene(root, [
    { rule: "secret-token", path: "leak.ts", reason: "test" },
  ]);
  assert.equal(passing.ok, true);
});

test("end to end: binary files and skipped dirs stay out of scope", (t) => {
  const root = mkdtempSync(join(tmpdir(), "drogon-hygiene-bin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x67, 0x68, 0x70, 0x5f]));
  writeFileSync(join(root, "node_modules", "pkg", "x.js"), "ghp_abcdefghij1234567890");
  writeFileSync(
    join(root, "scripts", "check-repo-hygiene.allowlist.json"),
    JSON.stringify({ schema: "drogon.repo-hygiene-allowlist/1", entries: [] }),
  );
  const result = checkRepoHygiene(root, loadAllowlist(root));
  assert.equal(result.ok, true);
});
