// Best-effort diagnosis for a packaged bundle that never publishes its
// debugging endpoint (or exits before it can). Appended to the
// endpoint-timeout or early-exit error. Never throws: an unknown launch
// failure keeps its raw evidence instead of gaining a wrong guess.
//
// The one release-blocking shape recognized today: a hardened-runtime
// signature without the V8 JIT entitlement. V8 then cannot reserve its code
// range and the app dies before any window exists — either loudly
// ("Failed to reserve virtual memory for CodeRange" on stderr) or, on a
// quarantined first launch, silently with no output at all (rc.3 does both:
// silent while quarantined, CodeRange crash once quarantine is cleared).
// Static checks (spctl/stapler/codesign --verify) all pass on such a bundle;
// only a launch, or this entitlement read, can see it.
import { runAcceptanceProcess } from "./acceptance-process.mjs";

// codesign prints e.g. flags=0x10000(runtime); the runtime bit is 0x10000.
const HARDENED_RUNTIME_FLAG = 0x10000;

export function hardenedWithoutJit({ details = "", entitlements = "" } = {}) {
  const hardened =
    (parseInt(details.match(/flags=(0x[0-9a-f]+)/i)?.[1] ?? "0", 16) & HARDENED_RUNTIME_FLAG) !== 0;
  return hardened && !/allow-jit/.test(entitlements);
}

export async function diagnosePackagedLaunchFailure({
  tail = "",
  executable = null,
  run = runAcceptanceProcess,
} = {}) {
  try {
    if (!executable || process.platform !== "darwin") return "";
    const crashedOnCodeRange = /Failed to reserve virtual memory for CodeRange/.test(tail);
    // A published DevTools line means Chromium started: whatever failed later
    // is not a stillborn launch, so the static check would only mislead.
    const endpointPublished = /DevTools listening on ws:\/\/127\.0\.0\.1:\d+\/\S+/.test(tail);
    if (!crashedOnCodeRange && endpointPublished) return "";
    const details =
      (await run("/usr/bin/codesign", ["-dv", executable], { timeout: 15000 })).stderr ?? "";
    let entitlements = "";
    try {
      entitlements =
        (await run("/usr/bin/codesign", ["-d", "--entitlements", "-", executable], { timeout: 15000 }))
          .stdout ?? "";
    } catch {
      entitlements = "";
    }
    if (!hardenedWithoutJit({ details, entitlements })) return "";
    const fate = crashedOnCodeRange
      ? "crashes before any window exists"
      : "never reaches a window (no debugging endpoint was published)";
    return (
      " Diagnosis: the bundle's main executable is hardened-runtime signed without " +
      `com.apple.security.cs.allow-jit, so V8 cannot reserve its code range and the app ${fate}. ` +
      "Re-sign with the Electron allow-jit entitlement " +
      "(cf. @electron/osx-sign default.darwin.plist) and re-run packaged acceptance."
    );
  } catch {
    return "";
  }
}
