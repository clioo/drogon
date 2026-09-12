// MIT Copyright (c) 2026 Lovecast Inc.
// Behavioural tests for `make install`. The process helpers run against
// injected process tables so every branch (graceful exit, forced exit,
// recycled pid) is exercised without signalling anything real; the install
// test performs a real swap of a real signed bundle inside a temporary
// Applications directory, never the developer's installed app.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { APP_BUNDLE_ID, fingerprintBundle } from "./desktop-artifacts.mjs";
import {
  APP_NAME,
  PREVIOUS_PREFIX,
  buildMainRunDirectory,
  commandMatches,
  install,
  matchingProcesses,
  packagedBundle,
  parseInstallArgs,
  previousBundleName,
  stalePreviousBundles,
  stopProcesses,
} from "./install-drogon.mjs";

const execFileAsync = promisify(execFile);
const darwinOnly = { skip: process.platform !== "darwin" };
const REVISION = "0123456789abcdef0123456789abcdef01234567";

test("parseInstallArgs defaults to packaging this checkout and restarting", () => {
  assert.deepEqual(parseInstallArgs([]), {
    bundle: null,
    fromMain: false,
    applications: "/Applications",
    restart: true,
    keep: 1,
    source: "checkout",
  });
});

test("parseInstallArgs reads every supported flag", () => {
  const options = parseInstallArgs([
    "--bundle",
    "/tmp/x/Drogon.app",
    "--applications",
    "/elsewhere",
    "--no-restart",
    "--keep",
    "3",
  ]);
  assert.equal(options.source, "bundle");
  assert.equal(options.bundle, "/tmp/x/Drogon.app");
  assert.equal(options.applications, "/elsewhere");
  assert.equal(options.restart, false);
  assert.equal(options.keep, 3);
});

test("parseInstallArgs rejects unknown, incomplete and conflicting input", () => {
  assert.throws(() => parseInstallArgs(["--wat"]), /Unknown option: --wat/);
  assert.throws(() => parseInstallArgs(["--bundle"]), /--bundle needs a value/);
  assert.throws(() => parseInstallArgs(["--keep", "-1"]), /non-negative/);
  assert.throws(() => parseInstallArgs(["--keep", "two"]), /non-negative/);
  assert.throws(
    () => parseInstallArgs(["--from-main", "--bundle", "/a/Drogon.app"]),
    /drop --bundle/,
  );
});

test("process matching respects argv boundaries", () => {
  const daemon = "/Applications/Drogon.app/Contents/Resources/bin/drogond";
  assert.ok(commandMatches(`${daemon} --data-dir /data`, `${daemon} --data-dir`));
  assert.ok(!commandMatches(`${daemon}-shim --data-dir /d`, `${daemon} --data-dir`));
  const table = [
    `  101 ${daemon} --data-dir /data`,
    `  102 /Applications/.Drogon-previous-x.app/Contents/Resources/bin/drogond --data-dir /data`,
    "  103 /bin/zsh",
    "",
  ].join("\n");
  assert.deepEqual(
    matchingProcesses(table, `${daemon} --data-dir`).map((entry) => entry.pid),
    [101],
  );
});

test("packagedBundle takes the last PACKAGED receipt and ignores noise", () => {
  const log = [
    "compiling...",
    JSON.stringify({ status: "PACKAGED", bundle: "/a/Drogon.app" }),
    JSON.stringify({ status: "PACKAGED", bundle: "/b/Drogon.app" }),
  ].join("\n");
  assert.equal(packagedBundle(log).bundle, "/b/Drogon.app");
  assert.throws(() => packagedBundle("nothing here"), /did not report a bundle/);
});

test("buildMainRunDirectory reads build-main.sh's retained directory", () => {
  const output = "Build directory (retained, including on failure): /w/run-AB\nSource revision: abc\n";
  assert.equal(buildMainRunDirectory(output), "/w/run-AB");
  assert.throws(() => buildMainRunDirectory("nope"), /did not report/);
});

test("rollback copies are pruned oldest-first", () => {
  const names = [
    "Drogon.app",
    `${PREVIOUS_PREFIX}2026-09-10T00-00-00-000Z.app`,
    `${PREVIOUS_PREFIX}2026-09-12T00-00-00-000Z.app`,
    `${PREVIOUS_PREFIX}2026-09-11T00-00-00-000Z.app`,
  ];
  assert.deepEqual(stalePreviousBundles(names, 1), [
    `${PREVIOUS_PREFIX}2026-09-10T00-00-00-000Z.app`,
    `${PREVIOUS_PREFIX}2026-09-11T00-00-00-000Z.app`,
  ]);
  assert.deepEqual(stalePreviousBundles(names, 5), []);
  assert.match(previousBundleName(new Date(0)), /^\.Drogon-previous-1970-01-01T00-00-00-000Z\.app$/);
});

/** A scripted process table: each tick returns the next listing. */
function processTable(listings) {
  const signals = [];
  let tick = 0;
  const clock = { value: 0 };
  return {
    signals,
    clock,
    deps: {
      listProcesses: async () => listings[Math.min(tick, listings.length - 1)],
      kill: (pid, signal) => signals.push(`${signal} ${pid}`),
      sleep: async () => {
        tick += 1;
        clock.value += 200;
      },
      now: () => clock.value,
      graceMs: 1000,
      forceMs: 400,
    },
  };
}

test("stopProcesses signals nothing when the process is already gone", async () => {
  const table = processTable(["  1 /bin/zsh"]);
  const result = await stopProcesses("/pkg/drogond --data-dir", table.deps);
  assert.deepEqual(result.requested, []);
  assert.deepEqual(table.signals, []);
});

test("stopProcesses stops a cooperating process with SIGTERM alone", async () => {
  const prefix = "/pkg/drogond --data-dir";
  const table = processTable([`  7 ${prefix} /data`, `  7 ${prefix} /data`, "  1 /bin/zsh"]);
  const result = await stopProcesses(prefix, table.deps);
  assert.deepEqual(table.signals, ["SIGTERM 7"]);
  assert.deepEqual(result.stopped, [7]);
  assert.deepEqual(result.forced, []);
  assert.deepEqual(result.survivors, []);
});

test("stopProcesses escalates to SIGKILL only after the grace period", async () => {
  const prefix = "/pkg/drogond --data-dir";
  const stubborn = `  9 ${prefix} /data`;
  const table = processTable([stubborn, stubborn, stubborn, stubborn, stubborn, stubborn, "  1 /bin/zsh"]);
  const result = await stopProcesses(prefix, table.deps);
  assert.deepEqual(table.signals, ["SIGTERM 9", "SIGKILL 9"]);
  assert.deepEqual(result.forced, [9]);
  assert.deepEqual(result.stopped, [9]);
  assert.deepEqual(result.survivors, []);
});

test("stopProcesses never signals a recycled pid that now runs something else", async () => {
  const prefix = "/pkg/drogond --data-dir";
  // The daemon exits late in the grace period and the pid is immediately
  // reused, so the escalation re-check must see a stranger, not the daemon.
  const table = processTable([
    `  11 ${prefix} /data`,
    `  11 ${prefix} /data`,
    `  11 ${prefix} /data`,
    `  11 ${prefix} /data`,
    `  11 ${prefix} /data`,
    "  11 /usr/bin/unrelated --busy",
  ]);
  const result = await stopProcesses(prefix, table.deps);
  assert.deepEqual(table.signals, ["SIGTERM 11"]);
  assert.deepEqual(result.forced, []);
  assert.deepEqual(result.survivors, []);
});

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Drogon</string>
<key>CFBundleIdentifier</key><string>__ID__</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>CFBundleName</key><string>Drogon</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`;

/** A minimally real, ad-hoc signed Drogon bundle: enough structure that the
 *  installer's own verification (build-info fingerprints, icon name, bundle
 *  id, codesign) runs unmodified against it. */
async function fakeBundle(directory, { revision = REVISION, version = "0.0.0-test", identifier = APP_BUNDLE_ID } = {}) {
  const bundle = path.join(directory, APP_NAME);
  const contents = path.join(bundle, "Contents");
  const resources = path.join(contents, "Resources");
  await mkdir(path.join(contents, "MacOS"), { recursive: true });
  await mkdir(path.join(resources, "bin"), { recursive: true });
  await mkdir(path.join(resources, "app", "main"), { recursive: true });
  await writeFile(path.join(contents, "Info.plist"), PLIST.replace("__ID__", identifier));
  await writeFile(path.join(contents, "MacOS", "Drogon"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await writeFile(path.join(resources, "icon.icns"), "icns");
  await writeFile(path.join(resources, "app", "main", "index.js"), `// ${revision}\n`);
  for (const name of ["drogond", "drogon-cli"])
    await writeFile(path.join(resources, "bin", name), `#!/bin/sh\necho ${name} ${revision}\n`, { mode: 0o755 });
  // The real scoped teardown ships inside every bundle; the installer runs the
  // INSTALLED copy of it, so the test must carry the same file.
  const stop = path.join(resources, "bin", "drogon-stop-daemon");
  await writeFile(stop, await readFile(new URL("drogon-stop-daemon.sh", import.meta.url), "utf8"));
  await chmod(stop, 0o755);
  const { artifacts, artifactDigest } = await fingerprintBundle(bundle);
  await writeFile(
    path.join(resources, "build-info.json"),
    JSON.stringify(
      {
        schema: 1,
        appBundleId: identifier,
        revision,
        dirty: false,
        version,
        channel: "preview",
        platform: process.platform,
        arch: process.arch,
        artifacts,
        artifactDigest,
      },
      null,
      2,
    ) + "\n",
  );
  await execFileAsync("/usr/bin/codesign", ["--force", "--sign", "-", bundle]);
  return bundle;
}

test("install swaps the app, keeps one rollback copy and prunes the rest", darwinOnly, async (t) => {
  const work = await mkdtemp(path.join(tmpdir(), "drogon-install-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const applications = path.join(work, "Applications");
  await mkdir(applications);
  const first = await fakeBundle(await mkdtemp(path.join(work, "build1-")), { revision: REVISION, version: "0.0.1" });
  const second = await fakeBundle(await mkdtemp(path.join(work, "build2-")), {
    revision: "89abcdef0123456789abcdef0123456789abcdef",
    version: "0.0.2",
  });
  const flags = ["--applications", applications, "--no-restart"];

  const fresh = await install(["--bundle", first, ...flags]);
  assert.equal(fresh.status, "INSTALLED");
  assert.equal(fresh.previousBundle, null);
  assert.equal(fresh.relaunch.started, false);
  assert.equal(fresh.stoppedDaemon.verdict, "exited");
  assert.equal(
    (await readFile(path.join(applications, APP_NAME, "Contents", "Resources", "build-info.json"), "utf8")).includes(REVISION),
    true,
  );
  // The installed copy carries a valid signature, so ditto preserved it.
  await execFileAsync("/usr/bin/codesign", ["--verify", "--deep", "--strict", path.join(applications, APP_NAME)]);

  const upgrade = await install(["--bundle", second, ...flags]);
  assert.ok(upgrade.previousBundle?.includes(PREVIOUS_PREFIX));
  const info = JSON.parse(await readFile(path.join(applications, APP_NAME, "Contents", "Resources", "build-info.json"), "utf8"));
  assert.equal(info.version, "0.0.2");
  assert.equal(JSON.parse(await readFile(path.join(upgrade.previousBundle, "Contents", "Resources", "build-info.json"), "utf8")).version, "0.0.1");

  const third = await fakeBundle(await mkdtemp(path.join(work, "build3-")), {
    revision: "456789abcdef0123456789abcdef0123456789ab",
    version: "0.0.3",
  });
  await install(["--bundle", third, ...flags]);
  const entries = await readdir(applications);
  assert.deepEqual(entries.filter((name) => name.startsWith(".drogon-install-")), [], "staging directories are cleaned up");
  assert.equal(entries.filter((name) => name.startsWith(PREVIOUS_PREFIX)).length, 1, "only --keep rollback copies remain");
});

test("install refuses to replace an application that is not Drogon", darwinOnly, async (t) => {
  const work = await mkdtemp(path.join(tmpdir(), "drogon-install-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const applications = path.join(work, "Applications");
  await mkdir(applications);
  await fakeBundle(applications, { identifier: "com.example.other" });
  const incoming = await fakeBundle(await mkdtemp(path.join(work, "build-")));
  await assert.rejects(
    install(["--bundle", incoming, "--applications", applications, "--no-restart"]),
    /is not a Drogon bundle; refusing to replace it/,
  );
  const plist = await readFile(path.join(applications, APP_NAME, "Contents", "Info.plist"), "utf8");
  assert.ok(plist.includes("com.example.other"), "the foreign application is untouched");
});

test("install refuses to reinstall the bundle already installed", darwinOnly, async (t) => {
  const work = await mkdtemp(path.join(tmpdir(), "drogon-install-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const applications = path.join(work, "Applications");
  await mkdir(applications);
  const built = await fakeBundle(await mkdtemp(path.join(work, "build-")));
  await install(["--bundle", built, "--applications", applications, "--no-restart"]);
  await assert.rejects(
    install(["--bundle", path.join(applications, APP_NAME), "--applications", applications, "--no-restart"]),
    /already the installed one/,
  );
});
