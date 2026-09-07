/**
 * One browser tab as projected by the injected authority source. The
 * renderer only ever displays descriptors the service granted; it never
 * constructs tabs for URLs it has not been shown.
 */
export interface BrowserTabDescriptor {
  tabId: string;
  url: string;
  title: string;
}
