// Extracted from accept-desktop.mjs so its two real lifecycle hazards --
// leaking the sealed model fixture past a bootstrap failure, and silently
// swallowing a close() problem instead of failing the run -- are each
// directly, deterministically testable against a real loopback fixture
// (scripts/sealed-model-fixture.mjs), without needing to run the actual
// packaged app. accept-desktop.mjs itself only calls these two functions;
// this module owns no other behavior.

import { startSealedModelFixture } from "./sealed-model-fixture.mjs";

/**
 * Starts the sealed model fixture and seeds the Pi config dir with its
 * baseUrl inside one cleanup-protected scope: if either the start itself
 * or `seed` throws, any fixture that DID start is closed before the error
 * propagates -- never leaked past a bootstrap failure. `seed` is called
 * with the started fixture's baseUrl (normally
 * `(baseUrl) => seedLocalPiProvider(piDir, baseUrl)`); `startFixture`
 * defaults to the real startSealedModelFixture and is overridable only so
 * tests can simulate a start failure without touching real sockets.
 */
export async function startAndSeedModelFixture(
  seed,
  { startFixture = startSealedModelFixture } = {},
) {
  let modelFixture = null;
  try {
    modelFixture = await startFixture();
    await seed(modelFixture.baseUrl, modelFixture.instanceId);
  } catch (error) {
    if (modelFixture) {
      const cleanup = await closeModelFixtureForReport(modelFixture);
      if (cleanup.failed) throw new AggregateError([error, new Error(cleanup.errorDetail)], "fixture setup and cleanup failed");
    }
    throw error;
  }
  return modelFixture;
}

/**
 * Closes an already-started model fixture and decides whether that alone
 * should fail the run: any verdict other than "stopped", or any nonzero
 * outstanding stream/socket, is real leaked-work evidence by the time
 * this runs in the real harness (every client that could hold one open --
 * the app/Pi -- has already been stopped by then), never a normal
 * keep-alive artifact. Returns `{ failed, cleanupLine, errorDetail }`
 * rather than mutating a report object directly, so the caller decides
 * how to combine `errorDetail` with any earlier functional failure
 * (append, never replace) and never needs a bare `.catch(() => {})`.
 * Never throws.
 */
export async function closeModelFixtureForReport(modelFixture) {
  try {
    const fixtureClose = await modelFixture.close();
    const receipt = modelFixture.receipt();
    const outstanding =
      fixtureClose.outstandingStreams + fixtureClose.outstandingSockets;
    const cleanupLine =
      `sealed model fixture: ${fixtureClose.verdict}${fixtureClose.forced ? " (forced)" : ""} ` +
      `(requests=${receipt.totalRequests}, rejected=${receipt.rejected}, ` +
      `outstandingStreams=${fixtureClose.outstandingStreams}, outstandingSockets=${fixtureClose.outstandingSockets}, abortedStreams=${fixtureClose.abortedStreams ?? 0})`;
    const failed = fixtureClose.verdict !== "stopped" || !Number.isFinite(outstanding) || outstanding > 0 || (fixtureClose.abortedStreams ?? 0) > 0;
    const errorDetail = failed
      ? `sealed model fixture cleanup: verdict=${fixtureClose.verdict}, ` +
        `outstandingStreams=${fixtureClose.outstandingStreams}, outstandingSockets=${fixtureClose.outstandingSockets}, abortedStreams=${fixtureClose.abortedStreams ?? 0}` +
        (fixtureClose.error ? `, error=${fixtureClose.error}` : "")
      : null;
    return { failed, cleanupLine, errorDetail };
  } catch (error) {
    return {
      failed: true,
      cleanupLine: `sealed model fixture cleanup: threw ${error.message}`,
      errorDetail: `sealed model fixture cleanup threw: ${error.message}`,
    };
  }
}
