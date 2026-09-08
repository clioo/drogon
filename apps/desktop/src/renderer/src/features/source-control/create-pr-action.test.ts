// #136: the toolbar Create-PR rule, adapted from the fork's
// primary-create-pr-intent-action.ts to the daemon's upstream status.
import { describe, expect, test } from "vitest";
import { resolveCreatePrToolbarAction } from "./create-pr-action";

describe("resolveCreatePrToolbarAction", () => {
  test("enables Create PR when the branch is ahead of its upstream", () => {
    expect(
      resolveCreatePrToolbarAction({
        busy: false,
        upstream: "origin/main",
        ahead: 2,
        hasUncommitted: false,
      }),
    ).toEqual({
      label: "Create PR",
      title: "Create a pull request for this branch",
      disabled: false,
    });
  });

  test("disables while a commit or remote operation is in flight", () => {
    const action = resolveCreatePrToolbarAction({
      busy: true,
      upstream: "origin/main",
      ahead: 2,
      hasUncommitted: false,
    });
    expect(action.label).toBe("Create PR");
    expect(action.disabled).toBe(true);
    expect(action.title).toBe("Wait for the remote operation to finish.");
  });

  test("disables without an upstream", () => {
    const action = resolveCreatePrToolbarAction({
      busy: false,
      upstream: null,
      ahead: null,
      hasUncommitted: false,
    });
    expect(action.disabled).toBe(true);
    expect(action.title).toBe("Publish commits before creating a pull request.");
  });

  test("disables with uncommitted changes", () => {
    const action = resolveCreatePrToolbarAction({
      busy: false,
      upstream: "origin/main",
      ahead: 2,
      hasUncommitted: true,
    });
    expect(action.disabled).toBe(true);
    expect(action.title).toBe("Commit changes before creating a pull request.");
  });

  test("disables when there is nothing to propose", () => {
    for (const ahead of [0, null]) {
      const action = resolveCreatePrToolbarAction({
        busy: false,
        upstream: "origin/main",
        ahead,
        hasUncommitted: false,
      });
      expect(action.disabled).toBe(true);
      expect(action.title).toBe("Push commits before creating a pull request.");
    }
  });
});
