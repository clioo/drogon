import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  assertDeveloperIdAuthority,
  assertLinkedOnlyUsrLib,
  assertNotarizedSpctl,
  assertReleaseBuildInfo,
  BENIGN_HOME_PREFIXES,
  findHomePathReference,
  hasHardenedRuntime,
  isMachO,
  parseCask,
  parseChecksumLine,
  parseCodesignAuthorities,
  parseOtoolLibraries,
  parseSpctlOutput,
  pickNewestRelease,
  releaseDownloadUrls,
  tapCaskUrl,
  verdict,
} from "./verify-release-artifact.mjs";

const NOTARIZED_CASK = `cask "drogon" do
  arch arm: "arm64"

  version "0.1.0-rc.3"
  sha256 "e9032e75904b960c8db1e016acad21489b9e779d8c355ef9d995154d9ced9ce0"

  url "https://github.com/clioo/drogon/releases/download/v#{version}/Drogon-#{version}-darwin-arm64.zip"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :sonoma
end
`;

const CODESIGN_VERBOSE = `Executable=/tmp/Drogon.app/Contents/MacOS/Drogon
Identifier=ai.clioo.drogon
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=987654 flags=0x10000(runtime) hashes=12345+7 location=embedded
Signature size=9023
Authority=Developer ID Application: Example Developer (TEAM123456)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=Sep 14, 2026 at 01:23:45
Info.plist entries=42
`;

const SPCTL_ACCEPTED = `/tmp/Drogon.app: accepted
source=Notarized Developer ID
origin=Developer ID Application: Example Developer (TEAM123456)
`;

const OTOOL_CLEAN = `/tmp/drogond:
\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1351.0.0)
\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 1800.0.0)
\t/usr/lib/libresolv.9.dylib (compatibility version 1.0.0, current version 1.0.0)
`;

test("release URLs follow the Homebrew URL contract", () => {
  const urls = releaseDownloadUrls("v0.1.0-rc.3");
  assert.equal(urls.version, "0.1.0-rc.3");
  assert.equal(
    urls.archiveUrl,
    "https://github.com/clioo/drogon/releases/download/v0.1.0-rc.3/Drogon-0.1.0-rc.3-darwin-arm64.zip",
  );
  assert.equal(urls.checksumUrl, `${urls.archiveUrl}.sha256`);
  assert.equal(
    tapCaskUrl(),
    "https://raw.githubusercontent.com/clioo/homebrew-drogon/main/Casks/drogon.rb",
  );
  assert.throws(() => releaseDownloadUrls("0.1.0-rc.3"), /start with v/);
});

test("newest release wins by publish time, drafts excluded, prereleases included", () => {
  const releases = [
    { tag_name: "v0.1.0-rc.1", prerelease: true, published_at: "2026-09-12T05:00:15Z" },
    { tag_name: "v0.1.0-rc.3", prerelease: true, published_at: "2026-09-14T01:20:22Z" },
    { tag_name: "v0.1.0-rc.9", prerelease: true, draft: true, published_at: "2026-09-15T00:00:00Z" },
    { tag_name: "v0.1.0-rc.2", prerelease: true, published_at: "2026-09-12T05:15:49Z" },
  ];
  assert.equal(pickNewestRelease(releases), "v0.1.0-rc.3");
  assert.throws(() => pickNewestRelease([]), /No releases found/);
  assert.throws(() => pickNewestRelease([{ draft: true }]), /No published releases/);
});

test("checksum lines bind the digest to the archive name", () => {
  const line = `${"e".repeat(64)}  Drogon-0.1.0-rc.3-darwin-arm64.zip\n`;
  assert.equal(parseChecksumLine(line, "Drogon-0.1.0-rc.3-darwin-arm64.zip"), "e".repeat(64));
  assert.throws(
    () => parseChecksumLine(line, "Drogon-0.1.0-rc.2-darwin-arm64.zip"),
    /Checksum names/,
  );
  assert.throws(() => parseChecksumLine("not-a-digest  name.zip", "name.zip"), /not a sha256/);
});

test("cask parsing reads version, digest and livecheck strategy", () => {
  assert.deepEqual(parseCask(NOTARIZED_CASK), {
    version: "0.1.0-rc.3",
    sha256: "e9032e75904b960c8db1e016acad21489b9e779d8c355ef9d995154d9ced9ce0",
    livecheckStrategy: "github_latest",
  });
  assert.throws(() => parseCask('cask "drogon" do\nend\n'), /no version stanza/);
});

test("Developer ID authority and hardened runtime are required", () => {
  const authorities = parseCodesignAuthorities(CODESIGN_VERBOSE);
  assert.deepEqual(authorities, [
    "Developer ID Application: Example Developer (TEAM123456)",
    "Developer ID Certification Authority",
    "Apple Root CA",
  ]);
  assert.equal(
    assertDeveloperIdAuthority(authorities),
    "Developer ID Application: Example Developer (TEAM123456)",
  );
  assert.equal(hasHardenedRuntime(CODESIGN_VERBOSE), true);
  assert.equal(hasHardenedRuntime("flags=0x2(adhoc) hashes=1+2"), false);
  assert.throws(() => assertDeveloperIdAuthority([]), /no authorities/);
  assert.throws(() => assertDeveloperIdAuthority(["Apple Development: Someone"]), /Developer ID Application/);
  assert.throws(
    () => assertDeveloperIdAuthority(["Mac Developer: Someone (TEAM1)"]),
    /Developer ID Application/,
  );
});

test("spctl must accept with a notarized source", () => {
  assert.deepEqual(parseSpctlOutput(SPCTL_ACCEPTED), {
    accepted: true,
    source: "Notarized Developer ID",
  });
  assert.equal(assertNotarizedSpctl(parseSpctlOutput(SPCTL_ACCEPTED)), "Notarized Developer ID");
  assert.throws(
    () => assertNotarizedSpctl(parseSpctlOutput("/tmp/X.app: rejected\nsource=Unnotarized Developer ID\n")),
    /did not accept/,
  );
  assert.throws(
    () => assertNotarizedSpctl(parseSpctlOutput("/tmp/X.app: accepted\nsource=Mac App Store\n")),
    /spctl source/,
  );
});

test("bundled binaries link only /usr/lib", () => {
  const libraries = parseOtoolLibraries(OTOOL_CLEAN);
  assert.deepEqual(libraries, [
    "/usr/lib/libSystem.B.dylib",
    "/usr/lib/libc++.1.dylib",
    "/usr/lib/libresolv.9.dylib",
  ]);
  assert.equal(assertLinkedOnlyUsrLib(libraries).length, 3);
  assert.throws(
    () =>
      assertLinkedOnlyUsrLib([
        "/usr/lib/libSystem.B.dylib",
        "/opt/homebrew/lib/libffi.dylib",
      ]),
    /non-system library/,
  );
  assert.throws(() => assertLinkedOnlyUsrLib([]), /No linked libraries/);
});

test("build-info must describe the tagged notarized arm64 build", () => {
  const info = {
    version: "0.1.0-rc.3",
    dirty: false,
    signed: "developer-id-notarized",
    arch: "arm64",
    revision: "a".repeat(40),
  };
  assert.equal(assertReleaseBuildInfo(info, "v0.1.0-rc.3"), info);
  assert.throws(() => assertReleaseBuildInfo({ ...info, version: "0.1.0-rc.2" }, "v0.1.0-rc.3"), /!=/);
  assert.throws(() => assertReleaseBuildInfo({ ...info, dirty: true }, "v0.1.0-rc.3"), /dirty/);
  assert.throws(
    () => assertReleaseBuildInfo({ ...info, signed: "local-ad-hoc-not-notarized" }, "v0.1.0-rc.3"),
    /signed/,
  );
  assert.throws(() => assertReleaseBuildInfo({ ...info, arch: "x64" }, "v0.1.0-rc.3"), /arch/);
  assert.throws(() => assertReleaseBuildInfo({ ...info, revision: "short" }, "v0.1.0-rc.3"), /revision/);
});

test("home-path scan flags maintainer-shaped paths and passes clean bytes", () => {
  const dirty = Buffer.concat([
    Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
    Buffer.from("/Users/builder/work/drogon/target/debug/drogond", "latin1"),
    Buffer.from([0x00, 0x01]),
  ]);
  assert.equal(findHomePathReference(dirty), "/Users/builder/work/drogon/target/debug/drogond");
  assert.equal(findHomePathReference(Buffer.from([0x00, 0x01, 0x02])), null);
  assert.equal(findHomePathReference("nothing to see here"), null);
});

test("home-path scan exempts only the documented benign prefixes", () => {
  assert.deepEqual([...BENIGN_HOME_PREFIXES].sort(), ["/Users/me/", "/Users/runner/"]);
  const ciPanicPath = Buffer.from("/Users/runner/.cargo/registry/src/index.crates.io-1a2b3c4d/anyhow-1.0.0/src/error.rs");
  const helpExample = "/Users/me/Transcripts/2026-09-10/08-05_42min.json";
  assert.equal(findHomePathReference(ciPanicPath), null);
  assert.equal(findHomePathReference(helpExample), null);
  assert.equal(
    findHomePathReference(`${helpExample} and /Users/builder/checkout`),
    "/Users/builder/checkout",
  );
  assert.equal(findHomePathReference("/Users/builder/x", []), "/Users/builder/x");
});

test("Mach-O detection separates binaries from the version shim", () => {
  assert.equal(isMachO(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])), true);
  assert.equal(isMachO(Buffer.from([0xca, 0xfe, 0xba, 0xbe])), true);
  assert.equal(isMachO(Buffer.from("#!/bin/sh\nset -eu\n")), false);
  assert.equal(isMachO(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), false);
  assert.equal(isMachO(Buffer.alloc(0)), false);
  assert.equal(isMachO("not a buffer"), false);
});

test("verdicts are machine-readable JSON", () => {
  assert.deepEqual(verdict("VERIFIED", "all", null, { tag: "v0.1.0-rc.3" }), {
    status: "VERIFIED",
    check: "all",
    detail: null,
    tag: "v0.1.0-rc.3",
  });
});

test("the verifier refuses to run without --live (no network by accident)", () => {
  const child = spawnSync(process.execPath, ["scripts/verify-release-artifact.mjs", "--tag", "v0.1.0-rc.3"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  assert.notEqual(child.status, 0);
  assert.match(String(child.stderr + child.stdout), /--live/);
});
