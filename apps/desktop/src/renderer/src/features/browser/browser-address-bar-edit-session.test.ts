// Edit-session park/resume across address-bar remounts (tab switches).
import { describe, expect, test } from "vitest";
import {
  clearBrowserAddressBarEditSession,
  consumeBrowserAddressBarEditSession,
  saveBrowserAddressBarEditSession,
} from "./browser-address-bar-edit-session";

function session() {
  return {
    draft: "exam",
    selection: { start: 0, end: 4, direction: "forward" as const },
    suggestionsOpen: true,
    preview: null,
  };
}

describe("browser address-bar edit session", () => {
  test("a parked edit is consumed once, then gone", async () => {
    const saved = session();
    saveBrowserAddressBarEditSession("tab-1", saved);
    expect(consumeBrowserAddressBarEditSession("tab-1")).toEqual(saved);
    expect(consumeBrowserAddressBarEditSession("tab-1")).toBeNull();
    await Promise.resolve();
  });

  test("sessions are keyed by tab: one tab never resumes another's edit", async () => {
    saveBrowserAddressBarEditSession("tab-a", session());
    expect(consumeBrowserAddressBarEditSession("tab-b")).toBeNull();
    expect(consumeBrowserAddressBarEditSession("tab-a")).not.toBeNull();
    await Promise.resolve();
  });

  test("a parked preview keeps the typed query for Escape", async () => {
    saveBrowserAddressBarEditSession("tab-2", {
      ...session(),
      draft: "https://example.test/full",
      preview: { typedQuery: "exam", previewedUrl: "https://example.test/full" },
    });
    expect(consumeBrowserAddressBarEditSession("tab-2")?.preview).toEqual({
      typedQuery: "exam",
      previewedUrl: "https://example.test/full",
    });
    await Promise.resolve();
  });

  test("clear drops the parked edit", async () => {
    saveBrowserAddressBarEditSession("tab-3", session());
    clearBrowserAddressBarEditSession("tab-3");
    expect(consumeBrowserAddressBarEditSession("tab-3")).toBeNull();
    await Promise.resolve();
  });

  test("a parked edit expires on the microtask when no remount claims it", async () => {
    saveBrowserAddressBarEditSession("tab-4", session());
    // The expiry is a real queueMicrotask: flushing microtasks expires it.
    await Promise.resolve();
    await Promise.resolve();
    expect(consumeBrowserAddressBarEditSession("tab-4")).toBeNull();
  });
});
