import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  acceptanceRecord,
  appleDoubleEntries,
  assertNoAppleDoubleEntries,
  assertReleaseSigningConfiguration,
  hasNotaryCredentials,
  packagedRecord,
  parseJsonLines,
  releaseArtifactNames,
  zipBundle,
} from "./release-desktop.mjs";
import { fingerprintBundle } from "./desktop-artifacts.mjs";

const runFile = promisify(execFile);
const darwinOnly = { skip: process.platform !== "darwin" };

test("release artifact names keep the Homebrew URL contract", () => {
  assert.deepEqual(releaseArtifactNames("0.1.0-rc.2"), {
    archive: "Drogon-0.1.0-rc.2-darwin-arm64.zip",
    checksum: "Drogon-0.1.0-rc.2-darwin-arm64.zip.sha256",
  });
});

test("release command parsers use the final JSON record", () => {
  const output = [
    "cargo output",
    JSON.stringify({ status: "PACKAGED", bundle: "/tmp/Drogon.app" }),
    JSON.stringify({
      status: "RELEASE_ARTIFACTS_READY",
      sha256: "a".repeat(64),
    }),
  ].join("\n");
  assert.equal(packagedRecord(output).bundle, "/tmp/Drogon.app");
  assert.equal(parseJsonLines(output).length, 2);
  assert.throws(() => packagedRecord("no JSON"), /did not report a bundle/);

  const accepted = JSON.stringify({
    status: "PASSED",
    report: "/tmp/acceptance/report.json",
  });
  assert.equal(acceptanceRecord(accepted).status, "PASSED");
  assert.throws(
    () =>
      acceptanceRecord(
        JSON.stringify({ status: "FAILED", report: "/tmp/report" }),
      ),
    /did not pass/,
  );
});

test("AppleDouble sidecars are any path segment starting with ._", () => {
  assert.deepEqual(
    appleDoubleEntries([
      "Drogon.app/Contents/._Info.plist",
      "Drogon.app/Contents/Info.plist",
      "Drogon.app/._Contents",
      "Drogon.app/Contents/Resources/hr.lproj/._locale.pak",
      "Drogon.app/Contents/Resources/not-a-sidecar._bak",
    ]),
    [
      "Drogon.app/Contents/._Info.plist",
      "Drogon.app/._Contents",
      "Drogon.app/Contents/Resources/hr.lproj/._locale.pak",
    ],
  );
  assert.deepEqual(appleDoubleEntries([]), []);
});

// Minimal ad-hoc signed bundle shaped like the real one (executable, helper
// binaries, notices, desktop tree) so the unzip round-trip exercises a real
// code seal. The quarantine xattr mirrors the metadata build machines leave
// on bundle files; it is what ditto used to ship as `._*` sidecars.
async function makeSignedFixture(root) {
  const bundle = path.join(root, "Fixture.app");
  const contents = path.join(bundle, "Contents");
  const bin = path.join(contents, "Resources", "bin");
  await mkdir(path.join(contents, "MacOS"), { recursive: true });
  await mkdir(path.join(contents, "Resources", "hr.lproj"), { recursive: true });
  await mkdir(path.join(contents, "Resources", "app"), { recursive: true });
  await mkdir(bin, { recursive: true });
  const source = path.join(root, "fixture-main.c");
  await writeFile(source, "int main(void) { return 0; }\n");
  const executable = path.join(contents, "MacOS", "Fixture");
  await runFile("/usr/bin/clang", ["-o", executable, source], {
    timeout: 120000,
  });
  await cp(executable, path.join(bin, "drogond"));
  await cp(executable, path.join(bin, "drogon-cli"));
  await writeFile(
    path.join(contents, "Info.plist"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      "<key>CFBundleExecutable</key><string>Fixture</string>",
      "<key>CFBundleIdentifier</key><string>ai.clioo.fixture</string>",
      "<key>CFBundlePackageType</key><string>APPL</string>",
      "<key>CFBundleVersion</key><string>1</string>",
      "</dict></plist>",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(contents, "Resources", "hr.lproj", "locale.pak"),
    "fake locale bytes",
  );
  await writeFile(
    path.join(contents, "Resources", "build-info.json"),
    '{}\n',
  );
  await writeFile(
    path.join(contents, "Resources", "DEPENDENCY-NOTICES.txt"),
    "fixture notices\n",
  );
  await runFile(
    "/usr/bin/xattr",
    [
      "-w",
      "com.apple.quarantine",
      "0081;00000000;Drogon;00000000-0000-0000-0000-000000000000",
      path.join(contents, "Resources", "hr.lproj", "locale.pak"),
    ],
    { timeout: 30000 },
  );
  await runFile("/usr/bin/codesign", ["--force", "--sign", "-", bundle], {
    timeout: 120000,
  });
  await runFile(
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", bundle],
    { timeout: 120000 },
  );
  return bundle;
}

async function codesignVerdict(bundle) {
  try {
    await runFile(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", bundle],
      { timeout: 300000 },
    );
    return { verified: true, detail: "" };
  } catch (error) {
    return {
      verified: false,
      detail: String(error.stdout ?? "") + String(error.stderr ?? ""),
    };
  }
}

async function spctlVerdict(bundle) {
  try {
    await runFile("/usr/sbin/spctl", ["-a", "-t", "exec", bundle], {
      timeout: 120000,
    });
    return { accepted: true };
  } catch {
    return { accepted: false };
  }
}

test(
  "raw ditto archives carry AppleDouble sidecars that break plain-unzip extraction",
  darwinOnly,
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "drogon-unzip-repro-"));
    try {
      const bundle = await makeSignedFixture(root);
      const archive = path.join(root, "raw.zip");
      await runFile(
        "/usr/bin/ditto",
        ["-c", "-k", "--keepParent", bundle, archive],
        { timeout: 120000 },
      );
      await assert.rejects(
        assertNoAppleDoubleEntries(archive),
        /AppleDouble/,
      );
      const dest = path.join(root, "unzip-extract");
      await mkdir(dest, { recursive: true });
      await runFile("/usr/bin/unzip", ["-q", "-o", archive, "-d", dest], {
        timeout: 120000,
      });
      const verdict = await codesignVerdict(
        path.join(dest, "Fixture.app"),
      );
      assert.equal(verdict.verified, false);
      assert.match(verdict.detail, /file added|missing or invalid/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "zipBundle archives extract correctly under BOTH ditto and plain unzip",
  darwinOnly,
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "drogon-unzip-seal-"));
    try {
      const bundle = await makeSignedFixture(root);
      const sealedBefore = await fingerprintBundle(bundle);
      const archive = path.join(root, "Fixture.zip");
      await zipBundle(bundle, archive);
      assert.ok((await assertNoAppleDoubleEntries(archive)) > 0);
      // The sealed bytes are untouched by archiving: the detached digests
      // still describe exactly what ships.
      assert.deepEqual(await fingerprintBundle(bundle), sealedBefore);
      const viaUnzip = path.join(root, "via-unzip");
      const viaDitto = path.join(root, "via-ditto");
      await mkdir(viaUnzip, { recursive: true });
      await mkdir(viaDitto, { recursive: true });
      await runFile("/usr/bin/unzip", ["-q", "-o", archive, "-d", viaUnzip], {
        timeout: 120000,
      });
      await runFile("/usr/bin/ditto", ["-x", "-k", archive, viaDitto], {
        timeout: 120000,
      });
      const unzipBundle = path.join(viaUnzip, "Fixture.app");
      const dittoBundle = path.join(viaDitto, "Fixture.app");
      assert.equal((await codesignVerdict(unzipBundle)).verified, true);
      assert.equal((await codesignVerdict(dittoBundle)).verified, true);
      // The fixture is ad-hoc signed, so Gatekeeper rejects both copies; the
      // invariant is parity — unzip extraction no longer degrades the
      // assessment relative to ditto. spctl acceptance itself is proven on the
      // Developer ID release archive in the release workflow.
      assert.deepEqual(
        await spctlVerdict(unzipBundle),
        await spctlVerdict(dittoBundle),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("Developer ID mode is enabled only with a complete notary configuration", () => {
  const adHoc = {
    DROGON_SIGNING_IDENTITY: "",
    DROGON_RELEASE_SIGNING: "",
  };
  assert.deepEqual(assertReleaseSigningConfiguration(adHoc), {
    developerId: false,
    identity: null,
  });
  assert.equal(
    hasNotaryCredentials({
      APPLE_ID: "a",
      APPLE_TEAM_ID: "t",
      APPLE_APP_SPECIFIC_PASSWORD: "p",
    }),
    true,
  );
  assert.throws(
    () =>
      assertReleaseSigningConfiguration({
        DROGON_SIGNING_IDENTITY: "Developer ID Application: Test",
        APPLE_ID: "a",
        APPLE_TEAM_ID: "t",
      }),
    /requires APPLE_ID/,
  );
});
