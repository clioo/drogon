import type {
  BrowserBridge,
  BrowserStateEvent,
  BrowserTabState,
} from "../../../../shared/browser-contract";
import type { Result } from "../../../../shared/session-contract";
import type {
  BrowserAuthoritySource,
  NavDecision,
} from "./browser-authority-source";
import type { WindowOpenDecision } from "./window-open-authority";

/**
 * The granted `window.drogon.browser.*` namespace. DesktopBridge
 * (coordinator-owned) does not declare it yet, so the cast lives here —
 * one place — rather than at every call site.
 */
export function windowBrowserBridge(): BrowserBridge {
  return (window.drogon as unknown as { browser: BrowserBridge }).browser;
}

const OPEN_LINKS_IN_APP_KEY = "drogon.browser.openLinksInApp";

/**
 * The fork's Link Routing preference (src/shared/global-settings-types.ts
 * `openLinksInApp`, default false): whether http(s) links — from the
 * terminal foremost — open in the built-in browser by default. ⇧⌘-click
 * always uses the system browser. Drogon persists the same semantics in
 * renderer storage; the terminal link routing reads it, as does the
 * browser panel footer toggle.
 */
export function readOpenLinksInApp(): boolean {
  try {
    return window.localStorage.getItem(OPEN_LINKS_IN_APP_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeOpenLinksInApp(openLinksInApp: boolean): void {
  try {
    window.localStorage.setItem(
      OPEN_LINKS_IN_APP_KEY,
      openLinksInApp ? "1" : "0",
    );
  } catch {
    // A denied storage write keeps the default; never blocks navigation.
  }
}

/**
 * Authority source backed by the local browser host. Navigation proposals
 * go to the host's navigate (which enforces the http(s)-only policy);
 * window-open intents are routed into a new pane tab unconditionally —
 * the fork (browser-client popups and main's window-open handler) never
 * sends them to the OS, and terminal links reach the pane through the
 * terminal's own routing, not this seam.
 */
export function createBrowserAuthoritySource(input: {
  bridge: BrowserBridge;
  workspaceId: () => string | null;
}): BrowserAuthoritySource {
  const { bridge } = input;
  return {
    requestNavigation({ tabId, url }): Promise<Result<NavDecision>> {
      return bridge.navigate({ tabId, url }).then(
        (result) => {
          if (result.ok) return { ok: true, result: { outcome: "allow" } };
          if (result.error.code === "browser_blocked")
            return {
              ok: true,
              result: { outcome: "block", reason: result.error.message },
            };
          return result as Result<NavDecision>;
        },
        (failure: unknown) =>
          ({
            ok: false,
            error: {
              code: "browser_unavailable",
              message:
                failure instanceof Error
                  ? failure.message
                  : "The navigation request could not be delivered.",
              retryable: true,
            },
          }) as Result<NavDecision>,
      );
    },
    requestWindowOpen({ url }): Promise<Result<WindowOpenDecision>> {
      const workspaceId = input.workspaceId();
      if (!workspaceId) {
        return Promise.resolve({
          ok: true,
          result: {
            outcome: "open-in-system",
            reason:
              "No workspace is selected, so the link cannot open in the pane.",
          },
        });
      }
      return bridge.createTab({ workspaceId, url }).then(
        (result) => ({
          ok: true,
          result: result.ok
            ? {
                outcome: "allow" as const,
                reason: "Opened in the Browser panel.",
              }
            : {
                outcome: "block" as const,
                reason: result.error.message,
              },
        }),
        (failure: unknown) => ({
          ok: false as const,
          error: {
            code: "browser_unavailable",
            message:
              failure instanceof Error
                ? failure.message
                : "The window-open request could not be delivered.",
            retryable: true,
          },
        }),
      );
    },
  };
}

export type { BrowserBridge, BrowserStateEvent, BrowserTabState };

export type { PersistedBrowserTab } from "../shell/tab-order";
import type { PersistedBrowserTab } from "../shell/tab-order";

/**
 * Stored browser tabs worth recreating (R16-AJ, fixes #215): stored strip
 * order, deduped, excluding ids the host still lists. The host owns tab
 * ids per launch (`browser-tab-N`), so after a full desktop restart the
 * live list is empty and every stored entry recreates via
 * `createTab({ workspaceId, url })`; after a mere renderer reload the live
 * list already holds them and nothing recreates (no duplicates). Pure so
 * the workspace-load path in App stays unit-tested without mounting.
 */
export function planBrowserRehydrate(input: {
  stored: readonly PersistedBrowserTab[];
  liveTabIds: readonly string[] | ReadonlySet<string>;
}): PersistedBrowserTab[] {
  const live =
    input.liveTabIds instanceof Set
      ? input.liveTabIds
      : new Set(input.liveTabIds);
  const out: PersistedBrowserTab[] = [];
  const seen = new Set<string>();
  for (const entry of input.stored) {
    if (live.has(entry.tabId) || seen.has(entry.tabId)) continue;
    seen.add(entry.tabId);
    out.push(entry);
  }
  return out;
}
