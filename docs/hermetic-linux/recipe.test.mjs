// Static contract for the hermetic Linux recipe: the Dockerfile must stay on
// the documented toolchain floors and run exactly the portable gates, and it
// must keep saying what a green container does NOT prove. A real container
// run needs a Docker daemon; this test keeps the recipe from drifting.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const dir = fileURLToPath(new URL(".", import.meta.url));
const dockerfile = readFileSync(dir + "Dockerfile", "utf8");
const wrapper = readFileSync(dir + "run-check.sh", "utf8");

test("Dockerfile pins the documented toolchains", () => {
  assert.match(dockerfile, /ARG NODE_IMAGE=node:24/);
  assert.match(dockerfile, /ARG RUST_VERSION=1\.98/);
  assert.match(dockerfile, /default-toolchain "\$RUST_VERSION"/);
  assert.match(dockerfile, /npm install -g "\$\(node -p 'require\("\.\/package\.json"\)\.packageManager'\)"/);
});

test("Dockerfile runs the portable gates and nothing graphical", () => {
  for (const gate of [
    "pnpm install --frozen-lockfile",
    "pnpm typecheck",
    "cargo check --workspace --locked",
    "node scripts/check-repo-hygiene.mjs",
    "node scripts/e2e-fresh-clone.mjs",
  ]) {
    assert.ok(dockerfile.includes(gate), `missing gate: ${gate}`);
  }
  const runLines = dockerfile.split("\n").filter((line) => line.startsWith("RUN "));
  assert.ok(!runLines.some((line) => /electron/i.test(line)), "no Electron in the container build");
  assert.ok(
    !runLines.some((line) => /accept-desktop|package-desktop/.test(line)),
    "no macOS packaging in the container build",
  );
});

test("Dockerfile states what a green container does not prove", () => {
  for (const word of ["Gatekeeper", "Electron", ".app", "accept-desktop.mjs"]) {
    assert.ok(dockerfile.includes(word), `missing limit: ${word}`);
  }
});

test("wrapper builds the recipe dir and fails fast without a daemon", () => {
  assert.match(wrapper, /docker build --pull/);
  assert.match(wrapper, /docker info/);
  assert.match(wrapper, /Docker daemon is unreachable/);
  assert.ok(wrapper.includes("--repo") && wrapper.includes("--ref"), "repo/ref overrides");
});
