// Main-side unit test for the `drogon:openExternal` IPC handler: the
// allow-list decision and the opener call, with a stubbed opener (no
// Electron shell involved).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { dispatchOpenExternalRequest } from "./shell-bridge";

describe("dispatchOpenExternalRequest", () => {
  it("opens an allowed URL through the opener", async () => {
    const opened: string[] = [];
    const result = await dispatchOpenExternalRequest(
      "https://github.com/clioo/drogon",
      async (url) => {
        opened.push(url);
      },
    );
    assert.deepEqual(opened, ["https://github.com/clioo/drogon"]);
    assert.deepEqual(result, { ok: true, result: { opened: true } });
  });
  it("refuses a dangerous scheme without calling the opener", async () => {
    let calls = 0;
    const result = await dispatchOpenExternalRequest(
      "javascript:alert(1)",
      async () => {
        calls += 1;
      },
    );
    assert.equal(calls, 0);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid_argument");
  });
  it("refuses non-string input without calling the opener", async () => {
    let calls = 0;
    const result = await dispatchOpenExternalRequest(null, async () => {
      calls += 1;
    });
    assert.equal(calls, 0);
    assert.equal(result.ok, false);
  });
  it("reports an opener failure as an internal error", async () => {
    const result = await dispatchOpenExternalRequest(
      "https://example.com/",
      async () => {
        throw new Error("no browser");
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "internal_error");
  });
});
