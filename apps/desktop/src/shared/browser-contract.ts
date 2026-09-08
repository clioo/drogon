import { z } from "zod";
import type { Result } from "./session-contract";

/** Local Electron capability marker for the embedded browser pane. */
export const BROWSER_CAPABILITY = "browser.v1";

export const MAX_BROWSER_URL_CHARS = 2_048;
export const MAX_BROWSER_TITLE_CHARS = 256;
export const MAX_BROWSER_SNAPSHOT_CHARS = 32_768;
export const MAX_BROWSER_TABS = 16;

const tabId = z.string().min(1).max(128);
const urlInput = z.string().min(1).max(MAX_BROWSER_URL_CHARS);
const workspaceId = z.string().min(1).max(256);

export const browserBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
});
export type BrowserBounds = z.infer<typeof browserBoundsSchema>;

export const browserCreateTabSchema = z.object({
  workspaceId,
  url: urlInput.optional(),
});
export type BrowserCreateTabInput = z.infer<typeof browserCreateTabSchema>;

export const browserTabRefSchema = z.object({ tabId });
export type BrowserTabRef = z.infer<typeof browserTabRefSchema>;

export const browserNavigateSchema = z.object({ tabId, url: urlInput });
export type BrowserNavigateInput = z.infer<typeof browserNavigateSchema>;

export const browserSetBoundsSchema = z.object({
  tabId: tabId.optional(),
  bounds: browserBoundsSchema,
});
export type BrowserSetBoundsInput = z.infer<typeof browserSetBoundsSchema>;

export type BrowserTabState = {
  tabId: string;
  workspaceId: string;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Honest failure text when the last navigation failed or was blocked. */
  error: string | null;
  /**
   * Additive (R11-B chrome): structured load-failure detail behind `error`.
   * `kind` mirrors the host verdict — `blocked` for policy refusals, `failed`
   * for guest load errors. Absent on older hosts; the pane falls back to
   * parsing `error`.
   */
  loadError?: { kind: "blocked" | "failed"; code: number | null; description: string; url: string } | null;
  /**
   * Additive (R11-B chrome): true once a page committed in this tab. Fresh
   * tabs and failed navigations show DOM states; committed pages stay
   * visible under the guest while reloading.
   */
  committed?: boolean;
  /** Additive (R11-B chrome): page zoom as a percentage (100 is default). */
  zoomPercent?: number;
};

/** Additive (R11-B chrome): one guest find-in-page request. */
export const browserFindInPageSchema = z.object({
  tabId,
  query: z.string().min(1).max(2_048),
  forward: z.boolean().optional(),
  findNext: z.boolean().optional(),
});
export type BrowserFindInPageInput = z.infer<typeof browserFindInPageSchema>;

/** Additive (R11-B chrome): guest `found-in-page` result forwarded to the pane. */
export type BrowserFindResultEvent = {
  tabId: string;
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
};

/** Additive (R11-B chrome): guest `context-menu` params forwarded to the pane. */
export type BrowserContextMenuEvent = {
  tabId: string;
  /** Renderer-window CSS px of the click (main offsets the guest coords). */
  x: number;
  y: number;
  linkUrl: string;
  pageUrl: string;
  selectionText: string;
};

export type BrowserStateEvent = {
  tabs: BrowserTabState[];
  activeTabId: string | null;
};

/** Bounded page snapshot for future agent/CLI use (DOM text + title + url). */
export type BrowserSnapshot = {
  tabId: string;
  url: string;
  title: string;
  text: string;
  truncated: boolean;
};

/** Additive (R12-E): pane chords forwarded while the guest has focus. */
export type BrowserPaneChord = "focus-address-bar" | "reload" | "find";

/** Additive (R12-E): one guest-captured pane chord, forwarded by main. */
export type BrowserChordEvent = {
  tabId: string;
  chord: BrowserPaneChord;
};

export interface BrowserBridge {
  createTab(input: BrowserCreateTabInput): Promise<Result<BrowserTabState>>;
  closeTab(input: BrowserTabRef): Promise<Result<null>>;
  navigate(input: BrowserNavigateInput): Promise<Result<BrowserTabState>>;
  back(input: BrowserTabRef): Promise<Result<BrowserTabState>>;
  forward(input: BrowserTabRef): Promise<Result<BrowserTabState>>;
  reload(input: BrowserTabRef): Promise<Result<BrowserTabState>>;
  stop(input: BrowserTabRef): Promise<Result<BrowserTabState>>;
  setBounds(input: BrowserSetBoundsInput): Promise<Result<null>>;
  snapshot(input: BrowserTabRef): Promise<Result<BrowserSnapshot>>;
  onState(listener: (event: BrowserStateEvent) => void): () => void;
  /** Additive (R11-B chrome): reload ignoring the cache (right-click menu). */
  hardReload(input: BrowserTabRef): Promise<Result<BrowserTabState>>;
  /** Additive (R11-B chrome): page zoom steps around the 100 default. */
  zoomIn(input: BrowserTabRef): Promise<Result<BrowserTabState>>;
  zoomOut(input: BrowserTabRef): Promise<Result<BrowserTabState>>;
  zoomReset(input: BrowserTabRef): Promise<Result<BrowserTabState>>;
  /** Additive (R11-B chrome): guest findInPage; matches arrive via onFindResult. */
  findInPage(input: BrowserFindInPageInput): Promise<Result<null>>;
  /** Additive (R11-B chrome): clears the guest find selection. */
  stopFind(input: BrowserTabRef): Promise<Result<null>>;
  /** Additive (R11-B chrome): opens the guest devtools (context menu). */
  openDevTools(input: BrowserTabRef): Promise<Result<null>>;
  /** Additive (R11-B chrome): guest found-in-page results for the find bar. */
  onFindResult(listener: (event: BrowserFindResultEvent) => void): () => void;
  /** Additive (R11-B chrome): guest context-menu requests for the page menu. */
  onContextMenu(listener: (event: BrowserContextMenuEvent) => void): () => void;
  /** Additive (R12-E): pane chords captured from the focused guest webContents. */
  onChord(listener: (event: BrowserChordEvent) => void): () => void;
}

/**
 * Daemon-mediated desktop command relay (`browser.relay.v1`, journeys
 * J3/J4). Additive: nothing above changes. The daemon enqueues one command
 * per `browser.*` CLI call; the desktop long-polls `desktop.commands.poll`,
 * executes against the browser host, and reports `desktop.commands.complete`.
 */
export const BROWSER_RELAY_CAPABILITY = "browser.relay.v1";
export const MAX_BROWSER_SELECTOR_CHARS = 1_024;
export const MAX_BROWSER_FILL_TEXT_CHARS = 8_192;

const selectorInput = z.string().min(1).max(MAX_BROWSER_SELECTOR_CHARS);

export const browserRelayOpenParamsSchema = z.object({
  workspaceId,
  url: urlInput.optional(),
});
export type BrowserRelayOpenParams = z.infer<typeof browserRelayOpenParamsSchema>;

export const browserRelayTabParamsSchema = browserTabRefSchema;

export const browserRelayClickParamsSchema = z.object({
  tabId,
  selector: selectorInput,
});
export type BrowserRelayClickParams = z.infer<typeof browserRelayClickParamsSchema>;

export const browserRelayFillParamsSchema = z.object({
  tabId,
  selector: selectorInput,
  text: z.string().max(MAX_BROWSER_FILL_TEXT_CHARS),
});
export type BrowserRelayFillParams = z.infer<typeof browserRelayFillParamsSchema>;

export const browserRelayTabsParamsSchema = z.object({ workspaceId });
export type BrowserRelayTabsParams = z.infer<typeof browserRelayTabsParamsSchema>;

export const relayCommandKinds = [
  "browser.open",
  "browser.navigate",
  "browser.snapshot",
  "browser.click",
  "browser.fill",
  "browser.tabs",
] as const;
export type RelayCommandKind = (typeof relayCommandKinds)[number];

export const relayCommandSchema = z.object({
  commandId: z.string().min(1).max(128),
  kind: z.enum(relayCommandKinds),
  params: z.record(z.string(), z.unknown()),
});
export type RelayCommand = z.infer<typeof relayCommandSchema>;

export const relayPollResultSchema = z.object({
  commands: z.array(relayCommandSchema),
});
export type RelayPollResult = z.infer<typeof relayPollResultSchema>;

export const relayCompleteErrorSchema = z.object({
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2_048),
});
export type RelayCompleteError = z.infer<typeof relayCompleteErrorSchema>;

export const relayTabsResultSchema = z.object({
  tabs: z.array(
    z.object({
      tabId: z.string(),
      workspaceId: z.string(),
      url: z.string(),
      title: z.string(),
      loading: z.boolean(),
      canGoBack: z.boolean(),
      canGoForward: z.boolean(),
      error: z.string().nullable(),
    }),
  ),
});
export type RelayTabsResult = z.infer<typeof relayTabsResultSchema>;

export const browserIpcChannels = {
  createTab: "drogon:browserCreateTab",
  closeTab: "drogon:browserCloseTab",
  navigate: "drogon:browserNavigate",
  back: "drogon:browserBack",
  forward: "drogon:browserForward",
  reload: "drogon:browserReload",
  stop: "drogon:browserStop",
  setBounds: "drogon:browserSetBounds",
  snapshot: "drogon:browserSnapshot",
  state: "drogon:browserState",
  hardReload: "drogon:browserHardReload",
  zoomIn: "drogon:browserZoomIn",
  zoomOut: "drogon:browserZoomOut",
  zoomReset: "drogon:browserZoomReset",
  findInPage: "drogon:browserFindInPage",
  stopFind: "drogon:browserStopFind",
  openDevTools: "drogon:browserOpenDevTools",
  findResult: "drogon:browserFindResult",
  contextMenu: "drogon:browserContextMenu",
  chord: "drogon:browserChord",
} as const;
