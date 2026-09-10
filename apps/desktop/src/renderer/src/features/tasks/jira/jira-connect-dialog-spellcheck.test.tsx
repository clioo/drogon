// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TaskPageJiraConnectDialog } from "./jira-connect-dialog";
import type { JiraBridge } from "../../../../../shared/jira-contract";

afterEach(cleanup);

const bridge = {
  jiraConnect: vi.fn(async () => ({ ok: true as const, result: null })),
} as unknown as JiraBridge;

describe("Jira connect dialog inputs", () => {
  it("marks the URL/identity fields as identifiers, not prose", async () => {
    render(
      <TaskPageJiraConnectDialog
        bridge={bridge}
        open
        onOpenChange={vi.fn()}
      />,
    );
    // Why: site URLs and usernames/emails get red underlines when
    // spellchecked — identifiers, not prose.
    const url = (await screen.findByPlaceholderText(
      "https://example.atlassian.net",
    )) as HTMLInputElement;
    expect(url.getAttribute("spellcheck")).toBe("false");
    const email = (await screen.findByPlaceholderText(
      "you@example.com",
    )) as HTMLInputElement;
    expect(email.getAttribute("spellcheck")).toBe("false");
  });
});
