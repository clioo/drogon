import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertLoopbackHost,
  classifyPrompt,
  countingReplyText,
  FIXTURE_IDENTITY,
  HEALTH_PATH,
  healthUrlFor,
  isOwnedFixtureHealth,
  lastUserContent,
  startSealedModelFixture,
} from "./sealed-model-fixture.mjs";

describe("classifyPrompt", () => {
  it("recognizes the marker-echo instruction and extracts the marker", () => {
    assert.deepEqual(
      classifyPrompt(
        "Reply with exactly this acceptance marker and nothing else: BOT_12345",
      ),
      { kind: "marker", marker: "BOT_12345" },
    );
  });

  it("recognizes the exact J1 counting prompt", () => {
    assert.deepEqual(
      classifyPrompt(
        "Count from 1 to 200 separated by commas. Reply with only the numbers.",
      ),
      { kind: "counting" },
    );
  });

  it("recognizes the counting prompt even wrapped with extra agent context", () => {
    assert.deepEqual(
      classifyPrompt(
        "Some agent preamble.\nCount from 1 to 200 separated by commas. Reply with only the numbers.\n",
      ),
      { kind: "counting" },
    );
  });

  it("fails closed on anything unrecognized -- never a guessed reply", () => {
    assert.equal(classifyPrompt("What is 2 + 2?"), null);
    assert.equal(classifyPrompt(""), null);
    assert.equal(classifyPrompt(null), null);
    assert.equal(classifyPrompt(undefined), null);
    assert.equal(classifyPrompt(42), null);
  });
});

describe("lastUserContent", () => {
  it("picks the last user-role message with string content", () => {
    assert.equal(
      lastUserContent([
        { role: "system", content: "You are Pi." },
        { role: "user", content: "first" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "second" },
      ]),
      "second",
    );
  });

  it("returns null with no user message, a non-string content, or a non-array", () => {
    assert.equal(lastUserContent([{ role: "system", content: "x" }]), null);
    assert.equal(lastUserContent([{ role: "user", content: [{ type: "text" }] }]), null);
    assert.equal(lastUserContent(null), null);
    assert.equal(lastUserContent(undefined), null);
  });
});

describe("countingReplyText", () => {
  it("is the exact deterministic '1, 2, 3, ..., 200' the J1 prompt asks for", () => {
    const text = countingReplyText();
    assert.ok(text.startsWith("1, 2, 3, 4, 5"));
    assert.ok(text.endsWith("199, 200"));
    assert.equal(text.split(", ").length, 200);
    assert.equal(text.split(", ")[0], "1");
    assert.equal(text.split(", ")[199], "200");
  });
});

describe("healthUrlFor", () => {
  it("derives the health origin from an OpenAI-shaped baseUrl, never nested under /v1", () => {
    assert.equal(
      healthUrlFor("http://127.0.0.1:54321/v1"),
      `http://127.0.0.1:54321${HEALTH_PATH}`,
    );
  });
});

describe("isOwnedFixtureHealth", () => {
  it("accepts a matching identity with no instance pinned", () => {
    assert.equal(
      isOwnedFixtureHealth({ fixture: FIXTURE_IDENTITY, instanceId: "a" }),
      true,
    );
  });

  it("accepts a matching identity AND matching pinned instance", () => {
    assert.equal(
      isOwnedFixtureHealth({ fixture: FIXTURE_IDENTITY, instanceId: "a" }, "a"),
      true,
    );
  });

  it("refuses a foreign process's health payload even if it claims the right type string", () => {
    assert.equal(isOwnedFixtureHealth({ fixture: "some-other-fixture/1" }), false);
    assert.equal(isOwnedFixtureHealth(null), false);
    assert.equal(isOwnedFixtureHealth("not an object"), false);
  });

  it("refuses a DIFFERENT running instance of the same fixture type -- a stale/foreign process must never pass as ready", () => {
    assert.equal(
      isOwnedFixtureHealth({ fixture: FIXTURE_IDENTITY, instanceId: "stale" }, "current"),
      false,
    );
  });
});

describe("assertLoopbackHost", () => {
  it("accepts every loopback form", () => {
    assert.doesNotThrow(() => assertLoopbackHost("127.0.0.1"));
    assert.doesNotThrow(() => assertLoopbackHost("localhost"));
    assert.doesNotThrow(() => assertLoopbackHost("::1"));
  });

  it("refuses any non-loopback host -- no accidental real-network exposure", () => {
    assert.throws(() => assertLoopbackHost("0.0.0.0"), /non-loopback/);
    assert.throws(() => assertLoopbackHost("100.85.64.21"), /non-loopback/);
    assert.throws(() => assertLoopbackHost("example.com"), /non-loopback/);
  });
});

// ---------------------------------------------------------------------------
// Integration: a real HTTP server, a real fetch client, real SSE stream
// parsing. Every fixture this suite starts is closed in the same test
// (owned process/socket cleanup) with a bounded AbortSignal.timeout on
// every request, so a hung server or a hung client both fail the test
// instead of the run.
// ---------------------------------------------------------------------------

describe("startSealedModelFixture", () => {
  it("refuses a non-loopback bind host before ever opening a socket", async () => {
    await assert.rejects(
      startSealedModelFixture({ host: "0.0.0.0" }),
      /non-loopback/,
    );
  });

  it("serves its own identity at the health path, separate from the /v1 namespace", async () => {
    const fixture = await startSealedModelFixture();
    try {
      const response = await fetch(healthUrlFor(fixture.baseUrl), {
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.fixture, FIXTURE_IDENTITY);
      assert.equal(body.instanceId, fixture.instanceId);
      assert.equal(body.ok, true);
      assert.equal(isOwnedFixtureHealth(body, fixture.instanceId), true);
      assert.equal(fixture.receipt().byKind.health, 1);
    } finally {
      const result = await fixture.close();
      assert.equal(result.verdict, "stopped");
    }
  });

  it("answers the non-streaming marker-echo request with the exact marker, nothing else", async () => {
    const fixture = await startSealedModelFixture();
    try {
      const response = await fetch(`${fixture.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3.8-flash-next-nvidia-nvfp4",
          messages: [
            {
              role: "user",
              content:
                "Reply with exactly this acceptance marker and nothing else: BOT_ACCEPT_9",
            },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.object, "chat.completion");
      assert.equal(body.choices[0].message.role, "assistant");
      assert.equal(body.choices[0].message.content, "BOT_ACCEPT_9");
      assert.equal(body.choices[0].finish_reason, "stop");
      const receipt = fixture.receipt();
      assert.equal(receipt.byKind.marker, 1);
      assert.equal(receipt.rejected, 0);
    } finally {
      await fixture.close();
    }
  });

  it("streams the counting reply over real, separately-timed SSE chunks that a real client must incrementally parse", async () => {
    // Small, bounded pacing so this test stays fast while still proving
    // genuine incremental delivery (not one buffered write): the real
    // production defaults are exercised by the fixture's own defaults in
    // the marker/health tests above and documented in the module itself.
    const fixture = await startSealedModelFixture({
      streamChunkSize: 40,
      streamIntervalMs: 20,
    });
    try {
      const response = await fetch(`${fixture.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3.8-flash-next-nvidia-nvfp4",
          stream: true,
          messages: [
            {
              role: "user",
              content:
                "Count from 1 to 200 separated by commas. Reply with only the numbers.",
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "text/event-stream");
      const decoder = new TextDecoder();
      let buffered = "";
      let assembled = "";
      let chunkArrivals = 0;
      let firstArrivalAt = null;
      let lastArrivalAt = null;
      for await (const bytes of response.body) {
        const now = Date.now();
        firstArrivalAt ??= now;
        lastArrivalAt = now;
        buffered += decoder.decode(bytes, { stream: true });
        let boundary;
        while ((boundary = buffered.indexOf("\n\n")) !== -1) {
          const frame = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          const line = frame.trim();
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice("data: ".length);
          if (payload === "[DONE]") continue;
          const parsed = JSON.parse(payload);
          const delta = parsed.choices[0].delta;
          if (typeof delta.content === "string") {
            assembled += delta.content;
            chunkArrivals += 1;
          }
        }
      }
      assert.equal(assembled, countingReplyText());
      // Real incremental transport: more than one distinct chunk arrived,
      // and the whole exchange took measurably longer than an instant
      // single-write response would (proving the client had to parse a
      // real stream, not a fully-buffered body dressed up as one).
      assert.ok(chunkArrivals > 5, `expected multiple SSE chunks, got ${chunkArrivals}`);
      assert.ok(
        lastArrivalAt - firstArrivalAt >= 40,
        "the stream must arrive over real, separated time, not one instant write",
      );
      const receipt = fixture.receipt();
      assert.equal(receipt.byKind.counting, 1);
    } finally {
      await fixture.close();
    }
  });

  it("fails closed with an honest 4xx on any unrecognized prompt, instead of simulating arbitrary model intelligence", async () => {
    const fixture = await startSealedModelFixture();
    try {
      const response = await fetch(`${fixture.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "What model are you really?" }],
        }),
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(response.status, 422);
      const body = await response.json();
      assert.equal(body.error.type, "sealed_fixture_rejected");
      const receipt = fixture.receipt();
      assert.equal(receipt.rejected, 1);
      assert.deepEqual(receipt.rejectedPaths, ["/v1/chat/completions"]);
    } finally {
      await fixture.close();
    }
  });

  it("fails closed on malformed JSON and on unknown routes, and the receipt only ever carries paths/counts, never prompt content", async () => {
    const fixture = await startSealedModelFixture();
    try {
      const malformed = await fetch(`${fixture.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(malformed.status, 400);

      const unknown = await fetch(`${fixture.baseUrl}/embeddings`, {
        method: "POST",
        signal: AbortSignal.timeout(5000),
      });
      assert.equal(unknown.status, 404);

      const receipt = fixture.receipt();
      assert.equal(receipt.rejected, 2);
      for (const path of receipt.rejectedPaths) {
        assert.equal(typeof path, "string");
      }
      // Never a message/content field anywhere in the sanitized receipt.
      assert.equal(JSON.stringify(receipt).includes("content"), false);
    } finally {
      await fixture.close();
    }
  });

  it("actually stops listening after close() -- owned socket cleanup, not a leaked server, with zero outstanding resources when nothing was ever in flight", async () => {
    const fixture = await startSealedModelFixture();
    const result = await fixture.close();
    assert.deepEqual(result, {
      verdict: "stopped",
      forced: false,
      outstandingStreams: 0,
      outstandingSockets: 0,
    });
    await assert.rejects(
      fetch(healthUrlFor(fixture.baseUrl), { signal: AbortSignal.timeout(2000) }),
    );
  });

  it("close() never throws, settles quickly, and reports the real outstanding stream/socket it had to cut short -- even with a request in flight -- and is safe to call twice", async () => {
    const fixture = await startSealedModelFixture();
    // A long-paced stream (many chunks, comfortably longer than the
    // close() deadline below) that must never be waited out.
    const inFlight = fetch(`${fixture.baseUrl}/chat/completions`, {
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
    }).catch(() => null); // the in-flight request is expected to end abruptly
    await new Promise((resolve) => setTimeout(resolve, 10));

    const startedAt = Date.now();
    const result = await fixture.close();
    const elapsedMs = Date.now() - startedAt;
    assert.ok(
      result.verdict === "stopped" || result.verdict === "unverifiable",
      `close() must always return a structured verdict, got ${JSON.stringify(result)}`,
    );
    // The real point of this correction: a caller must be able to see
    // that something was genuinely still in flight, not just infer it
    // from a boolean.
    assert.equal(result.outstandingStreams, 1);
    assert.ok(result.outstandingSockets >= 1);
    assert.equal(result.forced, true);
    assert.ok(
      elapsedMs < 1000,
      `close() must not wait out an in-flight stream's own pacing (took ${elapsedMs}ms)`,
    );
    // Calling close() again (as a defensive caller might) must also never
    // throw or hang, and must report zero outstanding the second time.
    const second = await fixture.close();
    assert.ok(second.verdict === "stopped" || second.verdict === "unverifiable");
    assert.equal(second.outstandingStreams, 0);
    assert.equal(second.outstandingSockets, 0);
    await inFlight;
  });
});
