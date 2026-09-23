// @vitest-environment jsdom
// #600 wiring, proved against the real TerminalPane rather than the handler
// alone: a URL an agent printed as an OSC 8 hyperlink must open a browser on
// click, never xterm's "could potentially be dangerous" confirm, and the
// hover tooltip must not outlive the pane.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import type { Session } from "../../../../shared/session-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { TerminalPane } from "./TerminalPane";
import { TooltipProvider } from "../../components/ui/tooltip";

installRadixJsdomStubs();

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const URL_UNDER_TEST = "https://github.com/clioo/drogon/issues/599";
/** A hyperlink whose visible text is not the URL, as agents emit. */
const OSC8_LINE = `${ESC}]8;;${URL_UNDER_TEST}${BEL}issue 599${ESC}]8;;${BEL}`;

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-600",
    workspaceId: "workspace-600",
    hostId: "host-600",
    incarnation: "incarnation-1",
    command: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    verdict: "live",
    exitCode: null,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

type LinkifierInternals = {
  _core?: {
    linkifier?: {
      _linkProviderService?: { linkProviders?: ILinkProvider[] };
    };
  };
};

function liveTerminal(): Terminal {
  const registry = (
    window as unknown as { __drogonTerminals?: Map<string, Terminal> }
  ).__drogonTerminals;
  const terminal = registry ? [...registry.values()][0] : undefined;
  if (!terminal) throw new Error("TerminalPane registered no live terminal");
  return terminal;
}

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

function click(overrides: Partial<MouseEvent> = {}): MouseEvent {
  return {
    button: 0,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    clientX: 10,
    clientY: 10,
    preventDefault: () => {},
    ...overrides,
  } as MouseEvent;
}

describe("TerminalPane link routing (#600)", () => {
  let confirmSpy: ReturnType<typeof vi.fn>;
  let externalUrls: string[];
  let browserTabs: string[];
  let onExternal: (event: Event) => void;

  beforeEach(() => {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
    confirmSpy = vi.fn(() => true);
    (globalThis as unknown as { confirm: unknown }).confirm = confirmSpy;
    externalUrls = [];
    browserTabs = [];
    // App owns the system-browser listener; mirror it so a click is followed
    // all the way to the shell bridge request rather than stopping at xterm.
    onExternal = (event: Event) => {
      externalUrls.push(
        String((event as CustomEvent<{ url: unknown }>).detail?.url),
      );
    };
    window.addEventListener("drogon:open-external-url", onExternal);
    (window as unknown as { drogon: unknown }).drogon = {
      // A daemon with no output-push capability, so the pane stays on the
      // poll path and this test exercises links rather than the transport.
      status: async () => ({ ok: true, result: { capabilities: [] } }),
      read: async () => ({
        ok: true,
        result: { data: "", nextCursor: 0, truncated: false },
      }),
      write: async () => ({ ok: true, result: { written: true } }),
      resize: async () => ({ ok: true, result: { resized: true } }),
      workspaces: async () => ({ ok: true, result: { workspaces: [] } }),
      browser: {
        createTab: async (input: { url: string }) => {
          browserTabs.push(input.url);
          return { ok: true, result: { tabId: "tab-1" } };
        },
      },
    };
  });

  afterEach(() => {
    window.removeEventListener("drogon:open-external-url", onExternal);
    cleanup();
    vi.restoreAllMocks();
    // The suite shares one jsdom window across files, so a stub left here
    // becomes another file's environment.
    delete (window as Partial<Window & { drogon: unknown }>).drogon;
    delete (window as Partial<Window & { matchMedia: unknown }>).matchMedia;
    delete (globalThis as Partial<typeof globalThis & { confirm: unknown }>)
      .confirm;
  });

  async function mountWithLink(): Promise<{
    terminal: Terminal;
    link: ILink;
    unmount: () => void;
  }> {
    const view = render(
      <TooltipProvider>
        <TerminalPane
          session={session()}
          fontSize={12}
          onError={() => {}}
          onSession={() => {}}
          onFocus={() => {}}
        />
      </TooltipProvider>,
    );
    const terminal = liveTerminal();
    await new Promise<void>((resolve) =>
      terminal.write(OSC8_LINE, () => resolve()),
    );
    const links = linksOnRow(terminal, 1);
    const link = links.find((candidate) => candidate.text === URL_UNDER_TEST);
    if (!link) {
      throw new Error("the pane never linkified the OSC 8 hyperlink");
    }
    return { terminal, link, unmount: view.unmount };
  }

  it("opens the system browser on a plain click, with no confirm dialog", async () => {
    const { link, unmount } = await mountWithLink();
    link.activate(click(), link.text);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(externalUrls).toEqual([URL_UNDER_TEST]);
    expect(browserTabs).toEqual([]);
    unmount();
  });

  it("opens Drogon's browser on Shift+click, with no confirm dialog", async () => {
    const { link, unmount } = await mountWithLink();
    link.activate(click({ shiftKey: true }), link.text);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(browserTabs).toEqual([URL_UNDER_TEST]);
    expect(externalUrls).toEqual([]);
    unmount();
  });

  it("names the real destination on hover and drops the tooltip on click", async () => {
    const { link, unmount } = await mountWithLink();
    const tooltip = () =>
      document.querySelector(".pane-link-tooltip")?.textContent ?? null;
    act(() => link.hover?.(click(), link.text));
    expect(tooltip()).toContain(URL_UNDER_TEST);
    // The label read "issue 599"; the tooltip is the only honest destination.
    expect(tooltip()).not.toContain("issue 599");
    act(() => link.activate(click(), link.text));
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Opening the browser takes focus, so xterm fires no `leave` of its own.
    expect(tooltip()).toBeNull();
    unmount();
  });

  it("clears the tooltip when the pane goes away", async () => {
    const { link, unmount } = await mountWithLink();
    act(() => link.hover?.(click(), link.text));
    expect(document.querySelector(".pane-link-tooltip")).not.toBeNull();
    act(() => unmount());
    expect(document.querySelector(".pane-link-tooltip")).toBeNull();
  });
});
