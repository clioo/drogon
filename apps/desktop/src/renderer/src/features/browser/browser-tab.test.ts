import { describe, expect, test } from "vitest";
import type { BrowserTabDescriptor } from "./browser-tab";

describe("BrowserTabDescriptor", () => {
  test("descriptors carry exactly the service-projected identity fields", () => {
    const tab: BrowserTabDescriptor = {
      tabId: "tab-7",
      url: "https://example.test",
      title: "Example",
    };
    expect(Object.keys(tab).sort()).toEqual(["tabId", "title", "url"]);
  });
});
