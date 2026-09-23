// Unit companion for scripts/accept-sidebar-pr-states.mjs: covers the pure
// projections, wire-contract builders and fixture-source shape the
// acceptance run asserts through, so a silent change to either side breaks
// loudly. Never launches a daemon, an Electron app or a PTY.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCEPTANCE_RUST_BUILD,
  CHECK_NAMES,
  PR_JSON_FIELDS,
  PR_MARKER_TONES,
  buildFixtureGhSource,
  buildPrFixtureRow,
  markerHasTone,
  parseGhArgv,
  pendingCheckEntry,
  projectBinaryIdentity,
  projectGhRowFields,
  projectPrMarker,
  quoteShellWord,
  slugDataFile,
  successCheckEntry,
} from "./accept-sidebar-pr-states.mjs";

describe("accept-sidebar-pr-states check names", () => {
  it("names the acceptance checks in order", () => {
    assert.deepEqual(CHECK_NAMES, [
      "fixture-git-projects-registered-with-github-remotes",
      "merged-review-renders-green-with-check",
      "confirmed-ready-renders-cyan",
      "draft-renders-neutral",
      "conflicts-render-red",
      "review-required-pending-unknown-stay-neutral",
      "changed-status-refetches-on-a-stable-project-set",
      "provider-error-renders-unavailable-never-empty",
      "page-walk-finds-the-live-review-past-the-first-window",
      "linked-fallback-and-pr-grouping-agree",
      "os-activation-and-window-visibility-preserved",
    ]);
  });
});

describe("acceptance rust build", () => {
  it("builds the daemon and CLI under test, locked", () => {
    assert.equal(ACCEPTANCE_RUST_BUILD.command, "cargo");
    assert.ok(ACCEPTANCE_RUST_BUILD.args.includes("-p"));
    assert.ok(ACCEPTANCE_RUST_BUILD.args.includes("drogond"));
    assert.ok(ACCEPTANCE_RUST_BUILD.args.includes("drogon-cli"));
    assert.ok(ACCEPTANCE_RUST_BUILD.args.includes("--locked"));
  });
});

describe("gh wire contract", () => {
  it("requests the fields the state marker reads", () => {
    const fields = PR_JSON_FIELDS.split(",");
    for (const field of [
      "number",
      "title",
      "state",
      "reviewDecision",
      "statusCheckRollup",
      "mergeable",
      "isDraft",
      "headRefName",
    ]) {
      assert.ok(fields.includes(field), `PR_JSON_FIELDS names ${field}`);
    }
  });

  it("builds gh-shaped rows with sane defaults", () => {
    const row = buildPrFixtureRow({ number: 12, headRefName: "feat-ready" });
    assert.equal(row.state, "OPEN");
    assert.equal(row.isDraft, false);
    assert.equal(row.mergeable, "UNKNOWN");
    assert.equal(row.headRefName, "feat-ready");
    assert.deepEqual(successCheckEntry(), { conclusion: "SUCCESS", status: "COMPLETED", name: "ci" });
    assert.equal(pendingCheckEntry().status, "IN_PROGRESS");
  });

  it("projects exactly the requested fields, like real gh", () => {
    const row = buildPrFixtureRow({ number: 7, state: "MERGED", reviewDecision: null });
    assert.deepEqual(projectGhRowFields(row, ["number", "state"]), { number: 7, state: "MERGED" });
    // A null reviewDecision is omitted (gh emits no verdict), never defaulted.
    assert.ok(!("reviewDecision" in projectGhRowFields(row, ["number", "reviewDecision"])));
    assert.deepEqual(
      projectGhRowFields(buildPrFixtureRow({ reviewDecision: "APPROVED" }), ["reviewDecision"]),
      { reviewDecision: "APPROVED" },
    );
    // Unknown fields never leak through.
    assert.deepEqual(projectGhRowFields(row, ["number", "bogus"]), { number: 7 });
  });
});

describe("parseGhArgv", () => {
  it("parses pr list windows", () => {
    assert.deepEqual(
      parseGhArgv(["pr", "list", "--repo", "fixture/prpages", "--state", "all", "--limit", "101", "--json", "number,state"]),
      {
        command: "pr-list",
        repo: "fixture/prpages",
        state: "all",
        limit: 101,
        fields: ["number", "state"],
      },
    );
  });

  it("parses pr view lookups", () => {
    assert.deepEqual(
      parseGhArgv(["pr", "view", "77", "--repo", "fixture/prlinked", "--json", "number"]),
      { command: "pr-view", number: 77, repo: "fixture/prlinked", fields: ["number"] },
    );
  });

  it("rejects non-pr shapes", () => {
    assert.equal(parseGhArgv(["api", "user"]), null);
    assert.equal(parseGhArgv(["issue", "list"]), null);
    assert.equal(parseGhArgv("not-an-array"), null);
  });
});

describe("projectPrMarker", () => {
  it("projects the DOM reading with a tokenized tone", () => {
    const marker = projectPrMarker({
      cardId: "wt-1",
      state: "merged",
      label: "Linked PR #11: Merged",
      title: "Landed feature",
      toneClass: "relative inline-flex size-3.5 shrink-0 items-center justify-center text-emerald-500",
      hasCheck: true,
    });
    assert.equal(marker.cardId, "wt-1");
    assert.equal(marker.state, "merged");
    assert.ok(marker.tone.includes("text-emerald-500"));
    assert.equal(marker.hasCheck, true);
  });

  it("a missing marker projects to nulls, never a placeholder state", () => {
    const marker = projectPrMarker({
      cardId: "wt-quiet",
      state: null,
      label: null,
      title: null,
      toneClass: null,
      hasCheck: false,
    });
    assert.equal(marker.state, null);
    assert.deepEqual(marker.tone, []);
  });
});

describe("marker tones", () => {
  it("names the owner-designed tone for every rendered state", () => {
    assert.deepEqual(PR_MARKER_TONES, {
      merged: "text-emerald-500",
      ready: "text-cyan-500",
      open: "text-blue-500",
      draft: "text-muted-foreground/70",
      conflicts: "text-rose-500",
      closed: "text-muted-foreground/70",
    });
  });

  it("matches tones by whole class token, so grey never reads as open", () => {
    assert.equal(markerHasTone({ tone: ["text-muted-foreground/70"] }, "draft"), true);
    assert.equal(markerHasTone({ tone: ["text-muted-foreground/70"] }, "open"), false);
    assert.equal(markerHasTone({ tone: ["text-muted-foreground"] }, "open"), false);
    assert.equal(markerHasTone({ tone: ["text-blue-500", "dark:text-blue-400"] }, "open"), true);
  });
});

describe("fixture gh source", () => {
  const source = buildFixtureGhSource({ helperPath: "/tmp/helper.mjs", dataDir: "/tmp/gh-data" });

  it("is a node script honoring state, limit and json projection", () => {
    assert.match(source, /^#!\/usr\/bin\/env node/);
    assert.match(source, /--state/);
    assert.match(source, /--limit/);
    assert.match(source, /--json/);
    assert.match(source, /projectGhRowFields/);
  });

  it("answers pr view by number and fails unknown rows like gh", () => {
    assert.match(source, /argv\[1\] === "view"/);
    assert.match(source, /could not resolve to an Issue/);
  });

  it("supports the forced provider-error mode and records argv provenance", () => {
    assert.match(source, /forced provider error/);
    assert.match(source, /argv\.log/);
  });
});

describe("small helpers", () => {
  it("quotes shell words with single quotes", () => {
    assert.equal(quoteShellWord("/tmp/dg-prstates-abc/gh"), "'/tmp/dg-prstates-abc/gh'");
    assert.equal(quoteShellWord("a'b"), "'a'\\''b'");
  });

  it("maps slugs to safe data-file names", () => {
    assert.equal(slugDataFile("fixture/prstates"), "fixture__prstates.json");
  });

  it("projects binary identity with mtime and size", () => {
    assert.deepEqual(projectBinaryIdentity("/tmp/drogond", { mtimeMs: 5, size: 7 }), {
      path: "/tmp/drogond",
      mtimeMs: 5,
      size: 7,
    });
  });
});
