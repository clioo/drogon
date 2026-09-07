// Poll async IPC results in Node; a browser predicate returning a Promise is truthy.
export function waitForBridgeObservation(
  page,
  predicate,
  argument,
  { timeoutMs = 15000, intervalMs = 100 } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let nextPoll;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(nextPoll);
      if (error) reject(error);
      else resolve();
    };
    const deadline = setTimeout(
      () =>
        finish(
          new Error(
            "Bridge observation did not become true before its deadline",
          ),
        ),
      timeoutMs,
    );
    const poll = async () => {
      try {
        const observed = await page.evaluate(predicate, argument);
        if (settled) return;
        if (observed === true) finish();
        else nextPoll = setTimeout(poll, intervalMs);
      } catch (error) {
        finish(error);
      }
    };
    void poll();
  });
}
