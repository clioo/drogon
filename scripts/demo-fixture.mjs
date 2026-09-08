#!/usr/bin/env node
/**
 * Prepare the disposable project used by docs/demo-script.md.
 *
 * This script deliberately talks to an already-running Drogon daemon. Pass
 * --qa after `scripts/qa/drogon-ui.mjs start`, or pass --data-dir while a
 * daemon owns that directory. It never starts Electron, a daemon, a model,
 * or a server, and it refuses to remove an unmarked /tmp/drogon-demo.
 */

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  readFile,
  rm,
  rmdir,
  writeFile,
  rename,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");

export const DEMO_ROOT = "/tmp/drogon-demo";
export const DEMO_MARKER_NAME = ".drogon-demo-fixture.json";
export const DEFAULT_MANIFEST_PATH = path.join(
  REPO_ROOT,
  ".preflight",
  "demo-fixture.json",
);
// Override with $DROGON_MENTU_RUNTIME_SOURCE on machines without the local
// reference checkout; the daemon is consulted first and this path is only
// used when the pinned runtime is not already installed.
export const PINNED_MENTU_RUNTIME_SOURCE =
  process.env.DROGON_MENTU_RUNTIME_SOURCE ??
  "/Users/carlos/Documents/Drogon-mentu-session/.mentu/runtime/" +
    "b72a1203d46c1d930be1aead65388ddfbe9a8fc4/bin/mentu-recipes";
export const PINNED_MENTU_RUNTIME_PROVISION_COMMAND = `node scripts/mentu-runtime-provision.mjs --source ${PINNED_MENTU_RUNTIME_SOURCE}`;
export const DEMO_PROVIDER = "dgx-spark";
export const DEMO_MODEL = "qwen3.8-flash-next-nvidia-nvfp4";
export const DEMO_MODEL_SPEC = `${DEMO_PROVIDER}/${DEMO_MODEL}`;
export const DEMO_RECIPE_ID = "demo-hello";

const MARKER_VERSION = 1;
const MANIFEST_VERSION = 1;
const OWNED_MARKER = "drogon-demo-fixture";

const README = `# Drogon demo fixture

A deliberately small project for the Drogon five-minute demo. It contains a
web page, a Make target, and a Mentu recipe that can be run without a network.

Try \`make hello\` or open \`index.html\` in the Drogon browser tab.
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Drogon demo</title>
    <style>
      :root { color-scheme: light dark; font: 16px system-ui, sans-serif; }
      body { display: grid; min-height: 100vh; place-items: center; margin: 0; }
      main { max-width: 34rem; padding: 2rem; }
      code { color: #7dd3fc; }
    </style>
  </head>
  <body>
    <main>
      <p aria-label="Drogon demo marker">Drogon demo fixture</p>
      <h1>Small project, durable work.</h1>
      <p>This page is served by the throwaway repository used in the demo.</p>
      <p>Run <code>make hello</code> to create the recipe's greeting artifact.</p>
    </main>
  </body>
</html>
`;

const MAKEFILE = `.PHONY: hello check serve

hello:
\t@printf 'hello from Drogon demo\\n' > greeting.txt
\t@printf 'created greeting.txt\\n'

check:
\t@test -s index.html
\t@grep -q 'Drogon demo fixture' index.html

serve:
\t@python3 -m http.server 4173
`;

/**
 * The first two steps are shell commands. The third is an explicit shell
 * verification step, which keeps the graph and the `mentu-recipes check`
 * output easy to explain on stage.
 */
export const DEMO_RECIPE = {
  name: "Drogon demo hello",
  description: "Two local shell steps followed by a verification step.",
  steps: [
    {
      label: "write-greeting",
      backend: "shell",
      prompt: "printf 'hello from Drogon demo\\n' > greeting.txt",
      timeout: 30,
    },
    {
      label: "check-page",
      backend: "shell",
      prompt: "make check",
      timeout: 30,
      depends_on: ["write-greeting"],
    },
    {
      label: "verify-demo",
      backend: "shell",
      prompt: "true",
      timeout: 30,
      depends_on: ["check-page"],
      verify: {
        commands: ["test -s greeting.txt", "test -f index.html"],
      },
    },
  ],
};

function usage() {
  return [
    "Usage: node scripts/demo-fixture.mjs [options]",
    "",
    "  --qa                 use the running scripts/qa/drogon-ui.mjs session",
    "  --data-dir PATH      use a daemon at PATH (or DROGON_DATA_DIR)",
    "  --cli PATH           drogon-cli binary (defaults to target/debug)",
    "  --runtime PATH       mentu-recipes binary used for the check step",
    "  --teardown           remove only this fixture's registrations and files",
    "  --help",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = {
    qa: false,
    teardown: false,
    dataDir: process.env.DROGON_DATA_DIR || null,
    cliPath: process.env.DROGON_CLI || null,
    runtimePath:
      process.env.DROGON_MENTU_RUNTIME_SOURCE || PINNED_MENTU_RUNTIME_SOURCE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--qa") {
      options.qa = true;
    } else if (arg === "--teardown") {
      options.teardown = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--data-dir" || arg === "--cli" || arg === "--runtime") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.\n\n${usage()}`);
      }
      if (arg === "--data-dir") options.dataDir = value;
      if (arg === "--cli") options.cliPath = value;
      if (arg === "--runtime") options.runtimePath = value;
    } else {
      throw new Error(`Unknown argument ${arg}.\n\n${usage()}`);
    }
  }
  return options;
}

function text(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function commandResult(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.env || {}),
      // A demo fixture must not inherit an Electron-as-Node launch mode.
      ELECTRON_RUN_AS_NODE: undefined,
    },
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    signal: result.signal,
    stdout: text(result.stdout),
    stderr: text(result.stderr),
  };
}

function git(root, args) {
  const result = commandResult(
    "git",
    [
      "-c",
      "user.name=Drogon demo fixture",
      "-c",
      "user.email=drogon-demo-fixture@example.invalid",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    {
      cwd: root,
      env: {
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.status ?? result.signal}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout.trim();
}

function ensureObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid result`);
  }
  return value;
}

function cliError(envelope, command) {
  const error = new Error(
    `${command} failed: ${envelope?.error?.message || "unknown Drogon error"}`,
  );
  error.code = envelope?.error?.code || "cli_error";
  error.envelope = envelope;
  return error;
}

function makeCliClient({ cliPath, dataDir }) {
  if (!cliPath) throw new Error("No drogon-cli path; pass --cli PATH.");
  if (!dataDir)
    throw new Error("No daemon data directory; pass --data-dir PATH or --qa.");

  const invoke = (args) => {
    const command = `${cliPath} --data-dir ${dataDir} --json ${args.join(" ")}`;
    const result = commandResult(
      cliPath,
      ["--data-dir", dataDir, "--json", ...args],
      {
        cwd: REPO_ROOT,
      },
    );
    let envelope;
    try {
      envelope = JSON.parse(result.stdout.trim());
    } catch {
      throw new Error(
        `${command} produced no JSON (${result.status ?? result.signal}): ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    if (result.status !== 0 || envelope.ok !== true)
      throw cliError(envelope, command);
    return envelope.result;
  };

  return {
    dataDir,
    cliPath,
    call(method, params = {}) {
      return invoke([
        "rpc",
        method,
        "--params",
        JSON.stringify(params),
        "--request-id",
        randomUUID(),
      ]);
    },
    cli(...args) {
      return invoke(args);
    },
  };
}

async function loadQaConnection() {
  const sessionPath = path.join(REPO_ROOT, ".qa", "session.json");
  let session;
  try {
    session = JSON.parse(await readFile(sessionPath, "utf8"));
  } catch (error) {
    throw new Error(
      `No QA session at ${sessionPath}; run \`node scripts/qa/drogon-ui.mjs start\` first (${error.message}).`,
    );
  }
  if (!session.dataDir || !session.cliBin) {
    throw new Error("The QA session has no daemon dataDir or cliBin.");
  }
  return { dataDir: session.dataDir, cliPath: session.cliBin };
}

async function resolveConnection(options) {
  const qa = options.qa ? await loadQaConnection() : {};
  const rawDataDir = qa.dataDir || options.dataDir;
  if (!rawDataDir) {
    throw new Error("No daemon data directory; pass --data-dir PATH or --qa.");
  }
  const dataDir = path.resolve(rawDataDir);
  const cliPath = path.resolve(
    qa.cliPath ||
      options.cliPath ||
      path.join(
        REPO_ROOT,
        "target",
        "debug",
        os.platform() === "win32" ? "drogon-cli.exe" : "drogon-cli",
      ),
  );
  if (dataDir === path.parse(dataDir).root) {
    throw new Error("A daemon data directory cannot be the filesystem root.");
  }
  try {
    await access(cliPath);
  } catch {
    throw new Error(`drogon-cli is not executable or is missing: ${cliPath}`);
  }
  return makeCliClient({ dataDir, cliPath });
}

async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function markerPath(rootPath) {
  return path.join(rootPath, DEMO_MARKER_NAME);
}

async function readOwnedMarker(rootPath) {
  let info;
  try {
    info = await lstat(rootPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Refusing to use ${rootPath}: it is not a real directory.`);
  }
  let marker;
  try {
    marker = await readJson(markerPath(rootPath));
  } catch (error) {
    throw new Error(
      `Refusing to touch existing ${rootPath}: missing or invalid ${DEMO_MARKER_NAME} (${error.message}).`,
    );
  }
  if (
    marker?.format !== MARKER_VERSION ||
    marker?.owner !== OWNED_MARKER ||
    marker?.root !== rootPath
  ) {
    throw new Error(
      `Refusing to touch ${rootPath}: its ownership marker is not ours.`,
    );
  }
  return marker;
}

function blankManifest(rootPath, connection) {
  return {
    format: MANIFEST_VERSION,
    owner: OWNED_MARKER,
    root: rootPath,
    markerNonce: null,
    dataDir: connection.dataDir,
    hostId: null,
    projectId: null,
    worktreeId: null,
    workspaceId: null,
    worktreePath: null,
    botId: null,
    responsibilityId: null,
    responsibilityAutomationId: null,
    automationId: null,
    recipeId: DEMO_RECIPE_ID,
    model: DEMO_MODEL,
    provider: DEMO_PROVIDER,
    runtimeSource: null,
    runtimeInstallPath: null,
    runtimeInstallOwned: false,
    runtimeInstallStatus: null,
    validation: null,
    createdAt: new Date().toISOString(),
  };
}

function verifyManifest(manifest, rootPath) {
  if (
    !manifest ||
    manifest.format !== MANIFEST_VERSION ||
    manifest.owner !== OWNED_MARKER ||
    manifest.root !== rootPath
  ) {
    throw new Error(
      `Refusing to use a demo manifest that is not owned by this fixture.`,
    );
  }
}

function isMissingError(error) {
  return [
    "not_found",
    "unknown_workspace",
    "unknown_project",
    "unknown_bot",
  ].includes(error?.code);
}

/**
 * Remove every registration represented by a manifest, then remove the marked
 * project tree. Missing rows count as already removed; every other daemon
 * error is returned so a failed cleanup never silently deletes files.
 */
async function removeOwnedRuntime(manifest) {
  if (!manifest.runtimeInstallOwned) return null;
  const dataDir = path.resolve(text(manifest.dataDir));
  const expectedPath = path.join(
    dataDir,
    "mentu",
    "runtime",
    "bin",
    "mentu-recipes",
  );
  const claimedPath = path.resolve(text(manifest.runtimeInstallPath));
  if (claimedPath !== expectedPath) {
    throw new Error(
      `Refusing to remove Mentu runtime outside the daemon data directory: ${claimedPath}.`,
    );
  }
  let info;
  try {
    info = await lstat(claimedPath);
  } catch (error) {
    if (error.code === "ENOENT") return "runtime (already absent)";
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(
      `Refusing to remove a non-regular Mentu runtime at ${claimedPath}.`,
    );
  }
  await rm(claimedPath, { force: true });
  // Remove only empty directories created for this runtime. A shared data
  // directory may have other Mentu state, so each failed rmdir is harmless.
  for (const directory of [
    path.dirname(claimedPath),
    path.dirname(path.dirname(claimedPath)),
    path.dirname(path.dirname(path.dirname(claimedPath))),
  ]) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (
        !["ENOENT", "ENOTEMPTY", "EEXIST", "EPERM", "EACCES"].includes(
          error.code,
        )
      )
        throw error;
    }
  }
  return "runtime";
}

async function installRuntime(connection, runtimePath, manifest, manifestPath) {
  const current = ensureObject(
    await connection.call("mentu.runtime"),
    "mentu.runtime",
  );
  const currentRuntime = ensureObject(current.runtime, "mentu.runtime.runtime");
  const destination = path.resolve(
    manifest.dataDir,
    "mentu",
    "runtime",
    "bin",
    "mentu-recipes",
  );
  manifest.runtimeInstallPath = currentRuntime.path
    ? path.resolve(currentRuntime.path)
    : destination;
  if (
    currentRuntime.available === true &&
    currentRuntime.lockMatches === true
  ) {
    manifest.runtimeInstallStatus = "already_installed";
    await writeJsonAtomic(manifestPath, manifest);
    return { status: "already_installed", runtime: currentRuntime };
  }
  if (manifest.runtimeInstallPath !== destination) {
    throw new Error(
      `Refusing to install Mentu runtime at an unexpected path: ${manifest.runtimeInstallPath}.`,
    );
  }
  try {
    const existing = await lstat(destination);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error(
        `Refusing to replace an existing non-regular Mentu runtime at ${destination}.`,
      );
    }
    throw new Error(
      `Refusing to replace an existing Mentu runtime at ${destination}; use its matching pinned runtime or a fresh demo data directory.`,
    );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Record ownership before the RPC: an interrupted setup can still remove a
  // newly installed file without ever guessing whether it was ours.
  manifest.runtimeInstallOwned = true;
  manifest.runtimeInstallStatus = "installing";
  await writeJsonAtomic(manifestPath, manifest);
  const installed = ensureObject(
    await connection.call("mentu.runtime_install", {
      sourcePath: path.resolve(runtimePath),
    }),
    "mentu.runtime_install",
  );
  if (
    installed.status !== "installed" &&
    installed.status !== "already_installed"
  ) {
    throw new Error(
      `mentu.runtime_install returned an unknown status: ${installed.status}`,
    );
  }
  manifest.runtimeInstallStatus = installed.status;
  if (installed.status === "already_installed")
    manifest.runtimeInstallOwned = false;
  await writeJsonAtomic(manifestPath, manifest);
  return installed;
}

export async function teardownFixture({
  connection,
  invoke,
  rootPath = DEMO_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      const marker = await readOwnedMarker(rootPath);
      if (!marker)
        return { removed: false, alreadyClean: true, operations: [] };
      // A marker without a manifest can only be safely removed when no daemon
      // registration is claimed. Setup writes the manifest before any RPC, so
      // this is a recoverable interrupted preflight, not user data.
      await rm(rootPath, { recursive: true, force: true });
      return { removed: true, alreadyClean: false, operations: ["files"] };
    }
    throw error;
  }
  verifyManifest(manifest, rootPath);
  const marker = await readOwnedMarker(rootPath);
  if (marker && manifest.markerNonce && marker.nonce !== manifest.markerNonce) {
    throw new Error(
      `Refusing to use ${rootPath}: its marker does not match the manifest.`,
    );
  }
  if (
    manifest.dataDir &&
    connection?.dataDir &&
    path.resolve(manifest.dataDir) !== path.resolve(connection.dataDir)
  ) {
    throw new Error(
      `Refusing to unregister ${rootPath}: it belongs to daemon data directory ${manifest.dataDir}.`,
    );
  }
  const call = invoke || connection?.call?.bind(connection);
  const registrations = [
    manifest.botId,
    manifest.automationId,
    manifest.worktreeId,
    manifest.projectId,
  ];
  if (!call && registrations.some(Boolean)) {
    throw new Error(
      "A running daemon is required to unregister the demo fixture first.",
    );
  }
  const operations = [];
  const removeRpc = async (method, params, label) => {
    if (!call) return;
    try {
      await call(method, params);
      operations.push(label);
    } catch (error) {
      if (isMissingError(error)) {
        operations.push(`${label} (already absent)`);
        return;
      }
      throw error;
    }
  };

  // Bot deletion also removes the Bot-owned automation created with its
  // responsibility. The standalone shell-command automation is separate.
  if (manifest.botId && manifest.workspaceId && manifest.hostId) {
    await removeRpc(
      "bot.delete",
      {
        workspaceId: manifest.workspaceId,
        hostId: manifest.hostId,
        botId: manifest.botId,
      },
      "bot",
    );
  }
  if (manifest.automationId) {
    await removeRpc(
      "automation.delete",
      { id: manifest.automationId },
      "shell-command automation",
    );
  }
  if (manifest.worktreeId) {
    await removeRpc(
      "worktree.remove",
      { id: manifest.worktreeId, force: true },
      "worktree",
    );
  }
  if (manifest.projectId) {
    await removeRpc("project.remove", { id: manifest.projectId }, "project");
  }
  const runtimeOperation = await removeOwnedRuntime(manifest);
  if (runtimeOperation) operations.push(runtimeOperation);

  await rm(rootPath, { recursive: true, force: true });
  await rm(manifestPath, { force: true });
  operations.push("files");
  return { removed: true, alreadyClean: false, operations };
}

async function ensureFreshRoot(rootPath, connection, manifestPath) {
  const marker = await readOwnedMarker(rootPath);
  if (!marker) return;
  let oldManifest = null;
  try {
    oldManifest = await readJson(manifestPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (oldManifest) {
    verifyManifest(oldManifest, rootPath);
    if (
      oldManifest.dataDir &&
      path.resolve(oldManifest.dataDir) !== path.resolve(connection.dataDir)
    ) {
      throw new Error(
        `Refusing to reuse ${rootPath}: it belongs to daemon data directory ${oldManifest.dataDir}.`,
      );
    }
    await teardownFixture({ connection, rootPath, manifestPath });
  } else {
    await rm(rootPath, { recursive: true, force: true });
  }
}

async function createGitProject(rootPath) {
  let initialized = false;
  const init = commandResult(
    "git",
    ["init", "--quiet", "--initial-branch=main"],
    {
      cwd: rootPath,
      env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    },
  );
  if (init.status === 0) {
    initialized = true;
  } else {
    git(rootPath, ["init", "--quiet"]);
    git(rootPath, ["branch", "-M", "main"]);
    initialized = true;
  }
  if (!initialized)
    throw new Error("Unable to initialize the demo git repository.");

  git(rootPath, ["add", "--all"]);
  git(rootPath, ["commit", "--quiet", "-m", "Create Drogon demo fixture"]);
  // A second commit makes the review/source-control surface meaningful while
  // keeping the repository intentionally tiny.
  await writeFile(
    path.join(rootPath, "README.md"),
    `${README}\nThe page is intentionally self-contained for the browser segment.\n`,
    "utf8",
  );
  git(rootPath, ["add", "README.md"]);
  git(rootPath, ["commit", "--quiet", "-m", "Document the browser segment"]);
}

async function checkRecipe(rootPath, runtimePath) {
  const recipePath = path.join(
    rootPath,
    ".mentu",
    "recipes",
    `${DEMO_RECIPE_ID}.json`,
  );
  const command = path.resolve(runtimePath);
  const provisionCommand = PINNED_MENTU_RUNTIME_PROVISION_COMMAND;
  try {
    await access(command);
  } catch {
    return {
      status: "unverifiable",
      runtime: command,
      command: `${command} check ${recipePath}`,
      provisionCommand,
      reason: `Pinned mentu-recipes is not available at ${command}.`,
    };
  }
  const result = commandResult(command, ["check", recipePath], {
    cwd: rootPath,
  });
  if (result.status !== 0) {
    throw new Error(
      `mentu-recipes check failed (${result.status ?? result.signal}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return {
    status: "passed",
    runtime: command,
    command: `${command} check ${recipePath}`,
    provisionCommand,
    stdout: result.stdout.trim(),
  };
}

/** Prepare the filesystem and register its entities against a live daemon. */
export async function prepareFixture({
  connection,
  rootPath = DEMO_ROOT,
  manifestPath = DEFAULT_MANIFEST_PATH,
  runtimePath = PINNED_MENTU_RUNTIME_SOURCE,
} = {}) {
  if (!connection?.call)
    throw new Error("A running daemon connection is required.");
  if (path.resolve(rootPath) !== DEMO_ROOT) {
    throw new Error(`The demo fixture root is fixed at ${DEMO_ROOT}.`);
  }
  await ensureFreshRoot(rootPath, connection, manifestPath);
  await mkdir(rootPath, { recursive: true });
  const marker = {
    format: MARKER_VERSION,
    owner: OWNED_MARKER,
    root: rootPath,
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await writeJsonAtomic(markerPath(rootPath), marker);
  const manifest = blankManifest(rootPath, connection);
  manifest.runtimeSource = path.resolve(runtimePath);
  manifest.markerNonce = marker.nonce;
  // Persist before the first RPC so an interrupted setup can be retried with
  // `--teardown` without guessing which resources were created.
  await writeJsonAtomic(manifestPath, manifest);

  try {
    await mkdir(path.join(rootPath, ".mentu", "recipes"), { recursive: true });
    await writeFile(
      path.join(rootPath, ".gitignore"),
      `${DEMO_MARKER_NAME}\n`,
      "utf8",
    );
    await writeFile(path.join(rootPath, "README.md"), README, "utf8");
    await writeFile(path.join(rootPath, "index.html"), INDEX_HTML, "utf8");
    await writeFile(path.join(rootPath, "Makefile"), MAKEFILE, "utf8");
    await writeFile(
      path.join(rootPath, ".mentu", "recipes", `${DEMO_RECIPE_ID}.json`),
      `${JSON.stringify(DEMO_RECIPE, null, 2)}\n`,
      "utf8",
    );
    await createGitProject(rootPath);

    const status = ensureObject(connection.cli("status"), "status");
    if (typeof status.hostId !== "string" || !status.hostId) {
      throw new Error("status did not return a hostId.");
    }
    manifest.hostId = status.hostId;
    await writeJsonAtomic(manifestPath, manifest);

    const project = ensureObject(
      connection.cli("project", "add", rootPath, "--name", "Drogon demo"),
      "project.add",
    );
    if (project.kind !== "git" || typeof project.id !== "string") {
      throw new Error("project.add did not return the expected git project.");
    }
    manifest.projectId = project.id;
    await writeJsonAtomic(manifestPath, manifest);

    const worktree = ensureObject(
      connection.cli(
        "worktree",
        "create",
        "--project",
        project.id,
        "--name",
        "demo-fix",
      ),
      "worktree.create",
    );
    for (const field of ["id", "workspaceId", "path"]) {
      if (typeof worktree[field] !== "string" || !worktree[field]) {
        throw new Error(`worktree.create did not return ${field}.`);
      }
    }
    manifest.worktreeId = worktree.id;
    manifest.workspaceId = worktree.workspaceId;
    manifest.worktreePath = worktree.path;
    await writeJsonAtomic(manifestPath, manifest);

    const bot = ensureObject(
      connection.call("bot.create", {
        workspaceId: worktree.workspaceId,
        hostId: status.hostId,
        botId: "drogon-demo-bot",
        locale: "en-US",
        body: {
          characterPreset: "arya",
          displayIdentity: {
            displayName: "Drogon demo bot",
            handle: "demo-bot",
            title: "Local project reviewer",
          },
          harnessPolicy: {
            defaultHarness: "pi",
            explicitModel: DEMO_MODEL_SPEC,
          },
          instructions:
            "Review this throwaway project and summarize the next useful change.",
          memories: ["This is a disposable hackathon presentation fixture."],
        },
      }),
      "bot.create",
    );
    if (typeof bot.id !== "string" || bot.id !== "drogon-demo-bot") {
      throw new Error("bot.create did not return the expected bot.");
    }
    manifest.botId = bot.id;
    await writeJsonAtomic(manifestPath, manifest);

    const responsibility = ensureObject(
      connection.call("bot.responsibility_create", {
        workspaceId: worktree.workspaceId,
        hostId: status.hostId,
        botId: bot.id,
        name: "Manual demo review",
        // A future-only schedule prevents setup from launching any model. The
        // presenter can invoke this responsibility manually from Bots.
        schedule: "0 0 1 1 *",
        prompt:
          "Review the demo project and report one actionable improvement.",
      }),
      "bot.responsibility_create",
    );
    manifest.responsibilityId = responsibility.responsibilityId;
    manifest.responsibilityAutomationId = responsibility.automationId;
    await writeJsonAtomic(manifestPath, manifest);

    const automation = ensureObject(
      connection.call("automation.create", {
        name: "Run demo shell command",
        cron: "0 0 1 1 *",
        workspaceId: worktree.workspaceId,
        harness: "pi",
        model: DEMO_MODEL,
        provider: DEMO_PROVIDER,
        prompt: "Run the shell command `make hello` and report its output.",
        enabled: true,
        graceMinutes: 15,
      }),
      "automation.create",
    );
    if (typeof automation.id !== "string" || !automation.id) {
      throw new Error("automation.create did not return an id.");
    }
    manifest.automationId = automation.id;
    await writeJsonAtomic(manifestPath, manifest);

    manifest.validation = await checkRecipe(rootPath, runtimePath);
    let runtimeInstallation = null;
    if (manifest.validation.status === "passed") {
      runtimeInstallation = await installRuntime(
        connection,
        runtimePath,
        manifest,
        manifestPath,
      );
    }
    await writeJsonAtomic(manifestPath, manifest);
    return {
      status: "prepared",
      root: rootPath,
      dataDir: connection.dataDir,
      hostId: manifest.hostId,
      project,
      worktree,
      bot,
      responsibility,
      automation,
      recipe: {
        id: DEMO_RECIPE_ID,
        path: path.join(
          rootPath,
          ".mentu",
          "recipes",
          `${DEMO_RECIPE_ID}.json`,
        ),
        validation: manifest.validation,
        runtime: runtimeInstallation,
      },
      manifestPath,
    };
  } catch (error) {
    try {
      await teardownFixture({ connection, rootPath, manifestPath });
    } catch (cleanupError) {
      error.message += ` Cleanup also failed: ${cleanupError.message}`;
    }
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const connection = await resolveConnection(options);
  if (options.teardown) {
    const result = await teardownFixture({ connection });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const result = await prepareFixture({
    connection,
    runtimePath: options.runtimePath,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (path.resolve(process.argv[1] || "") === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(`demo-fixture: ${error.message}`);
    process.exitCode = 1;
  });
}
