import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptanceRecord,
  assertReleaseSigningConfiguration,
  hasNotaryCredentials,
  packagedRecord,
  parseJsonLines,
  releaseArtifactNames,
} from "./release-desktop.mjs";

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
