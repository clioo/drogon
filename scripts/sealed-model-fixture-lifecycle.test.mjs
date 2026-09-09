import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  closeModelFixtureForReport,
  startAndSeedModelFixture,
} from "./sealed-model-fixture-lifecycle.mjs";
import { startSealedModelFixture } from "./sealed-model-fixture.mjs";

// Every test here talks only to real loopback HTTP servers this suite
// itself starts (the real sealed-model-fixture, or a tiny throwaway
// http.createServer for the "start failure" case) -- never the actual
// packaged app, never a real provider.

describe("startAndSeedModelFixture", () => {
  it("returns the started, seeded fixture on the happy path", async () => {
    const seenBaseUrls = [];
    const modelFixture = await startAndSeedModelFixture(async (baseUrl) => {
      seenBaseUrls.push(baseUrl);
    });
    try {
      assert.equal(seenBaseUrls.length, 1);
      assert.equal(seenBaseUrls[0], modelFixture.baseUrl);
      assert.match(modelFixture.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    } finally {
      const result = await modelFixture.close();
      assert.equal(result.verdict, "stopped");
    }
  });

  it("start failure: never opens a fixture at all when startFixture itself throws, so there is nothing to leak", async () => {
    const startFixture = async () => {
      throw new Error("simulated: could not bind a loopback port");
    };
    let seedCalled = false;
    await assert.rejects(
      startAndSeedModelFixture(
        async () => {
          seedCalled = true;
        },
        { startFixture },
      ),
      /simulated: could not bind a loopback port/,
    );
    assert.equal(seedCalled, false);
  });

  it("seed failure: closes the just-started fixture before propagating, instead of leaking a live loopback server", async () => {
    let capturedFixture = null;
    const startFixture = async () => {
      capturedFixture = await startSealedModelFixture();
      return capturedFixture;
    };
    await assert.rejects(
      startAndSeedModelFixture(
        async () => {
          throw new Error("simulated: seedLocalPiProvider rejected a bad baseUrl");
        },
        { startFixture },
      ),
      /simulated: seedLocalPiProvider rejected a bad baseUrl/,
    );
    assert.ok(capturedFixture, "the fixture must have actually started for this to be a real test");
    // The real proof it was not leaked: the port it was bound to no
    // longer accepts connections.
    await assert.rejects(
      fetch(`${capturedFixture.baseUrl.replace("/v1", "")}/__fixture__/health`, {
        signal: AbortSignal.timeout(2000),
      }),
    );
  });
});

describe("closeModelFixtureForReport", () => {
  it("normal close: reports success with zero outstanding resources when nothing was ever in flight", async () => {
    const modelFixture = await startSealedModelFixture();
    const result = await closeModelFixtureForReport(modelFixture);
    assert.equal(result.failed, false);
    assert.equal(result.errorDetail, null);
    assert.match(result.cleanupLine, /^sealed model fixture: stopped /);
    assert.match(result.cleanupLine, /outstandingStreams=0/);
    assert.match(result.cleanupLine, /outstandingSockets=0/);
  });

  it("functional failure: a still-in-flight stream at close time is reported as a real failure, not swallowed", async () => {
    const modelFixture = await startSealedModelFixture();
    const inFlight = fetch(`${modelFixture.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: true,
        messages: [
          {
            role: "user",
            content:
              "Count from 1 to 200 separated by commas. Reply with only the numbers.",
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const result = await closeModelFixtureForReport(modelFixture);
    assert.equal(result.failed, true);
    assert.ok(result.errorDetail, "a failing close must carry a real error detail, not just a flag");
    assert.match(result.errorDetail, /abortedStreams=1/);
    assert.match(result.cleanupLine, /abortedStreams=1/);
    assert.match(result.cleanupLine, /outstandingStreams=0, outstandingSockets=0/);
    await inFlight;
  });

  it("never throws even if the fixture's own close() somehow does, and still reports failure with evidence", async () => {
    const throwingFixture = {
      close: async () => {
        throw new Error("simulated: close() itself blew up");
      },
      receipt: () => ({ totalRequests: 0, rejected: 0 }),
    };
    const result = await closeModelFixtureForReport(throwingFixture);
    assert.equal(result.failed, true);
    assert.match(result.errorDetail, /simulated: close\(\) itself blew up/);
    assert.match(result.cleanupLine, /simulated: close\(\) itself blew up/);
  });

  it("an unverifiable verdict fails the run even with zero outstanding counts", async () => {
    const unverifiableFixture = {
      close: async () => ({
        verdict: "unverifiable",
        forced: false,
        outstandingStreams: 0,
        outstandingSockets: 0,
        error: "simulated: server.close() never settled",
      }),
      receipt: () => ({ totalRequests: 3, rejected: 0 }),
    };
    const result = await closeModelFixtureForReport(unverifiableFixture);
    assert.equal(result.failed, true);
    assert.match(result.errorDetail, /verdict=unverifiable/);
    assert.match(result.errorDetail, /simulated: server\.close\(\) never settled/);
  });
});
