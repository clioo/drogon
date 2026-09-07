import { describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  DROGON_REPO_URL,
  GitHubStarButton,
  openRepoUrl,
  windowShellOpenExternal,
} from "./github-star";

describe("GitHubStarButton", () => {
  test("renders the source label with no network", () => {
    const html = renderToString(createElement(GitHubStarButton, {}));
    expect(html).toContain("Star on GitHub");
  });

  test("opens the repo URL through the injected seam", async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);
    await openRepoUrl(openExternal);
    expect(openExternal).toHaveBeenCalledWith(DROGON_REPO_URL);
    expect(DROGON_REPO_URL).toBe("https://github.com/clioo/drogon");
  });

  test("missing bridge resolves to a no-op, never a throw", async () => {
    expect(windowShellOpenExternal(undefined)).toBe(null);
    expect(windowShellOpenExternal(null)).toBe(null);
    expect(windowShellOpenExternal({})).toBe(null);
    await openRepoUrl(null);
    await openRepoUrl(undefined);
  });
});
