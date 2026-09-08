import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertNoHorizontalOverflow,
  browserSnapshotShowsGuest,
  classifyTasksList,
  declaredStatusBarHeight,
  findCreatedStripTabName,
  fixtureHasBinary,
  FIXTURE_PATH,
  PARITY_COLOR_SCHEMES,
  PARITY_VIEWPORT_WIDTHS,
  folderViewSettled,
  paletteOpenChord,
  registryLiveness,
  summarizeAutomationHistory,
} from "./probe-packaged-surfaces.mjs";
import { extractTerminalText } from "./acceptance-terminal-text.mjs";

describe("responsive parity matrix", () => {
  it("covers every requested width and color scheme", () => {
    assert.deepEqual(PARITY_VIEWPORT_WIDTHS, [1440, 1100, 900, 760]);
    assert.deepEqual(PARITY_COLOR_SCHEMES, ["light", "dark"]);
  });
});

describe("paletteOpenChord", () => {
  const entry = (darwin) =>
    `{\n    id: "worktree.palette",\n    defaultBindings: {\n      darwin: [${darwin}],\n    },\n  },`;

  it("reads the current Mod+J darwin registration", () => {
    const chord = paletteOpenChord(entry('"Mod+J"'));
    assert.equal(chord.chord, "Mod+J");
    assert.equal(chord.key, "j");
    assert.equal(chord.shift, false);
  });

  it("follows the registry without a code change", () => {
    const chord = paletteOpenChord(entry('"Mod+Shift+J", "Mod+J"'));
    assert.equal(chord.key, "j");
    assert.equal(chord.shift, true);
  });

  it("fails closed when the registration disappears", () => {
    assert.throws(() => paletteOpenChord("export const X = [];"));
  });
});

describe("declaredStatusBarHeight", () => {
  it("parses the min-h arbitrary value", () => {
    assert.equal(
      declaredStatusBarHeight(
        'className="flex items-center h-6 min-h-[24px] px-3 gap-4"',
      ),
      24,
    );
  });

  it("fails closed without a px declaration", () => {
    assert.throws(() => declaredStatusBarHeight('className="flex h-6"'));
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

describe("extractTerminalText", () => {
  const terminal = (rows) => ({
    buffer: {
      active: {
        length: rows.length,
        getLine: (row) => ({
          translateToString: () => rows[row],
        }),
      },
    },
  });

  it("joins every buffer row across terminals", () => {
    assert.equal(
      extractTerminalText([terminal(["a", "b"]), terminal(["c"])]),
      "a\nb\nc",
    );
  });

  it("tolerates sparse registries and null rows", () => {
    assert.equal(
      extractTerminalText([
        null,
        { buffer: null },
        {
          buffer: {
            active: {
              length: 2,
              getLine: (row) => (row === 0 ? null : { translateToString: () => "x" }),
            },
          },
        },
      ]),
      "\nx",
    );
  });

  it("is empty without terminals", () => {
    assert.equal(extractTerminalText([]), "");
    assert.equal(extractTerminalText(null), "");
  });
});

describe("summarizeAutomationHistory", () => {
  it("counts one manual run after run-once", () => {
    assert.deepEqual(
      summarizeAutomationHistory({
        runs: [{ id: "r1", trigger: "manual", status: "completed" }],
      }),
      { total: 1, manual: 1, scheduled: 0, statuses: ["completed"] },
    );
  });

  it("separates scheduled from manual runs", () => {
    const summary = summarizeAutomationHistory({
      runs: [
        { trigger: "scheduled", status: "completed" },
        { trigger: "manual", status: "dispatch_failed" },
      ],
    });
    assert.equal(summary.total, 2);
    assert.equal(summary.manual, 1);
    assert.equal(summary.scheduled, 1);
  });

  it("is empty without runs", () => {
    assert.deepEqual(summarizeAutomationHistory({ runs: [] }), {
      total: 0,
      manual: 0,
      scheduled: 0,
      statuses: [],
    });
  });
});

describe("assertNoHorizontalOverflow", () => {
  it("accepts an exact fit", () => {
    assertNoHorizontalOverflow({ clientWidth: 760, scrollWidth: 760 }, "strip");
  });

  it("fails closed on overflow", () => {
    assert.throws(() =>
      assertNoHorizontalOverflow(
        { clientWidth: 760, scrollWidth: 900 },
        "status-bar@760px",
      ),
    );
  });
});

describe("browserSnapshotShowsGuest", () => {
  it("finds the guest marker in the envelope", () => {
    assert.equal(
      browserSnapshotShowsGuest(
        { url: "data:text/html", text: "hello DROGON_BROWSER_GUEST_1" },
        "DROGON_BROWSER_GUEST_1",
      ),
      true,
    );
  });

  it("rejects a snapshot without the marker", () => {
    assert.equal(
      browserSnapshotShowsGuest({ text: "blank page" }, "DROGON_BROWSER_GUEST_1"),
      false,
    );
  });
});

describe("registryLiveness", () => {
  it("names live buffers", () => {
    assert.equal(registryLiveness(2, 120), "live-buffers");
  });

  it("names a rowless registry distinctly", () => {
    assert.equal(registryLiveness(1, 0), "registry-without-rows");
  });

  it("names an empty registry", () => {
    assert.equal(registryLiveness(0, 0), "empty");
  });
});

describe("findCreatedStripTabName", () => {
  it("returns the added tab by name, wherever it sits", () => {
    assert.equal(
      findCreatedStripTabName(
        ["sidebar-explorer.txt"],
        ["Terminal 1 live", "sidebar-explorer.txt"],
      ),
      "Terminal 1 live",
    );
  });

  it("returns null when nothing was added", () => {
    assert.equal(
      findCreatedStripTabName(["a", "b"], ["a", "b"]),
      null,
    );
  });

  it("ignores removed tabs and reports the addition", () => {
    assert.equal(
      findCreatedStripTabName(["old", "kept"], ["kept", "new"]),
      "new",
    );
  });
});

describe("folderViewSettled", () => {
  it("settles on the empty-state heading with no tabs", () => {
    assert.equal(
      folderViewSettled({ headings: ["Start a session"], tabCount: 0, headerNames: [], workspaceName: "folder" }),
      true,
    );
  });

  it("settles on restored tabs under the workspace header", () => {
    assert.equal(
      folderViewSettled({ headings: [], tabCount: 2, headerNames: ["folder"], workspaceName: "folder" }),
      true,
    );
  });

  it("does not settle on another workspace's tabs", () => {
    assert.equal(
      folderViewSettled({ headings: [], tabCount: 2, headerNames: ["changes-wt"], workspaceName: "folder" }),
      false,
    );
  });

  it("does not settle on tabs without the header", () => {
    assert.equal(
      folderViewSettled({ headings: [], tabCount: 1, headerNames: [], workspaceName: "folder" }),
      false,
    );
  });
});
