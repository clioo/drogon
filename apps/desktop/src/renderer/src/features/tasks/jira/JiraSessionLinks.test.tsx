// @vitest-environment jsdom
// C06: JiraSessionLinks renders DISTINCT actionable states — live,
// unverifiable, exited and no-session rows, plus the read-path notices
// where an unavailable connection and a confirmed deletion are different
// banners with different actions. Pure jsdom: callbacks are props, no
// bridge, daemon or network.
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JiraSessionLinks, type JiraSessionLinkView } from "./JiraSessionLinks";

afterEach(() => cleanup());

function view(overrides: Partial<JiraSessionLinkView> = {}): JiraSessionLinkView {
  return {
    linkKey: "inst:10001",
    identity: {
      instanceId: "inst",
      instanceUrl: "https://acme.atlassian.net",
      issueId: "10001",
      key: "DROG-42",
    },
    worktreeId: "wt-1",
    worktreeTitle: "DROG-42 Fix the flux capacitor",
    workspaceId: "ws-1",
    sessionId: "s-1",
    sessionState: "live",
    ...overrides,
  };
}

describe("JiraSessionLinks", () => {
  test("renders the empty hint when nothing is linked", () => {
    render(
      <JiraSessionLinks
        links={[]}
        notice={null}
        onResume={vi.fn()}
        onOpenIssue={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );
    expect(screen.getByText(/No linked sessions yet/i)).toBeTruthy();
  });

  test("live rows open the session; exited rows reopen", () => {
    const onResume = vi.fn();
    render(
      <JiraSessionLinks
        links={[
          view({ sessionState: "live" }),
          view({ linkKey: "inst:10002", sessionState: "exited" }),
        ]}
        notice={null}
        onResume={onResume}
        onOpenIssue={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("Exited")).toBeTruthy();
    expect(screen.getByText("Open session")).toBeTruthy();
    expect(screen.getByText("Reopen session")).toBeTruthy();
    fireEvent.click(screen.getByText("Reopen session"));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume.mock.calls[0][0].sessionState).toBe("exited");
  });

  test("unverifiable and no-session rows get their own actions", () => {
    render(
      <JiraSessionLinks
        links={[
          view({ linkKey: "k-u", sessionState: "unverifiable" }),
          view({ linkKey: "k-n", sessionState: "no-session", sessionId: null }),
        ]}
        notice={null}
        onResume={vi.fn()}
        onOpenIssue={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );
    expect(screen.getByText("Unverifiable")).toBeTruthy();
    expect(screen.getByText("No session")).toBeTruthy();
    expect(screen.getByText("Reconnect to verify")).toBeTruthy();
    expect(screen.getByText("New session")).toBeTruthy();
  });

  test("an unresolved legacy row says so instead of guessing", () => {
    render(
      <JiraSessionLinks
        links={[view({ identity: null })]}
        notice={null}
        onResume={vi.fn()}
        onOpenIssue={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );
    expect(screen.getByText("Unresolved link")).toBeTruthy();
  });

  test("connection-unavailable and issue-deleted are different notices", () => {
    const { rerender } = render(
      <JiraSessionLinks
        links={[view()]}
        notice="connection-unavailable"
        onResume={vi.fn()}
        onOpenIssue={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/connection is unavailable/i),
    ).toBeTruthy();
    expect(screen.queryByText(/confirmed deleted/i)).toBeNull();
    rerender(
      <JiraSessionLinks
        links={[view()]}
        notice="issue-deleted"
        onResume={vi.fn()}
        onOpenIssue={vi.fn()}
        onUnlink={vi.fn()}
      />,
    );
    expect(screen.getByText(/confirmed deleted/i)).toBeTruthy();
  });

  test("unlink keeps resources and is labelled as such", () => {
    const onUnlink = vi.fn();
    render(
      <JiraSessionLinks
        links={[view()]}
        notice={null}
        onResume={vi.fn()}
        onOpenIssue={vi.fn()}
        onUnlink={onUnlink}
      />,
    );
    fireEvent.click(screen.getByLabelText("Unlink session"));
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });
});
