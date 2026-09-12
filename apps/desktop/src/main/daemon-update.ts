// MIT Copyright (c) 2026 Lovecast Inc.
// Install-resilience P5 decision core: should an app launch attach to the
// already-running daemon, or has the installed bundle's `drogond` changed
// underneath it? The daemon is detached (PPID 1) and survives app-bundle
// replaces by design (`native-runtime-bootstrap.ts`'s "attach to
// already-healthy, never spawn over it" contract), so an update otherwise
// leaves a NEW renderer talking to an OLD daemon — the root of audit
// Findings 4/7/9. This module only decides; the graceful restart mechanics
// stay in `daemon-restart.ts`/`daemon-update-restart.ts`.
//
// Honesty rules (spec, non-negotiable):
// - A restart decided here is never silent: the caller must surface
//   "Drogon updated to <rev>; restarting its background service".
// - A mismatch that cannot be proven is never claimed either way: an
//   unknown identity (either side) attaches unchanged. The one exception
//   is a packaged bundle whose daemon predates identity reporting entirely
//   — such a daemon is necessarily OLDER than this build (a build as new
//   as the bundle always reports its digest), so the honest state is
//   still "changed binary", with a reason saying verification was
//   impossible rather than inventing a digest comparison.

import type { DaemonUpdateState } from "../shared/daemon-contract";

export type DaemonIdentity = {
  /** The freshly-installed bundle's own `drogond` digest; null = unknown. */
  bundleDigest: string | null;
  /** The running daemon's self-reported digest; null/absent = unknown. */
  daemonDigest: string | null | undefined;
};

export type DaemonUpdateDecision =
  | { kind: "up-to-date"; daemonDigest: string }
  | {
      kind: "changed-binary";
      reason: string;
      daemonDigest: string | null;
    }
  | { kind: "identity-unknown"; reason: string };

export function classifyDaemonUpdate(identity: DaemonIdentity): DaemonUpdateDecision {
  const { bundleDigest, daemonDigest } = identity;
  if (!bundleDigest) {
    return {
      kind: "identity-unknown",
      reason:
        "This Drogon build cannot read its own bundled service binary, so it cannot verify the running service.",
    };
  }
  if (daemonDigest === bundleDigest) {
    return { kind: "up-to-date", daemonDigest: bundleDigest };
  }
  if (daemonDigest) {
    return {
      kind: "changed-binary",
      reason:
        "The running Drogon service was started from a different build than the one just installed.",
      daemonDigest,
    };
  }
  return {
    kind: "changed-binary",
    reason:
      "The running Drogon service is from an older build that does not report its binary identity, so it cannot be verified against this install.",
    daemonDigest: null,
  };
}

/** What the renderer is told about an update seen at launch. The type
 *  lives in the shared contract (`shared/daemon-contract.ts`) so the
 *  preload bridge carries it verbatim; `shortRevision`/`updatedNotice`
 *  here are the builders. */
export type { DaemonUpdateState };

/** The user-visible notice line for a restart this launch performed. */
export function updatedNotice(revision: string | null): string {
  return revision
    ? `Drogon updated to ${revision}; restarting its background service.`
    : "Drogon updated; restarting its background service.";
}

/** Shortens a full build revision for display; passes through unknown. */
export function shortRevision(revision: string | null): string | null {
  return revision ? revision.slice(0, 12) : null;
}
