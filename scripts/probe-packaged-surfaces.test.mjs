import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyTasksList,
  declaredStatusBarHeight,
  fixtureHasBinary,
  FIXTURE_PATH,
  paletteOpenChord,
} from "./probe-packaged-surfaces.mjs";

describe("paletteOpenChord", () => {
  it("reads the current CmdOrCtrl+K registration", () => {
    const chord = paletteOpenChord(
      'export const X = [\n  { id: "palette.openCommands", chord: "CmdOrCtrl+K" },\n];',
    );
    assert.equal(chord.chord, "CmdOrCtrl+K");
    assert.equal(chord.key, "k");
    assert.equal(chord.shift, false);
  });

  it("follows the registry to CmdOrCtrl+J without a code change", () => {
    const chord = paletteOpenChord(
      'export const X = [\n  { id: "palette.openCommands", chord: "CmdOrCtrl+J" },\n];',
    );
    assert.equal(chord.key, "j");
  });

  it("fails closed when the registration disappears", () => {
    assert.throws(() => paletteOpenChord("export const X = [];"));
  });
});

describe("declaredStatusBarHeight", () => {
  it("parses the .status-bar rule", () => {
    assert.equal(
      declaredStatusBarHeight(".status-bar {\n  height: 26px;\n}"),
      26,
    );
  });

  it("fails closed without a px declaration", () => {
    assert.throws(() => declaredStatusBarHeight(".other { height: 1px; }"));
  });
});

describe("fixtureHasBinary", () => {
  const fakeFs = (files) => ({
    stat: async (file) => {
      if (files.includes(file)) return { isFile: () => true };
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
  });

  it("finds git in the fixture PATH", async () => {
    assert.equal(
      await fixtureHasBinary(fakeFs(["/usr/bin/git"]), FIXTURE_PATH, "git"),
      true,
    );
  });

  it("reports gh missing from the fixture PATH", async () => {
    assert.equal(
      await fixtureHasBinary(fakeFs([]), FIXTURE_PATH, "gh"),
      false,
    );
  });
});

describe("classifyTasksList", () => {
  it("names the gh-unavailable state", () => {
    assert.equal(
      classifyTasksList("gh executable could not be spawned: install gh", false),
      "gh-unavailable",
    );
  });

  it("names the gh-unauthenticated state", () => {
    assert.equal(
      classifyTasksList("gh is not authenticated: run `gh auth login`", false),
      "gh-unauthenticated",
    );
  });

  it("accepts a rendered issue list", () => {
    assert.equal(classifyTasksList("anything", true), "issues-listed");
  });

  it("rejects an unrecognized panel as unexpected", () => {
    assert.ok(
      classifyTasksList("some brand new panel copy", false).startsWith(
        "unexpected:",
      ),
    );
  });
});
