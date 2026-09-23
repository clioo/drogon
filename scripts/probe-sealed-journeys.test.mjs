import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  probePiAgentStateWorkingIdle,
  readRenderedAgentLabels,
  SEALED_MODEL_FIXTURE_BASE_URL_ENV,
  seedLocalPiProvider,
  selectWorkspaceCardById,
  waitForFixtureReady,
  waitForPrePromptBaselineUnknown,
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
        await writeFile(path.join(dir, "settings.json"), JSON.stringify({ theme: "light", defaultProvider: "previous-provider" }));
        await seedLocalPiProvider(dir, "http://127.0.0.1:54329/v1");
        const settings = JSON.parse(await readFile(path.join(dir, "settings.json"), "utf8"));
        assert.equal(settings.defaultProvider, PI_PROVIDER);
        assert.equal(settings.defaultModel, PI_MODEL_ID);
        assert.equal(settings.theme, "light");
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

describe("selectWorkspaceCardById", () => {
  // Minimal page double: evaluate runs the real page-side callback against
  // a stubbed window.drogon, the click records the exact accessible name,
  // and waitForFunction runs the real selection predicate against a stubbed
  // document that reports aria-current only for the clicked card.
  function stubPage(workspaces) {
    const calls = [];
    let clicked = null;
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    globalThis.window = {
      drogon: {
        workspaces: async () => ({ ok: true, result: { workspaces } }),
      },
    };
    globalThis.document = {
      querySelector: (selector) => {
        const match = /aria-label="([^"]+)"/.exec(selector);
        if (!match) return null;
        return {
          getAttribute: (name) =>
            name === "aria-current" && clicked === match[1] ? "page" : null,
        };
      },
    };
    const page = {
      calls,
      evaluate: (fn, arg) => fn(arg),
      getByRole: (role, { name } = {}) => ({
        click: async () => {
          calls.push(["click", role, name]);
          clicked = name;
        },
      }),
      waitForFunction: async (fn, label) => {
        calls.push(["wait", label]);
        assert.equal(fn(label), true, "selection must be proven via aria-current");
      },
    };
    return { page, restore: () => {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    } };
  }

  it("clicks the card matching the addressed id and proves the selection", async () => {
    const { page, restore } = stubPage([
      { id: "implicit-id", name: "folder" },
      { id: "registered-id", name: "mussel" },
    ]);
    try {
      await selectWorkspaceCardById(page, "registered-id");
      assert.deepEqual(page.calls, [
        ["click", "button", "Select mussel"],
        ["wait", "Select mussel"],
      ]);
    } finally {
      restore();
    }
  });

  it("resolves by id rather than position when the target is not first", async () => {
    const { page, restore } = stubPage([
      { id: "registered-id", name: "mussel" },
      { id: "implicit-id", name: "folder" },
    ]);
    try {
      await selectWorkspaceCardById(page, "implicit-id");
      assert.deepEqual(page.calls, [
        ["click", "button", "Select folder"],
        ["wait", "Select folder"],
      ]);
    } finally {
      restore();
    }
  });

  it("fails closed for an unregistered id without clicking anything", async () => {
    const { page, restore } = stubPage([{ id: "only-id", name: "folder" }]);
    try {
      await assert.rejects(
        () => selectWorkspaceCardById(page, "missing-id"),
        /workspace missing-id is not registered/,
      );
      assert.deepEqual(page.calls, []);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// R3 Pi pre-prompt baseline: hook proof, not PTY silence.
//
// These tests execute the actual probe path -- the real helper functions
// against stub page doubles that run the real page-side predicates -- never
// source-string matches. Before its first prompt, both surfaces agree on
// Unknown or on hook-confirmed Idle from Pi builds that emit a startup
// lifecycle event. Hook-confirmed Working/Waiting is never a valid baseline.
// ---------------------------------------------------------------------------

const BASELINE_SESSION = "pi-baseline-session";
const BASELINE_WORKSPACE = "workspace-baseline";

/** Runs the real page-side predicate against a stub document, like the
 *  selectWorkspaceCardById stubs above: evaluate runs the callback, and a
 *  falsy waitForFunction predicate throws like a real timeout. */
function stubBaselinePage({ tabLabel, cardLabel, sessions }) {
  const calls = [];
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousCss = globalThis.CSS;
  const badge = (label) => ({
    querySelector: (selector) => {
      const match = /aria-label="([^"]+)"/.exec(selector);
      return match && match[1] === label ? {} : null;
    },
  });
  const tabElement = (label) => ({
    getAttribute: (name) => (name === "aria-label" ? `Terminal 1 ${label === "No recent update" ? "live" : label}` : null),
    querySelector: (selector) => badge(label).querySelector(selector),
  });
  const rowElement = (label) => ({
    querySelector: (selector) => badge(label).querySelector(selector),
  });
  globalThis.CSS = { escape: (value) => value };
  globalThis.window = {
    drogon: {
      sessions: async () => ({ ok: true, result: { sessions } }),
    },
  };
  globalThis.document = {
    querySelector: (selector) => {
      let match = /data-tab-id="([^"]+)"/.exec(selector);
      if (match) return match[1] === BASELINE_SESSION && tabLabel ? tabElement(tabLabel) : null;
      match = /data-worktree-agent-row="([^"]+)"/.exec(selector);
      if (match) return match[1] === BASELINE_SESSION && cardLabel ? rowElement(cardLabel) : null;
      return null;
    },
  };
  const page = {
    calls,
    evaluate: (fn, arg) => fn(arg),
    waitForFunction: async (fn, arg) => {
      const value = await fn(arg);
      calls.push(value);
      if (!value) throw new Error(`stub timeout waiting for ${JSON.stringify(arg)}`);
    },
  };
  return {
    page,
    restore: () => {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.CSS = previousCss;
    },
  };
}

function livePiRow(overrides = {}) {
  return {
    id: BASELINE_SESSION,
    incarnation: 7,
    harnessId: "pi",
    verdict: "live",
    agentState: "unknown",
    agentStateAuthority: null,
    ...overrides,
  };
}

describe("waitForPrePromptBaselineUnknown (actual probe path)", () => {
  it("proves a live pre-prompt session with no hook proof on both surfaces", async () => {
    const { page, restore } = stubBaselinePage({
      tabLabel: "No recent update",
      cardLabel: "No recent update",
      sessions: [livePiRow()],
    });
    try {
      const native = await waitForPrePromptBaselineUnknown(page, BASELINE_SESSION, BASELINE_WORKSPACE);
      assert.deepEqual(native, {
        id: BASELINE_SESSION,
        incarnation: 7,
        harnessId: "pi",
        verdict: "live",
        agentState: "unknown",
        agentStateAuthority: null,
      });
      assert.deepEqual(page.calls, ["No recent update"]);
    } finally {
      restore();
    }
  });

  it("accepts a quiet activity clock natively while rendered stays Unknown", async () => {
    // After 3s of banner silence the daemon's activity clock reads idle
    // with activity authority; without hook proof the renderer still shows
    // Unknown, so the baseline holds.
    const { page, restore } = stubBaselinePage({
      tabLabel: "No recent update",
      cardLabel: "No recent update",
      sessions: [livePiRow({ agentState: "idle", agentStateAuthority: "activity" })],
    });
    try {
      const native = await waitForPrePromptBaselineUnknown(page, BASELINE_SESSION, BASELINE_WORKSPACE);
      assert.equal(native.agentState, "idle");
      assert.equal(native.agentStateAuthority, "activity");
    } finally {
      restore();
    }
  });

  it("accepts a hook-confirmed Idle startup on both rendered surfaces", async () => {
    const { page, restore } = stubBaselinePage({
      tabLabel: "Idle",
      cardLabel: "Idle",
      sessions: [livePiRow({ agentState: "idle", agentStateAuthority: "hook" })],
    });
    try {
      const native = await waitForPrePromptBaselineUnknown(page, BASELINE_SESSION, BASELINE_WORKSPACE);
      assert.equal(native.agentState, "idle");
      assert.equal(native.agentStateAuthority, "hook");
      assert.deepEqual(page.calls, ["Idle"]);
    } finally {
      restore();
    }
  });

  it("rejects hook-confirmed Working before any prompt was sent", async () => {
    const { page, restore } = stubBaselinePage({
      tabLabel: "No recent update",
      cardLabel: "No recent update",
      sessions: [livePiRow({ agentState: "working", agentStateAuthority: "hook" })],
    });
    try {
      await assert.rejects(
        () => waitForPrePromptBaselineUnknown(page, BASELINE_SESSION, BASELINE_WORKSPACE),
        /must be Unknown or hook-confirmed Idle/,
      );
    } finally {
      restore();
    }
  });

  it("rejects mismatched pre-prompt states across the two rendered surfaces", async () => {
    const { page, restore } = stubBaselinePage({
      tabLabel: "Idle",
      cardLabel: "No recent update",
      sessions: [livePiRow()],
    });
    try {
      await assert.rejects(
        () => waitForPrePromptBaselineUnknown(page, BASELINE_SESSION, BASELINE_WORKSPACE),
        /stub timeout/,
      );
      assert.deepEqual(page.calls, [false]);
    } finally {
      restore();
    }
  });

  it("rejects a missing native row without hanging", async () => {
    const { page, restore } = stubBaselinePage({
      tabLabel: "No recent update",
      cardLabel: "No recent update",
      sessions: [],
    });
    try {
      const startedAt = Date.now();
      await assert.rejects(
        () => waitForPrePromptBaselineUnknown(page, BASELINE_SESSION, BASELINE_WORKSPACE, { nativeTimeoutMs: 10 }),
        /no live native row/,
      );
      assert.ok(Date.now() - startedAt < 5000, "must stay bounded, never hang");
    } finally {
      restore();
    }
  });
});

describe("readRenderedAgentLabels (actual probe path)", () => {
  it("reads the tab badge and card row labels for the session", async () => {
    const { page, restore } = stubBaselinePage({
      tabLabel: "No recent update",
      cardLabel: "No recent update",
      sessions: [livePiRow()],
    });
    try {
      assert.deepEqual(await readRenderedAgentLabels(page, BASELINE_SESSION), {
        tab: "No recent update",
        cardRow: "No recent update",
      });
    } finally {
      restore();
    }
  });

  it("reports null for surfaces that carry no known badge", async () => {
    const { page, restore } = stubBaselinePage({
      tabLabel: "Idle",
      cardLabel: null,
      sessions: [livePiRow()],
    });
    try {
      assert.deepEqual(await readRenderedAgentLabels(page, BASELINE_SESSION), {
        tab: "Idle",
        cardRow: null,
      });
    } finally {
      restore();
    }
  });
});

describe("probePiAgentStateWorkingIdle caller wiring", () => {
  // Drives the real probe up to the pre-prompt baseline with an injected
  // baseline step: proves the probe calls it with the launched session id
  // and the addressed workspace id, and that a baseline failure carries
  // the rendered state before any cleanup stop runs.
  it("invokes the baseline step with the launched id and reports rendered state on failure", async () => {
    const launched = livePiRow({ id: "pi-live-1", incarnation: 3 });
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    const previousCss = globalThis.CSS;
    globalThis.CSS = { escape: (value) => value };
    const shots = [];
    const baselineCalls = [];
    let sessionReads = 0;
    const bannerBuffer = {
      length: 2,
      getLine: (row) => ({
        translateToString: () => (row === 0 ? "pi v9.9.9" : "type clear/exit"),
      }),
    };
    const tabElement = {
      getAttribute: (name) => (name === "aria-label" ? "Terminal 1 live" : name === "aria-current" ? null : null),
      querySelector: (selector) => (/aria-label="No recent update"/.test(selector) ? {} : null),
    };
    globalThis.window = {
      drogon: {
        workspaces: async () => ({ ok: true, result: { workspaces: [{ id: BASELINE_WORKSPACE, name: "mussel" }] } }),
        // The first read is the pre-launch list (empty here); every later
        // read sees the new live Pi row.
        sessions: async () => ({
          ok: true,
          result: { sessions: sessionReads++ === 0 ? [] : [launched] },
        }),
        agentSettings: { get: async () => ({ ok: true, result: { settings: { agentDefaultArgs: { pi: `--model ${PI_MODEL}` } } } }) },
      },
      __drogonTerminals: new Map([["pi-live-1", { buffer: { active: bannerBuffer }, textarea: {} }]]),
    };
    globalThis.document = {
      activeElement: null,
      querySelector: (selector) => {
        if (/data-tab-id="pi-live-1"/.test(selector)) return tabElement;
        const match = /\[aria-label="Select mussel"\]/.exec(selector);
        if (match) return { getAttribute: (name) => (name === "aria-current" ? "page" : null) };
        return null;
      },
      querySelectorAll: () => [],
    };
    const control = { click: async () => {}, fill: async () => {}, press: async () => {}, waitFor: async () => {} };
    const page = {
      evaluate: (fn, arg) => fn(arg),
      waitForFunction: async (fn, arg) => {
        const value = await fn(arg);
        if (!value) throw new Error(`stub timeout waiting for ${JSON.stringify(arg)}`);
        return { jsonValue: async () => value };
      },
      getByRole: () => ({ ...control, first: () => control }),
      locator: () => ({
        ...control,
        getByRole: () => ({ ...control, count: async () => 0, getAttribute: async () => null }),
        count: async () => 0,
        getAttribute: async () => null,
      }),
      screenshot: async ({ path: shotPath }) => { shots.push(shotPath); },
    };
    const dir = await mkdtemp(path.join(tmpdir(), "pi-baseline-wiring-"));
    try {
      const baseline = async (baselinePage, sessionId, workspaceId) => {
        baselineCalls.push([baselinePage === page, sessionId, workspaceId]);
        throw new Error("wiring-proven-stop");
      };
      await assert.rejects(
        () => probePiAgentStateWorkingIdle({
          page,
          workspaceId: BASELINE_WORKSPACE,
          output: dir,
          getFixtureReceipt: () => { throw new Error("must not reach the turn"); },
          prePromptBaseline: baseline,
        }),
        /wiring-proven-stop/,
      );
      assert.deepEqual(baselineCalls, [[true, "pi-live-1", BASELINE_WORKSPACE]]);
      assert.ok(shots.length === 1 && shots[0].endsWith("agent-state-baseline.png"));
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
      globalThis.CSS = previousCss;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
