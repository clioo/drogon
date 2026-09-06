import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CapsuleRefusal,
  assertNoOverlap,
  assertNoSymlinkInPath,
  assertSafeRelativePath,
  assertSafeSingleComponentId,
  evaluateExecution,
  executeCapsule,
  loadManifest,
  readManifestDigest,
  resolveCanonicalCapsuleParent,
  sha256,
  spawnNodeScript,
  stageCapsule,
} from "./run-parity-baseline-capsule.mjs";

// This suite builds its own throwaway git fixture repo and its own fake
// "repoRoot" under os.tmpdir() -- it never reads from, writes to, or stages
// into the real legacy repository or this repo's own real
// .preflight/parity-baseline (which retains prior pilot evidence that must
// never be deleted), and never touches global git config (every commit
// uses repo-local -c user.email/user.name plus a Codex trailer). Only the
// exact disposable directories created inside beforeEach/it below are
// removed in afterEach.

const CODEX_TRAILER = "Co-authored-by: Codex <noreply@openai.com>";

function gitLocal(cwd, args) {
  return execFileSync(
    "git",
    ["-c", "user.email=capsule-test@example.invalid", "-c", "user.name=capsule-test", ...args],
    { cwd, encoding: "utf8" },
  ).trim();
}

function commitFixture(root, message) {
  gitLocal(root, ["add", "-A"]);
  gitLocal(root, ["commit", "--quiet", "-m", `${message}\n\n${CODEX_TRAILER}`]);
  return gitLocal(root, ["rev-parse", "HEAD"]);
}

function buildFixtureSourceRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "parity-capsule-source-"));
  gitLocal(root, ["init", "--quiet"]);
  mkdirSync(path.join(root, "src", "shared"), { recursive: true });
  writeFileSync(path.join(root, "src/shared/pure-module.ts"), "export const ANSWER = 42;\n");
  writeFileSync(
    path.join(root, "src/shared/pure-module.test.ts"),
    "import { expect, it } from 'vitest'\nimport { ANSWER } from './pure-module'\nit('is 42', () => { expect(ANSWER).toBe(42) })\n",
  );
  writeFileSync(path.join(root, "LICENSE"), "MIT License\n\nFixture only.\n");
  const revision = commitFixture(root, "fixture");
  return { root, revision };
}

function digestOf(absPath) {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

function buildManifest(root, revision) {
  return {
    capsuleId: "fixture-capsule",
    sourceRevision: revision,
    entryTestFile: "src/shared/pure-module.test.ts",
    license: {
      path: "LICENSE",
      sha256: digestOf(path.join(root, "LICENSE")),
      spdxId: "MIT",
      copyright: "Fixture only.",
    },
    files: [
      {
        path: "src/shared/pure-module.test.ts",
        role: "test",
        sha256: digestOf(path.join(root, "src/shared/pure-module.test.ts")),
      },
      {
        path: "src/shared/pure-module.ts",
        role: "module",
        sha256: digestOf(path.join(root, "src/shared/pure-module.ts")),
      },
    ],
  };
}

function writeManifest(dir, manifest) {
  const manifestPath = path.join(dir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function buildFixtureRepoRoot() {
  return mkdtempSync(path.join(tmpdir(), "parity-capsule-repo-"));
}

let workDir;
let fixture;
let fakeRepoRoot;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "parity-capsule-work-"));
  fixture = buildFixtureSourceRoot();
  fakeRepoRoot = buildFixtureRepoRoot();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(fixture.root, { recursive: true, force: true });
  rmSync(fakeRepoRoot, { recursive: true, force: true });
});

describe("assertSafeRelativePath", () => {
  it("accepts a plain relative path", () => {
    expect(() => assertSafeRelativePath("src/shared/foo.ts")).not.toThrow();
  });

  it("refuses an absolute path", () => {
    expect(() => assertSafeRelativePath("/etc/passwd")).toThrow(CapsuleRefusal);
  });

  it("refuses a path containing '..'", () => {
    expect(() => assertSafeRelativePath("../escape.ts")).toThrow(CapsuleRefusal);
    expect(() => assertSafeRelativePath("src/../../escape.ts")).toThrow(CapsuleRefusal);
  });

  it("refuses a path with a null byte", () => {
    expect(() => assertSafeRelativePath("src/foo\0.ts")).toThrow(CapsuleRefusal);
  });

  it("refuses a path with a backslash (alias/output-escape attempt)", () => {
    expect(() => assertSafeRelativePath("src\\shared\\foo.ts")).toThrow(CapsuleRefusal);
  });

  it("refuses a path with a './' alias segment that normalizes differently", () => {
    expect(() => assertSafeRelativePath("src/shared/./foo.ts")).toThrow(CapsuleRefusal);
  });
});

describe("assertSafeSingleComponentId", () => {
  it("accepts a plain id", () => {
    expect(() => assertSafeSingleComponentId("orchestration-ask-timeout", "capsuleId")).not.toThrow();
  });

  it("refuses an id containing '..' path traversal", () => {
    expect(() => assertSafeSingleComponentId("../../evil", "capsuleId")).toThrow(CapsuleRefusal);
  });

  it("refuses an id containing a forward slash", () => {
    expect(() => assertSafeSingleComponentId("a/b", "capsuleId")).toThrow(CapsuleRefusal);
  });

  it("refuses an id containing a backslash", () => {
    expect(() => assertSafeSingleComponentId("a\\b", "capsuleId")).toThrow(CapsuleRefusal);
  });

  it("refuses an empty id", () => {
    expect(() => assertSafeSingleComponentId("", "capsuleId")).toThrow(CapsuleRefusal);
  });

  it("refuses an id starting with a non-alphanumeric character", () => {
    expect(() => assertSafeSingleComponentId(".hidden", "capsuleId")).toThrow(CapsuleRefusal);
    expect(() => assertSafeSingleComponentId("-dash", "capsuleId")).toThrow(CapsuleRefusal);
  });
});

describe("assertNoSymlinkInPath", () => {
  it("refuses a symlinked file", () => {
    const linkTarget = path.join(fixture.root, "src/shared/pure-module.ts");
    const linkPath = path.join(fixture.root, "src/shared/linked.ts");
    symlinkSync(linkTarget, linkPath);
    expect(() => assertNoSymlinkInPath(fixture.root, "src/shared/linked.ts")).toThrow(CapsuleRefusal);
  });

  it("refuses a file reached through a symlinked directory", () => {
    const realDir = path.join(fixture.root, "src", "real-dir");
    mkdirSync(realDir, { recursive: true });
    writeFileSync(path.join(realDir, "file.ts"), "export const X = 1;\n");
    symlinkSync(realDir, path.join(fixture.root, "src", "linked-dir"));
    expect(() => assertNoSymlinkInPath(fixture.root, "src/linked-dir/file.ts")).toThrow(CapsuleRefusal);
  });

  it("accepts a real, non-symlinked file", () => {
    expect(() => assertNoSymlinkInPath(fixture.root, "src/shared/pure-module.ts")).not.toThrow();
  });
});

describe("assertNoOverlap", () => {
  it("refuses when repoRoot is nested inside sourceRoot", () => {
    const nested = path.join(fixture.root, "nested-repo");
    mkdirSync(nested, { recursive: true });
    expect(() => assertNoOverlap(fixture.root, nested)).toThrow(CapsuleRefusal);
  });

  it("refuses when sourceRoot is nested inside repoRoot", () => {
    const nested = path.join(fakeRepoRoot, "nested-source");
    mkdirSync(nested, { recursive: true });
    expect(() => assertNoOverlap(nested, fakeRepoRoot)).toThrow(CapsuleRefusal);
  });

  it("refuses when they are the same directory", () => {
    expect(() => assertNoOverlap(fakeRepoRoot, fakeRepoRoot)).toThrow(CapsuleRefusal);
  });

  it("accepts two unrelated directories", () => {
    expect(() => assertNoOverlap(fixture.root, fakeRepoRoot)).not.toThrow();
  });
});

describe("loadManifest", () => {
  it("refuses a manifest with a malformed sourceRevision", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.sourceRevision = "not-a-sha";
    expect(() => loadManifest(writeManifest(workDir, manifest))).toThrow(CapsuleRefusal);
  });

  it("refuses a manifest with duplicate file paths", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.files.push({ ...manifest.files[0] });
    expect(() => loadManifest(writeManifest(workDir, manifest))).toThrow(CapsuleRefusal);
  });

  it("refuses a manifest whose entryTestFile is not among its files", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.entryTestFile = "src/shared/not-declared.test.ts";
    expect(() => loadManifest(writeManifest(workDir, manifest))).toThrow(CapsuleRefusal);
  });

  it("refuses a manifest missing license provenance", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    delete manifest.license;
    expect(() => loadManifest(writeManifest(workDir, manifest))).toThrow(CapsuleRefusal);
  });

  it("refuses a manifest missing capsuleId", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    delete manifest.capsuleId;
    expect(() => loadManifest(writeManifest(workDir, manifest))).toThrow(CapsuleRefusal);
  });

  it("refuses a manifest whose capsuleId is a path-traversal attempt", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.capsuleId = "../../evil";
    expect(() => loadManifest(writeManifest(workDir, manifest))).toThrow(CapsuleRefusal);
  });
});

describe("stageCapsule", () => {
  it("binds renderer runtime to the receipt and automatic JSX config", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.rendererRuntime = { react: '19.2.8', 'react-dom': '19.2.8', 'happy-dom': '20.11.8' };
    for (const [name, version] of Object.entries(manifest.rendererRuntime)) {
      const directory = path.join(fixture.root, 'node_modules', name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version }));
    }
    const manifestPath = writeManifest(workDir, manifest);
    const receipt = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    expect(receipt.rendererRuntime).toHaveLength(3);
    expect(readFileSync(receipt.configPath, 'utf8')).toContain('jsx: "automatic"');
    expect(() => executeCapsule({ receipt: { ...receipt, rendererRuntime: null }, repoRoot: fakeRepoRoot })).toThrow('rendererRuntime');
  });

  it("refuses an unpinned renderer runtime instead of silently using host dependencies", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.rendererRuntime = {};
    const manifestPath = writeManifest(workDir, manifest);
    expect(() => stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot })).toThrow(/Renderer runtime/);
  });

  it("stages exact bytes matching the pinned digests under the canonical parent", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcome = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    const canonicalParent = resolveCanonicalCapsuleParent(fakeRepoRoot);
    expect(outcome.capsuleRoot.startsWith(canonicalParent + path.sep)).toBe(true);
    for (const staged of outcome.staged) {
      const declared = manifest.files.find((f) => f.path === staged.path);
      expect(staged.sha256).toBe(declared.sha256);
      expect(digestOf(staged.target)).toBe(declared.sha256);
    }
  });

  it("writes a stage-receipt.json bound to the actual manifest bytes staged", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcome = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    expect(outcome.manifestSha256).toBe(readManifestDigest(manifestPath));
    const onDisk = JSON.parse(readFileSync(path.join(outcome.capsuleRoot, "stage-receipt.json"), "utf8"));
    expect(onDisk.manifestSha256).toBe(outcome.manifestSha256);
    expect(onDisk.capsuleRoot).toBe(outcome.capsuleRoot);
  });

  it.each(["ts", "tsx", "mjs"])("selects only the reviewed %s test extension without changing source bytes", (extension) => {
    const entry = `src/shared/config-entry.test.${extension}`;
    const source = "import { it, expect } from 'vitest'; it('fixture', () => expect(1).toBe(1));\n";
    writeFileSync(path.join(fixture.root, entry), source);
    const revision = commitFixture(fixture.root, "add configuration test fixture");
    const manifest = buildManifest(fixture.root, revision);
    manifest.entryTestFile = entry;
    manifest.files = [{ path: entry, role: "test", sha256: digestOf(path.join(fixture.root, entry)) }];
    const manifestPath = writeManifest(workDir, manifest);
    const outcome = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    const config = readFileSync(outcome.configPath, "utf8");
    expect(config).toContain(`include: ["**/*.test.${extension}"]`);
    expect(config).not.toContain(extension === "mjs" ? "**/*.test.ts" : "**/*.test.mjs");
    expect(readFileSync(outcome.staged[0].target, "utf8")).toBe(source);
  });

  it("creates a fresh, uniquely-named directory on every call (atomic, non-colliding)", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcomeA = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    const outcomeB = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    expect(outcomeA.capsuleRoot).not.toBe(outcomeB.capsuleRoot);
    expect(existsSync(outcomeA.capsuleRoot)).toBe(true);
    expect(existsSync(outcomeB.capsuleRoot)).toBe(true);
  });

  it("stages byte-for-byte identical content across two independent calls (deterministic staging)", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcomeA = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    const outcomeB = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    expect(outcomeA.staged.map((s) => s.sha256)).toEqual(outcomeB.staged.map((s) => s.sha256));
    for (const stagedA of outcomeA.staged) {
      const stagedB = outcomeB.staged.find((s) => s.path === stagedA.path);
      expect(readFileSync(stagedB.target)).toEqual(readFileSync(stagedA.target));
    }
  });

  it("refuses a manifest capsuleId that attempts to escape the canonical parent via mkdtemp, before any mkdir", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.capsuleId = "../../escape-attempt";
    const manifestPath = writeManifest(workDir, manifest);
    const canonicalParent = resolveCanonicalCapsuleParent(fakeRepoRoot);
    expect(() => stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot })).toThrow(
      CapsuleRefusal,
    );
    // The canonical parent must not even exist yet -- refusal happened
    // before ensureCanonicalCapsuleParent's mkdir.
    expect(existsSync(canonicalParent)).toBe(false);
    expect(existsSync(path.join(path.dirname(fakeRepoRoot), "escape-attempt"))).toBe(false);
  });

  it("refuses a caller-supplied --label that attempts to escape the canonical parent", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const canonicalParent = resolveCanonicalCapsuleParent(fakeRepoRoot);
    expect(() =>
      stageCapsule({
        manifestPath,
        sourceRoot: fixture.root,
        repoRoot: fakeRepoRoot,
        label: "../../escaped-via-label",
      }),
    ).toThrow(CapsuleRefusal);
    expect(existsSync(canonicalParent)).toBe(false);
    expect(existsSync(path.join(path.dirname(fakeRepoRoot), "escaped-via-label"))).toBe(false);
  });

  it("refuses when repoRoot overlaps sourceRoot", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const nestedRepoRoot = path.join(fixture.root, "nested-repo-root");
    mkdirSync(nestedRepoRoot, { recursive: true });
    expect(() =>
      stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: nestedRepoRoot }),
    ).toThrow(CapsuleRefusal);
  });

  it("refuses when the canonical parent's ancestry contains a symlink", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const realElsewhere = mkdtempSync(path.join(tmpdir(), "parity-capsule-elsewhere-"));
    symlinkSync(realElsewhere, path.join(fakeRepoRoot, ".preflight"));
    try {
      expect(() =>
        stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot }),
      ).toThrow(CapsuleRefusal);
    } finally {
      rmSync(realElsewhere, { recursive: true, force: true });
    }
  });

  it("refuses when the source revision does not match the manifest", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.sourceRevision = "0".repeat(40);
    const manifestPath = writeManifest(workDir, manifest);
    expect(() =>
      stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot }),
    ).toThrow(CapsuleRefusal);
  });

  it("refuses when a file's digest does not match its current content", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.files[1].sha256 = sha256(Buffer.from("tampered"));
    const manifestPath = writeManifest(workDir, manifest);
    expect(() =>
      stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot }),
    ).toThrow(CapsuleRefusal);
  });

  it("refuses when a pinned file was modified after the pinned commit (working tree drift)", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    writeFileSync(path.join(fixture.root, "src/shared/pure-module.ts"), "export const ANSWER = 43;\n");
    const manifestPath = writeManifest(workDir, manifest);
    expect(() =>
      stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot }),
    ).toThrow(CapsuleRefusal);
  });

  it("refuses a manifest file path that escapes the source root", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.files[0].path = "../escape.test.ts";
    const manifestPath = writeManifest(workDir, manifest);
    expect(() =>
      stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot }),
    ).toThrow(CapsuleRefusal);
  });

  it("refuses a symlinked pinned file", () => {
    const linkTarget = path.join(fixture.root, "src/shared/pure-module.ts");
    const linkPath = path.join(fixture.root, "src/shared/pure-module-link.ts");
    symlinkSync(linkTarget, linkPath);
    const revision = commitFixture(fixture.root, "add symlink");
    const manifest = buildManifest(fixture.root, revision);
    manifest.files.push({ path: "src/shared/pure-module-link.ts", role: "module", sha256: digestOf(linkTarget) });
    const manifestPath = writeManifest(workDir, manifest);
    expect(() =>
      stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot }),
    ).toThrow(CapsuleRefusal);
  });

  it("refuses a manifest file path colliding with the reserved generated vitest.config.mjs path", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    writeFileSync(path.join(fixture.root, "src/shared/vitest.config.mjs"), "export default {}\n");
    manifest.files.push({
      path: "vitest.config.mjs",
      role: "module",
      sha256: digestOf(path.join(fixture.root, "src/shared/vitest.config.mjs")),
    });
    const revision = commitFixture(fixture.root, "add reserved-name collider");
    manifest.sourceRevision = revision;
    const manifestPath = writeManifest(workDir, manifest);
    expect(() =>
      stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot }),
    ).toThrow(CapsuleRefusal);
  });

  it("refuses a manifest file path colliding with the reserved stage-receipt.json path", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    writeFileSync(path.join(fixture.root, "src/shared/stage-receipt.json"), "{}\n");
    manifest.files.push({
      path: "stage-receipt.json",
      role: "module",
      sha256: digestOf(path.join(fixture.root, "src/shared/stage-receipt.json")),
    });
    const revision = commitFixture(fixture.root, "add stage-receipt collider");
    manifest.sourceRevision = revision;
    const manifestPath = writeManifest(workDir, manifest);
    expect(() =>
      stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot }),
    ).toThrow(CapsuleRefusal);
  });

  it("refuses a manifest file path colliding with the license path", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    manifest.files.push({ path: "LICENSE", role: "module", sha256: manifest.license.sha256 });
    const manifestPath = writeManifest(workDir, manifest);
    expect(() =>
      stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot }),
    ).toThrow(CapsuleRefusal);
  });
});

describe("execution: owned stage receipt + approval binding", () => {
  function executableFixture() {
    const manifestPath = writeManifest(workDir, buildManifest(fixture.root, fixture.revision));
    const receipt = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    const vitestEntry = path.join(workDir, "fake-vitest.mjs");
    writeFileSync(vitestEntry, "process.stdout.write('fixture runner');\n");
    return { receipt, approvedManifestSha256: receipt.manifestSha256, nodeBin: process.execPath,
      vitestEntry, timeoutMs: 5_000, repoRoot: fakeRepoRoot };
  }

  it("refuses a changed generated config before launching the fixture runner", () => {
    const options = executableFixture();
    writeFileSync(options.receipt.configPath, "export default { test: { include: [] } };\n");
    expect(() => executeCapsule(options)).toThrow(/Generated vitest config changed/);
  });

  it("refuses caller removal of the staged file obligations", () => {
    const options = executableFixture();
    options.receipt.staged = [];
    expect(() => executeCapsule(options)).toThrow(/Stage receipt field "staged"/);
  });

  it("refuses a broken symlink at the results path without replacing it", () => {
    const options = executableFixture();
    const resultsPath = path.join(options.receipt.capsuleRoot, "vitest-results.json");
    symlinkSync(path.join(workDir, "never-created.json"), resultsPath);
    expect(() => executeCapsule(options)).toThrow(/Refusing to reuse an existing results path/);
  });

  it("executeCapsule refuses a fabricated receipt not backed by a real stage-receipt.json", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcome = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    const fabricated = { ...outcome, capsuleRoot: path.join(workDir, "unrelated-dir") };
    mkdirSync(fabricated.capsuleRoot, { recursive: true });
    expect(() =>
      executeCapsule({
        receipt: fabricated,
        approvedManifestSha256: outcome.manifestSha256,
        nodeBin: process.execPath,
        vitestEntry: path.join(workDir, "nonexistent-vitest.mjs"),
        timeoutMs: 5_000,
        repoRoot: fakeRepoRoot,
      }),
    ).toThrow(CapsuleRefusal);
  });

  it("executeCapsule refuses a receipt whose capsuleRoot sits outside the canonical parent", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcome = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    const fabricated = { ...outcome, capsuleRoot: workDir };
    expect(() =>
      executeCapsule({
        receipt: fabricated,
        approvedManifestSha256: outcome.manifestSha256,
        nodeBin: process.execPath,
        vitestEntry: path.join(workDir, "nonexistent-vitest.mjs"),
        timeoutMs: 5_000,
        repoRoot: fakeRepoRoot,
      }),
    ).toThrow(CapsuleRefusal);
  });

  it("executeCapsule refuses without a matching approval digest even with a genuine receipt", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcome = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    expect(() =>
      executeCapsule({
        receipt: outcome,
        approvedManifestSha256: "0".repeat(64),
        nodeBin: process.execPath,
        vitestEntry: path.join(workDir, "nonexistent-vitest.mjs"),
        timeoutMs: 5_000,
        repoRoot: fakeRepoRoot,
      }),
    ).toThrow(CapsuleRefusal);
  });

  it("executeCapsule's approval binds the manifest bytes as staged, not a later edit to the manifest file", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcome = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    const digestAtStageTime = outcome.manifestSha256;
    // Edit the manifest file on disk after staging; a fresh reread would
    // now produce a different digest, but execution must still bind to
    // what was actually staged.
    const edited = { ...manifest, capsuleId: "fixture-capsule-edited" };
    writeFileSync(manifestPath, JSON.stringify(edited, null, 2));
    expect(readManifestDigest(manifestPath)).not.toBe(digestAtStageTime);
    expect(() =>
      executeCapsule({
        receipt: outcome,
        approvedManifestSha256: digestAtStageTime,
        nodeBin: process.execPath,
        vitestEntry: path.join(workDir, "nonexistent-vitest.mjs"),
        timeoutMs: 5_000,
        repoRoot: fakeRepoRoot,
      }),
    ).toThrow(/vitest entry not found/);
  });

  it("executeCapsule refuses when a staged file was tampered with after staging", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcome = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    writeFileSync(outcome.staged[0].target, "tampered content\n");
    const placeholderVitestEntry = path.join(workDir, "placeholder-vitest.mjs");
    writeFileSync(placeholderVitestEntry, "// never actually spawned in this test\n");
    expect(() =>
      executeCapsule({
        receipt: outcome,
        approvedManifestSha256: outcome.manifestSha256,
        nodeBin: process.execPath,
        vitestEntry: placeholderVitestEntry,
        timeoutMs: 5_000,
        repoRoot: fakeRepoRoot,
      }),
    ).toThrow(/Staged file changed since staging/);
  });

  it("executeCapsule refuses to reuse an existing results path instead of overwriting prior evidence", () => {
    const manifest = buildManifest(fixture.root, fixture.revision);
    const manifestPath = writeManifest(workDir, manifest);
    const outcome = stageCapsule({ manifestPath, sourceRoot: fixture.root, repoRoot: fakeRepoRoot });
    writeFileSync(path.join(outcome.capsuleRoot, "vitest-results.json"), '{"prior":"evidence"}\n');
    const placeholderVitestEntry = path.join(workDir, "placeholder-vitest.mjs");
    writeFileSync(placeholderVitestEntry, "// never actually spawned in this test\n");
    expect(() =>
      executeCapsule({
        receipt: outcome,
        approvedManifestSha256: outcome.manifestSha256,
        nodeBin: process.execPath,
        vitestEntry: placeholderVitestEntry,
        timeoutMs: 5_000,
        repoRoot: fakeRepoRoot,
      }),
    ).toThrow(/Refusing to reuse an existing results path/);
    // The pre-existing "evidence" must survive untouched.
    expect(readFileSync(path.join(outcome.capsuleRoot, "vitest-results.json"), "utf8")).toContain("prior");
  });
});

describe("controlled fake-runner execution (short, deterministic)", () => {
  function writeFakeRunner(source) {
    const scriptPath = path.join(workDir, "fake-runner.mjs");
    writeFileSync(scriptPath, source);
    return scriptPath;
  }

  it("reports timedOut for a script that outlives the bound, without broad process killing", () => {
    const scriptPath = writeFakeRunner(
      "await new Promise((resolve) => setTimeout(resolve, 5_000));\nprocess.exit(0);\n",
    );
    const result = spawnNodeScript({
      nodeBin: process.execPath,
      scriptPath,
      args: [],
      cwd: workDir,
      timeoutMs: 200,
    });
    // spawnSync's own single-child timeout signals only this one process;
    // it does not sweep a process tree or kill anything else.
    expect(result.signal).not.toBeNull();
  });

  it("reports a nonzero exit and no results file for a script that exits 1 immediately", () => {
    const scriptPath = writeFakeRunner("process.exit(1);\n");
    const result = spawnNodeScript({
      nodeBin: process.execPath,
      scriptPath,
      args: [],
      cwd: workDir,
      timeoutMs: 5_000,
    });
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(existsSync(path.join(workDir, "vitest-results.json"))).toBe(false);
  });
});

describe("evaluateExecution", () => {
  function resultOf(overrides) {
    return {
      timedOut: false,
      signal: null,
      exitCode: 0,
      results: {
        numTotalTests: 2,
        numPassedTests: 2,
        numFailedTests: 0,
        numPendingTests: 0,
        numTodoTests: 0,
        numFailedTestSuites: 0,
        success: true,
        ...overrides,
      },
    };
  }

  it("is ok when everything matches", () => {
    expect(evaluateExecution(resultOf({}), { tests: 2 }).ok).toBe(true);
  });

  it("is not ok on timeout", () => {
    expect(evaluateExecution({ timedOut: true, signal: "SIGTERM", exitCode: null, results: null }, null).ok).toBe(
      false,
    );
  });

  it("is not ok on nonzero exit", () => {
    expect(evaluateExecution({ timedOut: false, signal: null, exitCode: 1, results: null }, null).ok).toBe(false);
  });

  it("is not ok when the results file is missing", () => {
    const evaluation = evaluateExecution({ timedOut: false, signal: null, exitCode: 0, results: null }, null);
    expect(evaluation.ok).toBe(false);
    expect(evaluation.problems.some((p) => p.includes("no parseable"))).toBe(true);
  });

  it("rejects the adversarial all-pending, zero-passed, success:false report even though total matches expected", () => {
    // {numTotalTests:2, numPassedTests:0, numFailedTests:0, numPendingTests:2, success:false}
    const evaluation = evaluateExecution(
      resultOf({ numPassedTests: 0, numPendingTests: 2, success: false }),
      { tests: 2 },
    );
    expect(evaluation.ok).toBe(false);
    expect(evaluation.problems.length).toBeGreaterThan(1);
  });

  it("rejects a skipped-only report (all pending, none failed) even when success is true", () => {
    const evaluation = evaluateExecution(
      resultOf({ numPassedTests: 0, numFailedTests: 0, numPendingTests: 2 }),
      { tests: 2 },
    );
    expect(evaluation.ok).toBe(false);
  });

  it("allows pending tests only when the caller explicitly opts in", () => {
    const evaluation = evaluateExecution(
      resultOf({ numPassedTests: 0, numFailedTests: 0, numPendingTests: 2 }),
      { tests: 2 },
      { allowPendingTests: true },
    );
    // Still not ok: numPassedTests !== expected passed count.
    expect(evaluation.ok).toBe(false);
    expect(evaluation.problems.some((p) => p.includes("pending"))).toBe(false);
  });

  it("rejects a missing count field", () => {
    const evaluation = evaluateExecution(resultOf({ numTotalTests: undefined }), { tests: 2 });
    expect(evaluation.ok).toBe(false);
  });

  it("rejects a string count field", () => {
    const evaluation = evaluateExecution(resultOf({ numFailedTests: "0" }), { tests: 2 });
    expect(evaluation.ok).toBe(false);
  });

  it("rejects a negative count field", () => {
    const evaluation = evaluateExecution(resultOf({ numPendingTests: -1 }), { tests: 2 });
    expect(evaluation.ok).toBe(false);
  });

  it("rejects counts that don't sum coherently to numTotalTests", () => {
    const evaluation = evaluateExecution(
      resultOf({ numTotalTests: 2, numPassedTests: 2, numFailedTests: 1 }),
      { tests: 2 },
    );
    expect(evaluation.ok).toBe(false);
    expect(evaluation.problems.some((p) => p.includes("coherent"))).toBe(true);
  });

  it("rejects a failed suite even when numFailedTests is zero", () => {
    const evaluation = evaluateExecution(resultOf({ numFailedTestSuites: 1 }), { tests: 2 });
    expect(evaluation.ok).toBe(false);
    expect(evaluation.problems.some((p) => p.includes("suite"))).toBe(true);
  });

  it("rejects success:false even when counts otherwise match", () => {
    const evaluation = evaluateExecution(resultOf({ success: false }), { tests: 2 });
    expect(evaluation.ok).toBe(false);
  });

  it("rejects a total-count match that hides a passed-count mismatch", () => {
    const evaluation = evaluateExecution(
      resultOf({ numTotalTests: 2, numPassedTests: 1, numFailedTests: 0, numPendingTests: 1 }),
      { tests: 2 },
    );
    expect(evaluation.ok).toBe(false);
  });
});
