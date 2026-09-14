#!/usr/bin/env node
// MIT Copyright (c) 2026 Lovecast Inc.
// Unit tests for scripts/e2e-brew-install.mjs. Pure logic only: the live
// brew/install/launch flow runs on macOS via the script itself, so every
// test here is fast and platform-independent.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertRoomContained,
  commandMatchesDaemon,
  compareDrogonVersions,
  expandZapPath,
  launchEnv,
  makeCleanRoom,
  parseBrewAuditArgs,
  parseCaskRuby,
  quarantineAttributePresent,
  skipStep,
  snapshotTree,
  spctlAccepted,
  step,
  summarizeRun,
  tapNeedsTrust,
} from "./e2e-brew-install.mjs";

const RC2_RUBY = `cask "drogon" do
  arch arm: "arm64"

  version "0.1.0-rc.2"
  sha256 "81019f17414ba678a94ca37a957c2aebe227c5a52dc81c44920eac01aa3037cd"

  url "https://github.com/clioo/drogon/releases/download/v#{version}/Drogon-#{version}-darwin-arm64.zip"
  name "Drogon"
  desc "Desktop workspace for developers with coding agents and Git worktrees"
  homepage "https://github.com/clioo/drogon"

  depends_on macos: :sonoma

  app "Drogon.app"
  binary "#{appdir}/Drogon.app/Contents/Resources/bin/drogon-cli"

  uninstall quit:   "ai.clioo.drogon",
            script: {
              executable: "#{appdir}/Drogon.app/Contents/Resources/bin/drogon-stop-daemon",
            }

  zap trash: [
    "~/Applications/.drogon-builds",
    "~/Library/Application Support/Drogon",
    "~/Library/Caches/Drogon",
    "~/Library/Logs/Drogon",
    "~/Library/Preferences/ai.clioo.drogon.plist",
    "~/Library/Saved Application State/ai.clioo.drogon.savedState",
  ]

  caveats <<~EOS
    This cask release is ad-hoc signed and not notarized.

    On Homebrew versions that support --no-quarantine, install with:

      brew install --cask --no-quarantine clioo/drogon/drogon
  EOS
end
`;

const RC3_RUBY = `cask "drogon" do
  arch arm: "arm64"

  version "0.1.0-rc.3"
  sha256 "e9032e75904b960c8db1e016acad21489b9e779d8c355ef9d995154d9ced9ce0"

  url "https://github.com/clioo/drogon/releases/download/v#{version}/Drogon-#{version}-darwin-arm64.zip"
  name "Drogon"

  app "Drogon.app"
  binary "#{appdir}/Drogon.app/Contents/Resources/bin/drogon-cli"

  uninstall quit:   "ai.clioo.drogon",
            script: {
              executable: "#{appdir}/Drogon.app/Contents/Resources/bin/drogon-stop-daemon",
            }

  zap trash: [
    "~/Library/Application Support/Drogon",
  ]
end
`;

test("parseBrewAuditArgs defaults to the public tap and a live room", () => {
  assert.deepEqual(parseBrewAuditArgs([]), {
    keep: false,
    tapUrl: "https://github.com/clioo/homebrew-drogon.git",
    fromRev: null,
    toRev: null,
    jsonPath: null,
  });
});

test("parseBrewAuditArgs reads every supported flag", () => {
  assert.deepEqual(
    parseBrewAuditArgs(["--keep", "--tap-url", "https://example.com/tap.git", "--from-rev", "aaa", "--to-rev", "bbb", "--json", "/tmp/s.json"]),
    {
      keep: true,
      tapUrl: "https://example.com/tap.git",
      fromRev: "aaa",
      toRev: "bbb",
      jsonPath: "/tmp/s.json",
    },
  );
});

test("parseBrewAuditArgs rejects unknown flags and missing values", () => {
  assert.throws(() => parseBrewAuditArgs(["--nope"]), /Unknown option/);
  assert.throws(() => parseBrewAuditArgs(["--tap-url"]), /needs a value/);
});

test("parseCaskRuby reads the ad-hoc rc.2 cask", () => {
  const cask = parseCaskRuby(RC2_RUBY);
  assert.equal(cask.version, "0.1.0-rc.2");
  assert.equal(cask.sha256, "81019f17414ba678a94ca37a957c2aebe227c5a52dc81c44920eac01aa3037cd");
  assert.equal(
    cask.url,
    "https://github.com/clioo/drogon/releases/download/v0.1.0-rc.2/Drogon-0.1.0-rc.2-darwin-arm64.zip",
  );
  assert.equal(cask.app, "Drogon.app");
  assert.equal(cask.binary, "#{appdir}/Drogon.app/Contents/Resources/bin/drogon-cli");
  assert.equal(cask.uninstallExecutable, "#{appdir}/Drogon.app/Contents/Resources/bin/drogon-stop-daemon");
  assert.deepEqual(cask.zapTrash, [
    "~/Applications/.drogon-builds",
    "~/Library/Application Support/Drogon",
    "~/Library/Caches/Drogon",
    "~/Library/Logs/Drogon",
    "~/Library/Preferences/ai.clioo.drogon.plist",
    "~/Library/Saved Application State/ai.clioo.drogon.savedState",
  ]);
  assert.equal(cask.advertisesAdHoc, true);
});

test("parseCaskRuby reads the notarized rc.3 cask as not ad-hoc", () => {
  const cask = parseCaskRuby(RC3_RUBY);
  assert.equal(cask.version, "0.1.0-rc.3");
  assert.equal(cask.advertisesAdHoc, false);
  assert.equal(cask.caveats, null);
});

test("parseCaskRuby fails closed on a cask without identity", () => {
  assert.throws(() => parseCaskRuby('cask "drogon" do\nend\n'), /no version/);
});

test("compareDrogonVersions orders release candidates and finals", () => {
  assert.equal(compareDrogonVersions("0.1.0-rc.1", "0.1.0-rc.2"), -1);
  assert.equal(compareDrogonVersions("0.1.0-rc.2", "0.1.0-rc.2"), 0);
  assert.equal(compareDrogonVersions("0.1.0-rc.3", "0.1.0-rc.2"), 1);
  assert.equal(compareDrogonVersions("0.1.0-rc.3", "0.1.0"), -1);
  assert.equal(compareDrogonVersions("0.1.0", "0.1.0-rc.9"), 1);
  assert.equal(compareDrogonVersions("0.2.0-rc.1", "0.1.0"), 1);
  assert.throws(() => compareDrogonVersions("nope", "0.1.0-rc.2"), /not a Drogon version/);
});

test("tapNeedsTrust spots the fresh-prefix trust refusal", () => {
  assert.equal(
    tapNeedsTrust("Error: Invalid cask (macOS 27 on arm): drogon.rb\nRefusing to load cask clioo/drogon/drogon from untrusted tap clioo/drogon."),
    true,
  );
  assert.equal(tapNeedsTrust("Tapped 1 cask (15 files, 21KB)."), false);
  assert.equal(tapNeedsTrust("Error: No available formula with the name \"nope\"."), false);
});

test("spctlAccepted and quarantineAttributePresent read command output", () => {
  assert.equal(spctlAccepted("/tmp/x/Drogon.app: accepted\nsource=Notarized Developer ID\n"), true);
  assert.equal(spctlAccepted("/tmp/x/Drogon.app: rejected\nsource=no usable signature\n"), false);
  assert.equal(quarantineAttributePresent("com.apple.quarantine\t0081;0000;\n"), true);
  assert.equal(quarantineAttributePresent(""), false);
});

test("assertRoomContained keeps the run inside its temp dir", () => {
  const room = path.join(tmpdir(), "room-1");
  assert.doesNotThrow(() => assertRoomContained(room, path.join(room, "Applications", "Drogon.app")));
  assert.doesNotThrow(() => assertRoomContained(room, room));
  assert.throws(() => assertRoomContained(room, "/Applications/Drogon.app"), /outside the clean room/);
  assert.throws(
    () => assertRoomContained(path.join(tmpdir(), "x"), path.join(tmpdir(), "x-evil", "bin")),
    /outside the clean room/,
  );
});

test("commandMatchesDaemon mirrors the stop hook with data-dir scoping", () => {
  const daemon = "/tmp/room/Applications/Drogon.app/Contents/Resources/bin/drogond";
  const data = "/tmp/room/drogon-data";
  assert.equal(commandMatchesDaemon(`${daemon} --data-dir ${data}`, daemon, data), true);
  assert.equal(commandMatchesDaemon(`${daemon} --data-dir ${data} --foreground`, daemon, data), true);
  assert.equal(commandMatchesDaemon(`${daemon} --data-dir ${data}/nested`, daemon, data), true);
  assert.equal(commandMatchesDaemon(`${daemon} --data-dir ${data}-evil`, daemon, data), false);
  assert.equal(commandMatchesDaemon(`${daemon} --other-flag ${data}`, daemon, data), false);
  assert.equal(commandMatchesDaemon(`/other/drogond --data-dir ${data}`, daemon, data), false);
  assert.equal(commandMatchesDaemon(`${daemon} --data-dir /other/place`, daemon, data), false);
});

test("expandZapPath expands ~ against the fresh HOME only", () => {
  assert.equal(expandZapPath("~/Library/Caches/Drogon", "/tmp/room/home"), "/tmp/room/home/Library/Caches/Drogon");
  assert.equal(expandZapPath("/absolute/stays", "/tmp/room/home"), "/absolute/stays");
});

test("launchEnv isolates HOME, data dir and PATH and stays backgrounded", () => {
  const room = { dir: "/tmp/room", home: "/tmp/room/home", dataDir: "/tmp/room/data", electronProfile: "/tmp/room/e" };
  const env = launchEnv(room);
  assert.equal(env.DROGON_BACKGROUND_WINDOW, "1");
  assert.equal(env.DROGON_DATA_DIR, "/tmp/room/data");
  assert.equal(env.DROGON_ELECTRON_PROFILE, "/tmp/room/e");
  assert.equal(env.HOME, "/tmp/room/home");
  assert.equal(env.PATH, "/usr/bin:/bin:/usr/sbin:/sbin");
});

test("step records pass/fail and rethrows failures", async () => {
  const steps = [];
  const detail = await step(steps, "ok", async () => "fine");
  assert.equal(detail, "fine");
  await assert.rejects(step(steps, "bad", async () => { throw new Error("boom"); }), /boom/);
  assert.equal(steps[0].status, "PASSED");
  assert.equal(steps[1].status, "FAILED");
  assert.match(steps[1].detail, /boom/);
  skipStep(steps, "skipped", "no versions");
  assert.equal(steps[2].status, "SKIPPED");
});

test("summarizeRun reports PASSED only with zero failures", () => {
  const passed = summarizeRun({
    steps: [
      { name: "a", status: "PASSED" },
      { name: "b", status: "SKIPPED", detail: "x" },
    ],
    cleanup: {},
    versions: { from: "0.1.0-rc.1", to: "0.1.0-rc.2" },
    durationMs: 7,
  });
  assert.equal(passed.status, "PASSED");
  assert.deepEqual(passed.counts, { passed: 1, failed: 0, skipped: 1 });
  const failed = summarizeRun({
    steps: [{ name: "a", status: "FAILED", detail: "boom" }],
    cleanup: {},
    versions: {},
    durationMs: 7,
  });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.counts.failed, 1);
});

test("makeCleanRoom returns a symlink-free room root", async () => {
  const { room } = await makeCleanRoom();
  try {
    assert.equal(room.dir, await realpath(room.dir));
    assert.doesNotThrow(() => assertRoomContained(room.dir, path.join(room.appdir, "Drogon.app")));
  } finally {
    await rm(room.dir, { recursive: true, force: true });
  }
});

test("snapshotTree records relative paths of a fresh HOME", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "home-snap-"));
  await mkdir(path.join(root, "Library", "Caches"), { recursive: true });
  await writeFile(path.join(root, "Library", "Caches", "f"), "x");
  const snap = await snapshotTree(root);
  assert.ok(snap.has("Library"));
  assert.ok(snap.has(path.join("Library", "Caches", "f")));
  assert.equal(await snapshotTree(path.join(root, "does-not-exist")).then((s) => s.size), 0);
});
