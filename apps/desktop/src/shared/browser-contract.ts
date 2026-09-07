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
}

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
} as const;
