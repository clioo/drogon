import type { BrowserAuthoritySource } from "./browser-authority-source";
import type { WindowOpenDecision } from "./window-open-authority";

/**
 * Navigation state for one browser tab. Phases are UI state: `blocked`
 * (service refused by policy) is terminal for that request — a blocked
 * request can never render as loading or ready, and its fenced commit is
 * dropped. Only a host commit for the CURRENT navigation generation moves
 * the pane to `ready`.
 */
export interface BrowserNavState {
  phase: "idle" | "loading" | "ready" | "blocked" | "error";
  tabId: string | null;
  /** The URL requested (loading) or host-committed (ready). */
  url: string | null;
  /** Monotonic navigation request id; host events fence against it. */
  generation: number;
  /** Policy reason or failure text, displayed verbatim. */
  message: string;
  canRetry: boolean;
}

export type BrowserNavAction =
  | { type: "reset" }
  | {
      type: "navigate-started";
      tabId: string;
      url: string;
      generation: number;
    }
  | {
      type: "committed";
      tabId: string;
      url: string;
      generation: number;
    }
  | { type: "failed"; tabId: string; generation: number; message: string }
  | {
      type: "blocked-by-policy";
      tabId: string;
      url: string;
      generation: number;
      reason: string;
    }
  | { type: "retry-started" };

export function initialBrowserNavState(): BrowserNavState {
  return {
    phase: "idle",
    tabId: null,
    url: null,
    generation: 0,
    message: "",
    canRetry: false,
  };
}

/**
 * Host events (commit/fail/blocked) are fenced by BOTH the navigation
 * generation and the tab id: a late commit for a superseded navigation,
 * or an event for another tab, is discarded by identity — the state
 * object is returned unchanged. A blocked request stays blocked even if
 * its commit event still arrives, because a blocked pane is no longer in
 * the loading phase the commit guard requires.
 */
export function applyBrowserNavAction(
  state: BrowserNavState,
  action: BrowserNavAction,
): BrowserNavState {
  switch (action.type) {
    case "reset":
      return initialBrowserNavState();
    case "navigate-started":
      return {
        phase: "loading",
        tabId: action.tabId,
        url: action.url,
        generation: action.generation,
        message: "",
        canRetry: false,
      };
    case "committed": {
      if (
        state.phase !== "loading" ||
        state.generation !== action.generation ||
        state.tabId !== action.tabId
      )
        return state;
      return {
        ...state,
        phase: "ready",
        url: action.url,
        message: "",
        canRetry: false,
      };
    }
    case "failed": {
      if (
        state.phase !== "loading" ||
        state.generation !== action.generation ||
        state.tabId !== action.tabId
      )
        return state;
      return {
        ...state,
        phase: "error",
        message: action.message,
        canRetry: true,
      };
    }
    case "blocked-by-policy": {
      if (
        state.phase !== "loading" ||
        state.generation !== action.generation ||
        state.tabId !== action.tabId
      )
        return state;
      // Policy refusal is authoritative: the URL must never load. Retry of
      // the same request is not offered (the policy will not change);
      // a different navigation needs a fresh generation via navigate-started.
      return {
        ...state,
        phase: "blocked",
        message: action.reason,
        canRetry: false,
      };
    }
    case "retry-started": {
      if (!state.canRetry) return state;
      return {
        ...state,
        phase: "loading",
        message: "",
        canRetry: false,
      };
    }
  }
}

export type BrowserNavDispatch = (action: BrowserNavAction) => void;

/**
 * The component's exact navigation-request pipeline, exported so tests can
 * drive it with deferred fakes instead of a real CDP/service transport.
 * Dispatches `navigate-started` with the request's generation fence first
 * so a hang is visible, then applies the service's decision — unless the
 * request was superseded (`isCurrent()` false), in which case the late
 * decision is dropped before it can reach the reducer.
 */
export function runNavigate(input: {
  tabId: string;
  url: string;
  generation: number;
  source: BrowserAuthoritySource;
  isCurrent: () => boolean;
  dispatch: BrowserNavDispatch;
}): Promise<void> {
  const { tabId, url, generation, source, isCurrent, dispatch } = input;
  dispatch({ type: "navigate-started", tabId, url, generation });
  return source.requestNavigation({ tabId, url, generation }).then(
    (result) => {
      if (!isCurrent()) return;
      if (!result.ok) {
        dispatch({
          type: "failed",
          tabId,
          generation,
          message: result.error.message,
        });
        return;
      }
      if (result.result.outcome === "block") {
        dispatch({
          type: "blocked-by-policy",
          tabId,
          url,
          generation,
          reason: result.result.reason,
        });
      }
      // An "allow" decision keeps the pane loading until the host's own
      // commit/fail event for this generation arrives.
    },
    (failure: unknown) => {
      if (!isCurrent()) return;
      dispatch({
        type: "failed",
        tabId,
        generation,
        message:
          failure instanceof Error
            ? failure.message
            : "The navigation request could not be delivered.",
      });
    },
  );
}

/**
 * The window-open pipeline: asks the authority source to adjudicate and
 * hands the verdict (or the transport failure) to the caller. The renderer
 * only ever renders or relays the decision — it never opens windows itself.
 */
export function requestWindowOpenDecision(input: {
  tabId: string;
  url: string;
  source: BrowserAuthoritySource;
  onDecision: (decision: WindowOpenDecision) => void;
  onError: (message: string) => void;
}): Promise<void> {
  return input.source.requestWindowOpen({ tabId: input.tabId, url: input.url }).then(
    (result) => {
      if (result.ok) {
        input.onDecision(result.result);
      } else {
        input.onError(result.error.message);
      }
    },
    (failure: unknown) => {
      input.onError(
        failure instanceof Error
          ? failure.message
          : "The window-open request could not be delivered.",
      );
    },
  );
}
