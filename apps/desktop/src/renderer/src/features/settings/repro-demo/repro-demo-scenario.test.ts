// The in-app demo seeds its workspace from constants because a packaged app
// cannot read this repository's `scripts/scenarios` tree. That makes drift
// possible, so this test is the fence: the embedded scenario must be byte-for
// byte what `make repro` runs, or one of the two demos is lying about what it
// builds.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  REPRO_SCENARIO_BRIEF,
  REPRO_SCENARIO_SEED,
  REPRO_SCENARIO_SPEC,
  REPRO_SCENARIO_SPEC_PATH,
} from "./repro-demo-scenario";

const repoRoot = fileURLToPath(new URL("../../../../../../../../", import.meta.url));
const scenario = path.join(repoRoot, "scripts/scenarios/dog-tinder");

function onDisk(relative: string): string {
  return readFileSync(path.join(scenario, relative), "utf8");
}

describe("the embedded Dog Tinder scenario", () => {
  test("seeds exactly the files the CLI demo seeds", () => {
    expect(REPRO_SCENARIO_SEED.map((file) => file.path)).toEqual([
      "package.json",
      "fixtures/dogs.json",
      "tests/deck.test.mjs",
    ]);
    for (const file of REPRO_SCENARIO_SEED) {
      expect(file.content, file.path).toBe(onDisk(path.join("seed", file.path)));
    }
  });

  test("carries the same spec and brief as the CLI demo", () => {
    expect(REPRO_SCENARIO_SPEC).toBe(onDisk("spec.md"));
    expect(REPRO_SCENARIO_BRIEF).toBe(onDisk("brief.md"));
  });

  test("watches the spec path the scenario's own README names", () => {
    expect(REPRO_SCENARIO_SPEC_PATH).toBe("specs/dog-tinder.md");
    expect(onDisk("seed/specs/README.md")).toContain("dog-tinder.md");
  });

  test("the spec asks for the undo the tests contract on", () => {
    expect(REPRO_SCENARIO_SPEC).toMatch(/Undo of the last swipe/);
    const contract = REPRO_SCENARIO_SEED.find(
      (file) => file.path === "tests/deck.test.mjs",
    );
    expect(contract?.content).toMatch(/Nothing to undo/);
  });
});
