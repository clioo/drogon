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
  /**
   * The link-action popover, shared with the regex web-link path so both
   * kinds of http link stay identical. No gesture reaches it today: the
   * owner's 2026-09-10 rule made every owned click a direct open, and
   * `handleTerminalWebLinkClick` tests that first. It is wired so that
   * relaxing that rule restores the popover for OSC 8 links too.
   */
  requestAction?: (event: MouseEvent, url: string) => boolean;
  clearSelection?: () => void;
  report?: (message: string) => void;
  /** Called with the real destination while the pointer rests on the link. */
  hover?: (url: string) => void;
  leave?: () => void;
};

export const TERMINAL_OSC_LINK_REFUSED_MESSAGE =
  "Refused to open a non-http(s) link.";

/**
 * The URL an OSC 8 link actually opens, or null when it is not http(s).
 *
 * The escape sequence carries its URI verbatim, so `  https://example.com  `
 * reaches us padded — and `new URL` accepts that, which would otherwise hand
 * the padding straight to `shell.openExternal`. Normalising here also keeps
 * the hover tooltip and the opened URL the same string, which is the whole
 * point of naming the destination, and matches what the regex path already
 * does (`extractTerminalHttpLinks` yields `parsed.toString()`).
 */
export function normalizedTerminalHttpUrl(text: string): string | null {
  // `isExternalUrlAllowed` parses before it answers, so this cannot throw.
  if (!isExternalUrlAllowed(text)) return null;
  return new URL(text).toString();
}

export function createTerminalOscLinkHandler(
  deps: TerminalOscLinkHandlerDeps,
): ILinkHandler {
  const { requestAction } = deps;
  return {
    // Load-bearing: xterm's OscLinkProvider drops `javascript:`, `file:` and
    // every other scheme only while this stays false. `activate` and `hover`
    // re-check so flipping it could never hand a non-http URL to an opener.
    allowNonHttpProtocols: false,
    activate: (event, text) => {
      const url = normalizedTerminalHttpUrl(text);
      if (!url) {
        deps.report?.(TERMINAL_OSC_LINK_REFUSED_MESSAGE);
        return;
      }
      const handled = handleTerminalWebLinkClick(url, event, {
        openUrl: (linkUrl) => deps.openUrl(linkUrl, event),
        requestAction: requestAction
          ? (mouse) => requestAction(mouse, url)
          : undefined,
        clearSelection: deps.clearSelection,
        report: deps.report,
      });
      // The gesture is spent, so the "click to open" hint has nothing left to
      // offer. xterm only fires `leave` on pointer movement, and a click that
      // hands focus to a browser produces none, so the tooltip would sit over
      // the terminal until the pointer happened to cross the link again.
      if (handled) deps.leave?.();
    },
    hover: (_event, text) => {
      const url = normalizedTerminalHttpUrl(text);
      if (url) deps.hover?.(url);
    },
    leave: () => deps.leave?.(),
  };
}
