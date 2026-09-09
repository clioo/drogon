import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classifyGhArgv,
  fixtureGhScript,
  fixtureIssueJson,
  mentuStepsAll,
  PI_MODEL,
  PI_MODEL_ID,
  PI_PROVIDER,
  SEALED_MODEL_FIXTURE_BASE_URL_ENV,
  seedLocalPiProvider,
  waitForFixtureReady,
} from "./probe-sealed-journeys.mjs";
import { FAR_FUTURE_CRON } from "./probe-packaged-surfaces.mjs";
import { FIXTURE_IDENTITY, startSealedModelFixture } from "./sealed-model-fixture.mjs";

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
  it("uses fixture-only identities, never aliases a configured real provider", () => {
    assert.equal(PI_PROVIDER, "drogon-sealed-fixture");
    assert.equal(PI_MODEL_ID, "acceptance-only");
    assert.equal(PI_MODEL, "drogon-sealed-fixture/acceptance-only");
    assert.equal(FAR_FUTURE_CRON, "0 0 1 1 *");
  });
});

/** Saves/restores the shared env var around a test so no test leaks its
 *  seeded baseUrl into a sibling test's default reads. */
async function withCleanFixtureEnv(run) {
  const saved = process.env[SEALED_MODEL_FIXTURE_BASE_URL_ENV];
  delete process.env[SEALED_MODEL_FIXTURE_BASE_URL_ENV];
  try {
    await run();
  } finally {
    if (saved === undefined) delete process.env[SEALED_MODEL_FIXTURE_BASE_URL_ENV];
    else process.env[SEALED_MODEL_FIXTURE_BASE_URL_ENV] = saved;
  }
}

describe("seedLocalPiProvider (no real network endpoint, ever)", () => {
  it("throws with no explicit baseUrl and no env set -- there is no default", () =>
    withCleanFixtureEnv(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "sealed-fixture-seed-"));
      try {
        await assert.rejects(seedLocalPiProvider(dir), /requires an explicit loopback baseUrl/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }));

  it("throws for a non-loopback baseUrl even when explicitly passed -- rejects a real-network default", () =>
    withCleanFixtureEnv(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "sealed-fixture-seed-"));
      try {
        await assert.rejects(
          seedLocalPiProvider(dir, "http://100.85.64.21:9292/v1"),
          /non-loopback/,
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }));

  it("writes the given loopback baseUrl into models.json AND sets the shared env consistently -- an argument-only seed can never leave a later argument-less wait reading a stale/unset endpoint", () =>
    withCleanFixtureEnv(async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "sealed-fixture-seed-"));
      try {
        await seedLocalPiProvider(dir, "http://127.0.0.1:54329/v1");
        const written = JSON.parse(
          await readFile(path.join(dir, "models.json"), "utf8"),
        );
        assert.equal(
          written.providers[PI_PROVIDER].baseUrl,
          "http://127.0.0.1:54329/v1",
        );
        assert.equal(written.providers[PI_PROVIDER].models[0].id, PI_MODEL_ID);
        // The whole point of the correction: seeding via the argument form
        // still leaves the env consistent for any later argument-less
        // reader (waitForFixtureReady, or a second seed call) in this
        // same process.
        assert.equal(
          process.env[SEALED_MODEL_FIXTURE_BASE_URL_ENV],
          "http://127.0.0.1:54329/v1",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }));
});

describe("waitForFixtureReady (fail-closed identity + redirect refusal)", () => {
  it("returns false quickly with nothing listening at the given baseUrl", async () => {
    const startedAt = Date.now();
    const ready = await waitForFixtureReady(500, "http://127.0.0.1:1");
    assert.equal(ready, false);
    assert.ok(Date.now() - startedAt < 5000, "must stay bounded, never hang");
  });

  it("accepts the real sealed fixture's own identity, with and without an env fallback", () =>
    withCleanFixtureEnv(async () => {
      const fixture = await startSealedModelFixture();
      try {
        assert.equal(await waitForFixtureReady(5000, fixture.baseUrl), false);
        assert.equal(
          await waitForFixtureReady(5000, fixture.baseUrl, fixture.instanceId),
          true,
        );
        // The env-fallback path used by the two real probe call sites.
        process.env[SEALED_MODEL_FIXTURE_BASE_URL_ENV] = fixture.baseUrl;
        process.env.DROGON_SEALED_MODEL_FIXTURE_INSTANCE_ID = fixture.instanceId;
        assert.equal(await waitForFixtureReady(5000), true);
      } finally {
        delete process.env.DROGON_SEALED_MODEL_FIXTURE_INSTANCE_ID;
        await fixture.close();
      }
    }));

  it("refuses a real HTTP server that answers ok but is not the owned fixture identity", async () => {
    const foreign = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ fixture: "some-other-thing/1", ok: true }));
    });
    await new Promise((resolve, reject) => {
      foreign.once("error", reject);
      foreign.listen(0, "127.0.0.1", resolve);
    });
    try {
      const baseUrl = `http://127.0.0.1:${foreign.address().port}/v1`;
      assert.equal(await waitForFixtureReady(500, baseUrl), false);
    } finally {
      await new Promise((resolve) => foreign.close(resolve));
    }
  });

  it("refuses a real HTTP server that redirects the health check to a different origin, instead of silently following it", async () => {
    const other = createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ fixture: FIXTURE_IDENTITY, ok: true }));
    });
    await new Promise((resolve, reject) => {
      other.once("error", reject);
      other.listen(0, "127.0.0.1", resolve);
    });
    const otherPort = other.address().port;
    const redirecting = createServer((req, res) => {
      res.writeHead(302, { Location: `http://127.0.0.1:${otherPort}/__fixture__/health` });
      res.end();
    });
    await new Promise((resolve, reject) => {
      redirecting.once("error", reject);
      redirecting.listen(0, "127.0.0.1", resolve);
    });
    try {
      const baseUrl = `http://127.0.0.1:${redirecting.address().port}/v1`;
      // Even though the redirect target IS a real, correctly-identified
      // fixture, following it must never happen -- the health check has
      // to refuse the redirect itself, not merely reject a bad target.
      assert.equal(await waitForFixtureReady(500, baseUrl), false);
    } finally {
      await new Promise((resolve) => redirecting.close(resolve));
      await new Promise((resolve) => other.close(resolve));
    }
  });
});
