// OSC 8 hyperlinks (`ESC ] 8 ; ; <url> ST` — what agents, `gh` and `ls
// --hyperlink` emit) never reach the WebLinksAddon: xterm resolves them with
// its own OscLinkProvider, which falls back to a `confirm()` warning dialog
// and `window.open()` whenever the terminal carries no `linkHandler` (#600).
// Supplying one puts OSC 8 links under Drogon's routing, so they obey the
// same gesture rule as a plain-text URL: a click opens the system browser,
// Shift+click opens Drogon's browser pane.
//
// Unlike a regex-detected URL, an OSC 8 link's visible text is arbitrary —
// `click here` can point anywhere — so the hover callback states the real
// destination. That is the affordance the removed confirm dialog stood in
// for, and the reason this handler keeps its own protocol check.
import type { ILinkHandler } from "@xterm/xterm";
import { isExternalUrlAllowed } from "../../../../shared/shell-contract";
import {
  handleTerminalWebLinkClick,
  type TerminalWebLinkOpener,
} from "./terminal-web-link-click";

export type TerminalOscLinkHandlerDeps = {
  /** Routes the URL by gesture, exactly as the regex web-link path does. */
  openUrl: (
    url: string,
    event: Pick<MouseEvent, "shiftKey"> | undefined,
  ) => ReturnType<TerminalWebLinkOpener>;
  /** Plain-click popover requester, shared with the regex web-link path. */
  requestAction?: (event: MouseEvent, url: string) => boolean;
  clearSelection?: () => void;
  report?: (message: string) => void;
  /** Called with the real destination while the pointer rests on the link. */
  hover?: (url: string) => void;
  leave?: () => void;
};

export const TERMINAL_OSC_LINK_REFUSED_MESSAGE =
  "Refused to open a non-http(s) link.";

export function createTerminalOscLinkHandler(
  deps: TerminalOscLinkHandlerDeps,
): ILinkHandler {
  return {
    // Load-bearing: xterm's OscLinkProvider drops `javascript:`, `file:` and
    // every other scheme only while this stays false. `activate` and `hover`
    // re-check so flipping it could never hand a non-http URL to an opener.
    allowNonHttpProtocols: false,
    activate: (event, text) => {
      if (!isExternalUrlAllowed(text)) {
        deps.report?.(TERMINAL_OSC_LINK_REFUSED_MESSAGE);
        return;
      }
      handleTerminalWebLinkClick(text, event, {
        openUrl: (url) => deps.openUrl(url, event),
        requestAction: deps.requestAction
          ? (mouse) => deps.requestAction?.(mouse, text) ?? false
          : undefined,
        clearSelection: deps.clearSelection,
        report: deps.report,
      });
    },
    hover: (_event, text) => {
      if (!isExternalUrlAllowed(text)) return;
      deps.hover?.(text);
    },
    leave: () => deps.leave?.(),
  };
}
