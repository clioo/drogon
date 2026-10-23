// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Remove-dialog copy and gating: the source's RemoveFolderDialog reports
   no worktree/session counts and refuses nothing, so the dialog must
   promise registration-only removal with no counts. Radix portals dialog
   content to document.body, so this mounts under jsdom (the repo's
   radix-jsdom-stubs pattern) instead of SSR: SSR never includes portal
   content. */
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Project } from "../../../../shared/session-contract";
import { getRemoveProjectDialogCopy } from "./remove-project-dialog-copy";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

afterEach(cleanup);

function project(): Project {
  return {
    id: "p1",
    hostId: "h1",
    path: "/work/drogon",
    name: "drogon",
    kind: "git",
    defaultBaseRef: null,
  };
}

function mount(
  overrides: Partial<Parameters<typeof RemoveProjectDialog>[0]> = {},
) {
  return render(
    <RemoveProjectDialog
      project={project()}
      disabled={false}
      onSubmit={async () => null}
      onClose={() => {}}
      {...overrides}
    />,
  );
}

describe("getRemoveProjectDialogCopy", () => {
  test("promises registration-only removal, never files, with no counts", () => {
    const copy = getRemoveProjectDialogCopy("drogon");
    expect(copy.title).toBe("Remove Project");
    expect(copy.targetLabel).toBe("drogon");
    expect(copy.targetClassName).toBe(
      "break-all font-medium text-foreground",
    );
    expect(
      `${copy.descriptionBeforeName}${copy.targetLabel}${copy.descriptionAfterName}`,
    ).toBe("This only removes drogon from Drogon. It is still on your disk.");
    expect(copy.cancelLabel).toBe("Cancel");
    expect(copy.confirmLabel).toBe("Remove");
  });
});

describe("RemoveProjectDialog", () => {
  test("renders the source DOM, classes, copy and buttons", () => {
    mount();
    expect(
      document.querySelector('[data-slot="dialog-content"]'),
    ).toBeTruthy();
    expect(screen.getByText("Remove Project")).toBeTruthy();
    const description = document.querySelector(
      '[data-slot="dialog-description"]',
    );
    expect(description?.textContent).toBe(
      "This only removes drogon from Drogon. It is still on your disk.",
    );
    const name = description?.querySelector("span");
    expect(name?.textContent).toBe("drogon");
    expect(name?.className).toContain("break-all font-medium text-foreground");
    expect(screen.getByText("Cancel")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
    // No counts anywhere: the source reports none.
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\d+ worktree/i);
    expect(body).not.toMatch(/\d+ session/i);
  });

  test("Remove is destructive, Cancel is outline", () => {
    mount();
    const buttons = Array.from(
      document.querySelectorAll('[data-slot="dialog-footer"] button'),
    );
    const byText = (label: string) =>
      buttons.find((button) => button.textContent === label);
    expect(byText("Remove")?.getAttribute("data-variant")).toBe(
      "destructive",
    );
    expect(byText("Cancel")?.getAttribute("data-variant")).toBe("outline");
  });

  test("a submit failure shows verbatim, the dialog stays open", async () => {
    mount({ onSubmit: async () => "project not found" });
    fireEvent.click(screen.getByText("Remove"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("project not found");
    expect(
      document.querySelector('[data-slot="dialog-content"]'),
    ).toBeTruthy();
  });
});

describe("RemoveProjectDialog terminal evidence (issue #621 shape)", () => {
  const provenLive =
    "This project still has running terminals, so nothing was removed — still live: s-1. Delete with force to stop them first.";

  test("the force checkbox is sent with the removal", async () => {
    const calls: Array<{ id: string; force: boolean }> = [];
    mount({
      onSubmit: async (project, force) => {
        calls.push({ id: project.id, force });
        return null;
      },
    });
    fireEvent.click(
      screen.getByLabelText(/Also stop terminals running in this project/),
    );
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls).toEqual([{ id: "p1", force: true }]);
  });

  test("an unforced removal sends force=false", async () => {
    const calls: Array<{ id: string; force: boolean }> = [];
    mount({
      onSubmit: async (project, force) => {
        calls.push({ id: project.id, force });
        return null;
      },
    });
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls).toEqual([{ id: "p1", force: false }]);
  });

  test("a proven-live refusal offers the force retry and re-submits with force", async () => {
    const calls: Array<{ id: string; force: boolean }> = [];
    mount({
      onSubmit: async (project, force) => {
        calls.push({ id: project.id, force });
        return force ? null : provenLive;
      },
    });
    fireEvent.click(screen.getByText("Remove"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(provenLive);
    const retry = await screen.findByText("Stop terminals and remove");
    fireEvent.click(retry);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      { id: "p1", force: false },
      { id: "p1", force: true },
    ]);
  });

  test("a failure that force cannot clear offers no retry", async () => {
    mount({
      onSubmit: async () => "Drogon could not confirm every terminal has exited",
    });
    fireEvent.click(screen.getByText("Remove"));
    await screen.findByRole("alert");
    expect(screen.queryByText("Stop terminals and remove")).toBeNull();
  });

  test("a Chat has no force checkbox: its copy already promises stopping", () => {
    const chat: Project = {
      ...project(),
      id: "p2",
      name: "Quick Session",
      kind: "folder",
      quickSession: true,
    };
    mount({ project: chat });
    expect(
      screen.queryByLabelText(/Also stop terminals running in this project/),
    ).toBeNull();
  });
});
