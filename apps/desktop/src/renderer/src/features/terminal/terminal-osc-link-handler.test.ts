// @vitest-environment jsdom
// Tests for #600: a terminal link click must open a browser, never xterm's
// "could potentially be dangerous" confirm dialog. The second half drives a
// real `Terminal` through xterm's own OscLinkProvider, because the defect was
// never in a pure function — it was the missing `linkHandler` option.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import type { ILink, ILinkProvider } from "@xterm/xterm";
import {
  createTerminalOscLinkHandler,
  normalizedTerminalHttpUrl,
  TERMINAL_OSC_LINK_REFUSED_MESSAGE,
} from "./terminal-osc-link-handler";
import { terminalHttpLinkClickDestination } from "./terminal-http-link-destinations";

const URL_UNDER_TEST = "https://github.com/clioo/drogon/issues/599";

function mouse(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    button: 0,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    preventDefault: () => {},
    ...overrides,
  } as MouseEvent;
}

const range = { start: { x: 1, y: 1 }, end: { x: 4, y: 1 } };

describe("createTerminalOscLinkHandler", () => {
  it("keeps xterm's non-http filter on, which is what drops javascript: links", () => {
    const handler = createTerminalOscLinkHandler({
      openUrl: async () => ({ ok: true as const }),
    });
    expect(handler.allowNonHttpProtocols).toBe(false);
  });

  it("opens a plain click and tells the opener no Shift was held", async () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    const handler = createTerminalOscLinkHandler({ openUrl });
    handler.activate(mouse(), URL_UNDER_TEST, range);
    await Promise.resolve();
    expect(openUrl).toHaveBeenCalledTimes(1);
    const [url, event] = openUrl.mock.calls[0] as unknown as [
      string,
      MouseEvent | undefined,
    ];
    expect(url).toBe(URL_UNDER_TEST);
    expect(terminalHttpLinkClickDestination(event?.shiftKey)).toBe("system");
  });

  it("routes a Shift+click to Drogon's browser", async () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    const handler = createTerminalOscLinkHandler({ openUrl });
    handler.activate(mouse({ shiftKey: true }), URL_UNDER_TEST, range);
    await Promise.resolve();
    const [, event] = openUrl.mock.calls[0] as unknown as [
      string,
      MouseEvent | undefined,
    ];
    expect(terminalHttpLinkClickDestination(event?.shiftKey)).toBe("drogon");
  });

  it("clears the selection so the click does not leave a drag behind", () => {
    const clearSelection = vi.fn();
    const handler = createTerminalOscLinkHandler({
      openUrl: async () => ({ ok: true as const }),
      clearSelection,
    });
    handler.activate(mouse(), URL_UNDER_TEST, range);
    expect(clearSelection).toHaveBeenCalled();
  });

  it("refuses a non-http destination even if xterm's filter were flipped", () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    const report = vi.fn();
    const handler = createTerminalOscLinkHandler({ openUrl, report });
    for (const hostile of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
      "not a url",
    ]) {
      handler.activate(mouse(), hostile, range);
    }
    expect(openUrl).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(TERMINAL_OSC_LINK_REFUSED_MESSAGE);
  });

  it("ignores gestures the terminal does not own", () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    const requestAction = vi.fn(() => true);
    const leave = vi.fn();
    const handler = createTerminalOscLinkHandler({
      openUrl,
      requestAction,
      leave,
    });
    // Right click belongs to the context menu, Alt+drag is column select,
    // and middle click is the X11 paste gesture.
    handler.activate(mouse({ button: 2 }), URL_UNDER_TEST, range);
    handler.activate(mouse({ altKey: true }), URL_UNDER_TEST, range);
    handler.activate(mouse({ button: 1 }), URL_UNDER_TEST, range);
    handler.activate(undefined as unknown as MouseEvent, URL_UNDER_TEST, range);
    expect(openUrl).not.toHaveBeenCalled();
    expect(requestAction).not.toHaveBeenCalled();
    // An unowned gesture leaves the pointer where it was, tooltip included.
    expect(leave).not.toHaveBeenCalled();
  });

  it("reports an opener failure instead of failing silently", async () => {
    const report = vi.fn();
    const handler = createTerminalOscLinkHandler({
      openUrl: async () => ({ ok: false as const, message: "no workspace" }),
      report,
    });
    handler.activate(mouse(), URL_UNDER_TEST, range);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(report).toHaveBeenCalledWith("no workspace");
  });

  it("reports a rejected opener instead of leaving an unhandled rejection", async () => {
    const report = vi.fn();
    const handler = createTerminalOscLinkHandler({
      openUrl: () => Promise.reject(new Error("bridge gone")),
      report,
    });
    handler.activate(mouse(), URL_UNDER_TEST, range);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(report).toHaveBeenCalledWith("The link could not be opened.");
  });

  it("dismisses the hover tooltip once the click has opened the link", () => {
    const leave = vi.fn();
    const handler = createTerminalOscLinkHandler({
      openUrl: async () => ({ ok: true as const }),
      leave,
    });
    // Opening the system browser takes focus away, so xterm never fires
    // `leave` of its own accord and the tooltip would sit there.
    handler.activate(mouse(), URL_UNDER_TEST, range);
    expect(leave).toHaveBeenCalled();
  });

  it("strips the padding an OSC 8 URI may carry before opening it", async () => {
    const openUrl = vi.fn(async (_url: string) => ({ ok: true as const }));
    const hover = vi.fn();
    const handler = createTerminalOscLinkHandler({ openUrl, hover });
    const padded = `  ${URL_UNDER_TEST}  `;
    // `new URL` tolerates the padding, so an untrimmed URI would reach
    // shell.openExternal verbatim.
    handler.activate(mouse(), padded, range);
    handler.hover?.(mouse(), padded, range);
    await Promise.resolve();
    expect(openUrl.mock.calls[0]?.[0]).toBe(URL_UNDER_TEST);
    expect(hover).toHaveBeenCalledWith(URL_UNDER_TEST);
  });

  it("normalizes only http(s) URLs", () => {
    expect(normalizedTerminalHttpUrl("https://example.com")).toBe(
      "https://example.com/",
    );
    expect(normalizedTerminalHttpUrl("HTTP://Example.COM/A")).toBe(
      "http://example.com/A",
    );
    expect(normalizedTerminalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(normalizedTerminalHttpUrl("")).toBeNull();
  });

  it("names the real destination on hover and clears it on leave", () => {
    const hover = vi.fn();
    const leave = vi.fn();
    const handler = createTerminalOscLinkHandler({
      openUrl: async () => ({ ok: true as const }),
      hover,
      leave,
    });
    // OSC 8 link text is arbitrary, so the URL is the only honest hint.
    handler.hover?.(mouse(), URL_UNDER_TEST, range);
    expect(hover).toHaveBeenCalledWith(URL_UNDER_TEST);
    handler.hover?.(mouse(), "javascript:alert(1)", range);
    expect(hover).toHaveBeenCalledTimes(1);
    handler.leave?.(mouse(), URL_UNDER_TEST, range);
    expect(leave).toHaveBeenCalled();
  });
});

// --- xterm's own OSC 8 path -------------------------------------------------

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** An OSC 8 hyperlink whose visible text is not the URL, as agents emit. */
function osc8(url: string, label = "issue 599"): string {
  return `${ESC}]8;;${url}${BEL}${label}${ESC}]8;;${BEL}`;
}

type LinkifierInternals = {
  _core?: {
    linkifier?: {
      _linkProviderService?: { linkProviders?: ILinkProvider[] };
    };
  };
};

/** Every link xterm's registered providers resolve on `row` (1-based). */
function linksOnRow(terminal: Terminal, row: number): ILink[] {
  const providers = (terminal as unknown as LinkifierInternals)._core?.linkifier
    ?._linkProviderService?.linkProviders;
  if (!providers?.length) {
    throw new Error(
      "xterm's link providers are unreachable — its internals moved",
    );
  }
  const found: ILink[] = [];
  for (const provider of providers) {
    provider.provideLinks(row, (links) => {
      if (links) found.push(...links);
    });
  }
  return found;
}

describe("xterm OSC 8 hyperlinks", () => {
  let terminal: Terminal | null = null;
  let host: HTMLDivElement | null = null;
  let confirmSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // xterm reads the device pixel ratio through matchMedia on open().
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
    confirmSpy = vi.fn(() => true);
    (globalThis as unknown as { confirm: unknown }).confirm = confirmSpy;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    terminal?.dispose();
    terminal = null;
    host?.remove();
    host = null;
    // The suite shares one jsdom window across files, so a stub left here
    // becomes another file's environment.
    delete (window as Partial<Window & { matchMedia: unknown }>).matchMedia;
    delete (globalThis as Partial<typeof globalThis & { confirm: unknown }>)
      .confirm;
  });

  async function openTerminal(data: string): Promise<Terminal> {
    const term = new Terminal({ allowProposedApi: true });
    terminal = term;
    term.open(host!);
    await new Promise<void>((resolve) => term.write(data, () => resolve()));
    return term;
  }

  it("reproduces #600: with no linkHandler xterm raises its warning dialog", async () => {
    const term = await openTerminal(osc8(URL_UNDER_TEST));
    const links = linksOnRow(term, 1);
    expect(links.map((link) => link.text)).toContain(URL_UNDER_TEST);
    links[0].activate(mouse(), links[0].text);
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("could potentially be dangerous"),
    );
  });

  it("opens the system browser on a click, with no dialog", async () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    const term = await openTerminal(osc8(URL_UNDER_TEST));
    // Assigned after construction, exactly as TerminalPane does it: xterm
    // reads the option when it resolves a link, not when it is created.
    term.options.linkHandler = createTerminalOscLinkHandler({ openUrl });
    const links = linksOnRow(term, 1);
    links[0].activate(mouse(), links[0].text);
    await Promise.resolve();
    expect(confirmSpy).not.toHaveBeenCalled();
    const [url, event] = openUrl.mock.calls[0] as unknown as [
      string,
      MouseEvent | undefined,
    ];
    expect(url).toBe(URL_UNDER_TEST);
    expect(terminalHttpLinkClickDestination(event?.shiftKey)).toBe("system");
  });

  it("opens Drogon's browser on Shift+click, with no dialog", async () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    const term = await openTerminal(osc8(URL_UNDER_TEST));
    term.options.linkHandler = createTerminalOscLinkHandler({ openUrl });
    const links = linksOnRow(term, 1);
    links[0].activate(mouse({ shiftKey: true }), links[0].text);
    await Promise.resolve();
    expect(confirmSpy).not.toHaveBeenCalled();
    const [, event] = openUrl.mock.calls[0] as unknown as [
      string,
      MouseEvent | undefined,
    ];
    expect(terminalHttpLinkClickDestination(event?.shiftKey)).toBe("drogon");
  });

  it("never linkifies a javascript: hyperlink", async () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    const term = await openTerminal(osc8("javascript:alert(1)", "click here"));
    term.options.linkHandler = createTerminalOscLinkHandler({ openUrl });
    expect(linksOnRow(term, 1)).toEqual([]);
    expect(openUrl).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("bakes the handler into a link when it resolves it, so the option must be set first", async () => {
    const openUrl = vi.fn(async () => ({ ok: true as const }));
    const term = await openTerminal(osc8(URL_UNDER_TEST));
    // Resolve while no handler is set, as a pane that assigned the option
    // after its first write would. The stale link keeps xterm's dialog even
    // once the handler arrives — which is why TerminalPane assigns the
    // option before `terminal.open()`.
    const stale = linksOnRow(term, 1);
    term.options.linkHandler = createTerminalOscLinkHandler({ openUrl });
    stale[0].activate(mouse(), stale[0].text);
    expect(confirmSpy).toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
    // Anything resolved after the assignment routes normally.
    confirmSpy.mockClear();
    linksOnRow(term, 1)[0].activate(mouse(), URL_UNDER_TEST);
    await Promise.resolve();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it("hands the hover the URL, not the link's visible text", async () => {
    const hover = vi.fn();
    const term = await openTerminal(osc8(URL_UNDER_TEST, "click here"));
    term.options.linkHandler = createTerminalOscLinkHandler({
      openUrl: async () => ({ ok: true as const }),
      hover,
    });
    const links = linksOnRow(term, 1);
    links[0].hover?.(mouse(), links[0].text);
    expect(hover).toHaveBeenCalledWith(URL_UNDER_TEST);
  });
});
