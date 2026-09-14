import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diagnosePackagedLaunchFailure,
  hardenedWithoutJit,
} from "./packaged-launch-diagnosis.mjs";

const HARDENED_DETAILS =
  "Executable=/tmp/Drogon.app/Contents/MacOS/Drogon\nCodeDirectory v=20500 size=507 flags=0x10000(runtime) hashes=9+3 location=embedded\n";
const ADHOC_DETAILS =
  "Executable=/tmp/Drogon.app/Contents/MacOS/Drogon\nCodeDirectory v=20400 size=296 flags=0x2(adhoc) hashes=3+3 location=embedded\n";
const JIT_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>com.apple.security.cs.allow-jit</key><true/></dict></plist>
`;

test("hardened runtime without allow-jit is the stillborn shape", () => {
  assert.equal(hardenedWithoutJit({ details: HARDENED_DETAILS, entitlements: "" }), true);
  assert.equal(
    hardenedWithoutJit({ details: HARDENED_DETAILS, entitlements: JIT_ENTITLEMENTS }),
    false,
  );
  assert.equal(hardenedWithoutJit({ details: ADHOC_DETAILS, entitlements: "" }), false);
  assert.equal(hardenedWithoutJit({ details: "not codesign output", entitlements: "" }), false);
  assert.equal(hardenedWithoutJit(), false);
});

// A canned codesign that answers like the real one: -dv reports on stderr,
// --entitlements prints the plist on stdout.
function stubCodesign({ details, entitlements = "", calls = [] }) {
  return async (file, args, _options) => {
    calls.push([file, args]);
    assert.equal(file, "/usr/bin/codesign");
    if (args[0] === "-dv") return { stdout: "", stderr: details };
    assert.deepEqual(args.slice(0, 3), ["-d", "--entitlements", "-"]);
    return { stdout: entitlements, stderr: "" };
  };
}

test("a CodeRange crash names the missing JIT entitlement", async () => {
  const diagnosis = await diagnosePackagedLaunchFailure({
    tail: "Fatal process out of memory: Failed to reserve virtual memory for CodeRange",
    executable: "/tmp/Drogon.app/Contents/MacOS/Drogon",
    run: stubCodesign({ details: HARDENED_DETAILS }),
  });
  assert.match(diagnosis, /allow-jit/);
  assert.match(diagnosis, /crashes before any window exists/);
});

test("a silent launch with no endpoint gets the same static diagnosis", async () => {
  const diagnosis = await diagnosePackagedLaunchFailure({
    tail: "",
    executable: "/tmp/Drogon.app/Contents/MacOS/Drogon",
    run: stubCodesign({ details: HARDENED_DETAILS }),
  });
  assert.match(diagnosis, /allow-jit/);
  assert.match(diagnosis, /no debugging endpoint was published/);
});

test("a launch that reached Chromium is not blamed on entitlements", async () => {
  const calls = [];
  const diagnosis = await diagnosePackagedLaunchFailure({
    tail: "DevTools listening on ws://127.0.0.1:52331/devtools/browser/abc\nlater CDP hiccup",
    executable: "/tmp/Drogon.app/Contents/MacOS/Drogon",
    run: stubCodesign({ details: HARDENED_DETAILS, calls }),
  });
  assert.equal(diagnosis, "");
  assert.equal(calls.length, 0);
});

test("a CodeRange crash on an entitled bundle stays undiagnosed", async () => {
  const diagnosis = await diagnosePackagedLaunchFailure({
    tail: "Failed to reserve virtual memory for CodeRange",
    executable: "/tmp/Drogon.app/Contents/MacOS/Drogon",
    run: stubCodesign({ details: HARDENED_DETAILS, entitlements: JIT_ENTITLEMENTS }),
  });
  assert.equal(diagnosis, "");
});

test("an ad-hoc dev binary never gets the release diagnosis", async () => {
  const calls = [];
  const diagnosis = await diagnosePackagedLaunchFailure({
    tail: "",
    executable: "/tmp/Drogon.app/Contents/MacOS/Drogon",
    run: stubCodesign({ details: ADHOC_DETAILS, calls }),
  });
  assert.equal(diagnosis, "");
  assert.ok(calls.length > 0);
});

test("missing executable or failing codesign fails closed to no diagnosis", async () => {
  const calls = [];
  assert.equal(
    await diagnosePackagedLaunchFailure({
      tail: "",
      executable: null,
      run: stubCodesign({ details: HARDENED_DETAILS, calls }),
    }),
    "",
  );
  assert.equal(calls.length, 0);
  assert.equal(
    await diagnosePackagedLaunchFailure({
      tail: "",
      executable: "/tmp/Drogon.app/Contents/MacOS/Drogon",
      run: async () => {
        throw new Error("codesign unavailable");
      },
    }),
    "",
  );
});
