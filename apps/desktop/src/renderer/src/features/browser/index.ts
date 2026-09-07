export type {
  BrowserAuthoritySource,
  NavDecision,
} from "./browser-authority-source";
export type { BrowserTabDescriptor } from "./browser-tab";
export {
  applyBrowserNavAction,
  initialBrowserNavState,
  requestWindowOpenDecision,
  runNavigate,
  type BrowserNavAction,
  type BrowserNavDispatch,
  type BrowserNavState,
} from "./browser-nav-state";
export {
  classifyWindowOpenRequest,
  type WindowOpenDecision,
  type WindowOpenOutcome,
} from "./window-open-authority";
