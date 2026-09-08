import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyGhArgv,
  fixtureGhScript,
  fixtureIssueJson,
  mentuStepsAll,
  PI_MODEL,
  PI_MODEL_ID,
  PI_PROVIDER,
} from "./probe-sealed-journeys.mjs";
import { FAR_FUTURE_CRON } from "./probe-packaged-surfaces.mjs";

describe("classifyGhArgv", () => {
  it("recognizes the daemon's three gh call shapes", () => {
    assert.equal(
      classifyGhArgv([
        "issue",
        "list",
        "--repo",
        "o/r",
        "--state",
        "open",
        "--limit",
        "11",
        "--json",
        "number,title",
      ]),
      "issue-list",
    );
    assert.equal(
      classifyGhArgv(["issue", "view", "1", "--repo", "o/r", "--json", "number"]),
      "issue-view",
    );
    assert.equal(classifyGhArgv(["api", "user", "--json", "login"]), "api-user");
    assert.equal(classifyGhArgv(["pr", "list"]), "other");
  });
});

describe("fixtureIssueJson", () => {
  it("matches the daemon's GhIssue deserialization shape", () => {
    const issue = fixtureIssueJson(1, "Acceptance issue one");
    assert.equal(issue.number, 1);
    assert.equal(issue.title, "Acceptance issue one");
    assert.equal(issue.state, "OPEN");
    assert.deepEqual(issue.labels, []);
    assert.deepEqual(issue.assignees, []);
    assert.equal(issue.author.login, "drogon-acceptance");
    assert.equal(typeof issue.updatedAt, "string");
    assert.match(issue.url, /\/issues\/1$/);
  });

  it("merges extras like the issue-view body", () => {
    const issue = fixtureIssueJson(2, "Two", { body: "Fixture body." });
    assert.equal(issue.body, "Fixture body.");
  });
});

describe("fixtureGhScript", () => {
  const issues = [
    { number: 1, title: "Acceptance issue one" },
    { number: 2, title: "Acceptance issue two" },
  ];
  const script = fixtureGhScript({ issues });

  it("emits a self-contained POSIX sh script", () => {
    assert.match(script, /^#!\/bin\/sh\n/);
    // No node/python dependency: the daemon's packaged PATH has neither.
    assert.doesNotMatch(script, /\bnode\b|\bpython\b/);
    assert.match(script, /exit 2/);
  });

  it("honors --limit 1 so the fetch-one-extra probe stays truthful", () => {
    const line = script
      .split("\n")
      .find((entry) => entry.includes("1) printf"));
    assert.ok(line, "the limit=1 branch must exist");
    const payload = line.slice(line.indexOf("'[") + 1, line.lastIndexOf("'"));
    const parsed = JSON.parse(payload);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].number, 1);
  });

  it("serves the full list for wide limits and view per issue", () => {
    assert.match(script, /"issue list"/);
    assert.match(script, /"issue view 1 "/);
    assert.match(script, /"issue view 2 "/);
    assert.match(script, /^  "api user"\)$/m);
  });

  it("generates parseable JSON payloads", () => {
    const listPayload = fixtureIssueJson(1, "Acceptance issue one");
    assert.doesNotThrow(() => JSON.parse(JSON.stringify([listPayload])));
  });
});

describe("mentuStepsAll", () => {
  it("requires a non-empty list of uniformly-expected steps", () => {
    assert.equal(mentuStepsAll([], "succeeded"), false);
    assert.equal(
      mentuStepsAll([{ status: "succeeded" }, { status: "succeeded" }], "succeeded"),
      true,
    );
    assert.equal(
      mentuStepsAll([{ status: "succeeded" }, { status: "failed" }], "succeeded"),
      false,
    );
  });
});

describe("model constants", () => {
  it("pins the free local model route", () => {
    assert.equal(PI_PROVIDER, "dgx-spark");
    assert.equal(PI_MODEL_ID, "qwen3.8-flash-next-nvidia-nvfp4");
    assert.equal(PI_MODEL, "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4");
    assert.equal(FAR_FUTURE_CRON, "0 0 1 1 *");
  });
});
