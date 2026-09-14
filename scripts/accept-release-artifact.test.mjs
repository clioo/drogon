import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assertBuildInfoMatchesTag,
  applyQuarantine,
  decideArtifactVerdict,
  downloadToFile,
  extractBundle,
  findAcceptanceReceipt,
  parseArgs,
  releaseAssetUrls,
  resolveReleaseTag,
  runCleanMachineAcceptance,
  sha256File,
  summarizeAcceptanceReport,
  verifyChecksum,
} from "./accept-release-artifact.mjs";

test("parseArgs defaults and overrides", () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.tag, null);
  assert.equal(defaults.keep, false);
  assert.ok(defaults.timeoutMs > 0);
  const full = parseArgs(["--tag", "v0.1.0-rc.3", "--dir", "/tmp/x", "--keep", "--timeout-ms", "1000"]);
  assert.deepEqual(full, { tag: "v0.1.0-rc.3", dir: "/tmp/x", keep: true, timeoutMs: 1000, bundle: null });
  assert.throws(() => parseArgs(["--bogus"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--bundle", "/tmp/Drogon.app"]), /--bundle requires --tag/);
  assert.throws(() => parseArgs(["--timeout-ms", "0"]), /positive number/);
});

test("explicit tags pass through validated", async () => {
  assert.equal(await resolveReleaseTag({ tag: "v0.1.0-rc.3" }), "v0.1.0-rc.3");
  await assert.rejects(() => resolveReleaseTag({ tag: "0.1.0" }), /must start with v/);
  await assert.rejects(() => resolveReleaseTag({ tag: "v1.2" }), /Invalid semantic version/);
});

test("default tag is the newest non-draft release", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => [
      { draft: true, tag_name: "v0.1.0-rc.9" },
      { draft: false, tag_name: "v0.1.0-rc.3" },
      { draft: false, tag_name: "v0.1.0-rc.2" },
    ],
  });
  assert.equal(await resolveReleaseTag({ fetchImpl }), "v0.1.0-rc.3");
});

test("default tag fails closed without a usable release", async () => {
  await assert.rejects(
    () => resolveReleaseTag({ fetchImpl: async () => ({ ok: true, json: async () => [{ draft: true, tag_name: "v9" }] }) }),
    /non-draft/,
  );
  await assert.rejects(
    () => resolveReleaseTag({ fetchImpl: async () => ({ ok: true, json: async () => [] }) }),
    /No published/,
  );
  await assert.rejects(
    () => resolveReleaseTag({ fetchImpl: async () => ({ ok: false, status: 403 }) }),
    /releases API failed/,
  );
});

test("asset URLs keep the Homebrew contract", () => {
  const { version, archiveUrl, checksumUrl } = releaseAssetUrls("v0.1.0-rc.3");
  assert.equal(version, "0.1.0-rc.3");
  assert.ok(archiveUrl.endsWith("/releases/download/v0.1.0-rc.3/Drogon-0.1.0-rc.3-darwin-arm64.zip"));
  assert.equal(checksumUrl, `${archiveUrl}.sha256`);
});

test("checksum verification accepts a match and refuses anything else", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ara-"));
  const archive = path.join(dir, "a.zip");
  await writeFile(archive, "artifact-bytes");
  const digest = await sha256File(archive);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const good = path.join(dir, "a.zip.sha256");
  await writeFile(good, `${digest}  a.zip\n`);
  assert.equal(await verifyChecksum({ archive, checksumFile: good }), digest);
  const bad = path.join(dir, "bad.sha256");
  await writeFile(bad, `${"0".repeat(64)}  a.zip\n`);
  await assert.rejects(() => verifyChecksum({ archive, checksumFile: bad }), /Checksum mismatch/);
  const malformed = path.join(dir, "malformed.sha256");
  await writeFile(malformed, "not-a-checksum\n");
  await assert.rejects(() => verifyChecksum({ archive, checksumFile: malformed }), /malformed checksum/);
});

test("downloadToFile streams the body and refuses HTTP errors", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ara-"));
  const { Readable } = await import("node:stream");
  const dest = path.join(dir, "out.bin");
  await downloadToFile("https://example.invalid/a", dest, {
    fetchImpl: async () => ({ ok: true, body: Readable.from(["chunk-1", "chunk-2"]) }),
  });
  assert.equal(await (await import("node:fs/promises")).readFile(dest, "utf8"), "chunk-1chunk-2");
  await assert.rejects(
    () => downloadToFile("https://example.invalid/b", dest, { fetchImpl: async () => ({ ok: false, status: 404 }) }),
    /Download failed \(404\)/,
  );
});

test("extraction uses ditto and quarantine matches the Homebrew posture", async () => {
  const calls = [];
  const run = async (file, args, options) => {
    calls.push([file, args, options]);
    return { stdout: "", stderr: "" };
  };
  const { mkdtemp: mk } = await import("node:fs/promises");
  const dir = await mk(path.join(tmpdir(), "ara-"));
  await (await import("node:fs/promises")).mkdir(path.join(dir, "Drogon.app"));
  const bundle = await extractBundle({ archive: path.join(dir, "a.zip"), destDir: dir, run });
  assert.equal(bundle, path.join(dir, "Drogon.app"));
  assert.deepEqual(calls[0][0], "/usr/bin/ditto");
  assert.deepEqual(calls[0][1].slice(0, 3), ["-x", "-k", path.join(dir, "a.zip")]);
  const value = await applyQuarantine({ bundle, run });
  assert.match(value, /^0081;00000000;Homebrew;/);
  assert.equal(calls[1][0], "/usr/bin/xattr");
  assert.deepEqual(calls[1][1].slice(0, 3), ["-w", "com.apple.quarantine", value]);
});

test("build-info must name the tag under validation", async () => {
  const info = await assertBuildInfoMatchesTag({
    bundle: "/tmp/Drogon.app",
    version: "0.1.0-rc.3",
    readInfo: async () => ({ version: "0.1.0-rc.3", revision: "a".repeat(40) }),
  });
  assert.equal(info.revision, "a".repeat(40));
  await assert.rejects(
    () =>
      assertBuildInfoMatchesTag({
        bundle: "/tmp/Drogon.app",
        version: "0.1.0-rc.3",
        readInfo: async () => ({ version: "0.1.0-rc.2" }),
      }),
    /does not match release/,
  );
});

test("receipt parsing takes the last report record", () => {
  const output = [
    "noise",
    JSON.stringify({ status: "PACKAGED", bundle: "/tmp/x" }),
    JSON.stringify({ status: "FAILED", checks: [], report: "/tmp/first.json" }),
    JSON.stringify({ status: "PASSED", checks: ["a"], skipped: [], report: "/tmp/last.json" }),
  ].join("\n");
  assert.equal(findAcceptanceReceipt(output).report, "/tmp/last.json");
  assert.equal(findAcceptanceReceipt("no json here"), null);
});

test("report summary counts executed and skipped separately", () => {
  assert.deepEqual(summarizeAcceptanceReport({ status: "PASSED", checks: ["a", "b"], skipped: [{ name: "c", reason: "r" }] }), {
    status: "PASSED",
    executed: 2,
    skipped: 1,
  });
  assert.throws(() => summarizeAcceptanceReport(null), /report object/);
});

// The honesty guard: no report shape may verdict PASSED without executed checks.
test("verdict never passes with zero or skipped-only checks", () => {
  const failed = (report, receipt = { status: "PASSED", report: "/tmp/r.json" }) =>
    decideArtifactVerdict({ receipt, report });
  assert.equal(failed({ status: "PASSED", checks: [], skipped: [] }).verdict, "FAILED");
  assert.equal(failed({ status: "PASSED", checks: [], skipped: [{ name: "j", reason: "r" }] }).verdict, "FAILED");
  assert.equal(failed({ status: "FAILED", checks: ["a"], skipped: [] }).verdict, "FAILED");
  assert.equal(
    failed({ status: "PASSED", checks: ["a"], skipped: [] }, { status: "FAILED", report: "/tmp/r.json", error: "boom" }).verdict,
    "FAILED",
  );
  assert.equal(failed(null).verdict, "FAILED");
  assert.equal(failed({ status: "PASSED", checks: ["a"], skipped: [] }, null).verdict, "FAILED");
  const passed = decideArtifactVerdict({
    receipt: { status: "PASSED", report: "/tmp/r.json" },
    report: { status: "PASSED", checks: ["a"], skipped: [{ name: "j", reason: "r" }] },
  });
  assert.equal(passed.verdict, "PASSED");
  assert.equal(passed.executedChecks, 1);
  assert.equal(passed.skippedChecks, 1);
});

test("clean-machine run fixes the bundle, subset flags and background mode", async () => {
  let seen = null;
  const spawnImpl = (file, args, options, onOutput) => {
    seen = { file, args, options };
    onOutput(`${JSON.stringify({ status: "PASSED", report: "/tmp/r.json" })}\n`);
    return { child: { kill: () => {} }, done: async () => ({ code: 0, signal: null, stdout: "", stderr: "" }) };
  };
  const result = await runCleanMachineAcceptance({
    bundle: "/tmp/Drogon.app",
    script: "/repo/scripts/accept-desktop.mjs",
    nodePath: "/node",
    env: { PATH: "/usr/bin" },
    spawnImpl,
    onOutput: () => {},
  });
  assert.equal(result.code, 0);
  assert.equal(seen.file, "/node");
  assert.deepEqual(seen.args, ["/repo/scripts/accept-desktop.mjs", "--bundle", "/tmp/Drogon.app", "--files"]);
  assert.equal(seen.options.env.DROGON_BACKGROUND_WINDOW, "1");
  assert.equal(seen.options.env.PATH, "/usr/bin");
});

test("clean-machine run reports a timeout instead of hanging CI", async () => {
  const spawnImpl = () => ({
    child: { kill: () => {} },
    done: () => new Promise(() => {}),
  });
  const result = await runCleanMachineAcceptance({
    bundle: "/tmp/Drogon.app",
    script: "/repo/scripts/accept-desktop.mjs",
    timeoutMs: 50,
    spawnImpl,
    onOutput: () => {},
  });
  assert.equal(result.timedOut, true);
});
