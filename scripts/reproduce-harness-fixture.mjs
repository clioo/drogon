// The harness catalog `make repro` offers, and the executable shims that let a
// chosen harness take part without any inference.
//
// Each shim is a two-line `sh` script that hands the real argv to
// `reproduce-harness-agent.mjs`, so what stands in for the model stays a
// readable file in this repository instead of a string baked into a fixture.

import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT = fileURLToPath(new URL("./reproduce-harness-agent.mjs", import.meta.url));

/** Every harness in Drogon's catalog, with what it can actually do in a Work
 *  Graph node. `graphCapable: false` is not a snub: the compiler refuses to
 *  emit a recipe it knows the pinned runtime cannot run, and the picker shows
 *  that reason instead of hiding the harness. */
export const HARNESS_CATALOG = [
  {
    id: "claude",
    exe: "claude",
    model: "fixture-dog-tinder",
    adapter: "mentu-recipes claude adapter",
    graphCapable: true,
  },
  {
    id: "codex",
    exe: "codex",
    model: "fixture-dog-tinder",
    adapter: "mentu-recipes codex adapter",
    graphCapable: true,
  },
  {
    id: "opencode",
    exe: "opencode",
    model: "fixture/dog-tinder",
    adapter: "shell adapter (opencode run)",
    graphCapable: true,
  },
  {
    id: "pi",
    exe: "pi",
    model: "fixture/dog-tinder",
    adapter: "shell adapter (pi --print)",
    graphCapable: true,
  },
  {
    id: "antigravity",
    exe: "agy",
    model: "",
    adapter: "no adapter in mentu-recipes 0.5.0 — the compiler refuses the node",
    graphCapable: false,
  },
];

export function harnessById(id) {
  return HARNESS_CATALOG.find((entry) => entry.id === id) ?? null;
}

/** Writes one shim per harness id into `bin`, and returns the paths written. */
export async function writeHarnessFixtures(bin, ids) {
  await mkdir(bin, { recursive: true });
  const written = [];
  for (const id of ids) {
    const harness = harnessById(id);
    if (!harness) throw new Error(`Unknown harness id: ${id}`);
    const file = path.join(bin, harness.exe);
    await writeFile(
      file,
      `#!/bin/sh\n# Drogon reproducible run fixture for '${harness.id}'. No inference.\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT)} --harness ${harness.id} -- "$@"\n`,
    );
    await chmod(file, 0o755);
    written.push(file);
  }
  return written;
}
