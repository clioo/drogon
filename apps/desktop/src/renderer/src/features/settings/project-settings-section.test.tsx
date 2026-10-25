// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { ProjectSettingsSection } from "./project-settings-section";
import type { Project } from "../../../../shared/session-contract";

afterEach(cleanup);

const project: Project = {
  id: "p1",
  hostId: "h1",
  path: "/tmp/repo",
  name: "repo",
  kind: "git",
  defaultBaseRef: null,
  setupScript: "pnpm install",
};

describe("Project Settings setup script", () => {
  it("marks the setup script textarea as code, not prose", () => {
    render(
      <TooltipProvider>
        <ProjectSettingsSection
          project={project}
          onRemoveProject={vi.fn(async () => null)}
          onUpdateSetupScript={vi.fn(async () => null)}
        />
      </TooltipProvider>,
    );
    // Why (source SetupScriptPromptCardViews): shell commands get red
    // underlines when spellchecked — identifiers, not prose.
    const script = screen.getByLabelText(
      "Setup script",
    ) as HTMLTextAreaElement;
    expect(script.getAttribute("spellcheck")).toBe("false");
  });
});

describe("Project Settings removal and running terminals", () => {
  const provenLive =
    "This project still has running terminals, so nothing was removed — still live: s-1. Delete with force to stop them first.";

  it("arms a force removal after a proven-live refusal, and shows why", async () => {
    const calls: Array<{ id: string; force: boolean }> = [];
    const onRemoveProject = vi.fn(
      async (id: string, force: boolean): Promise<string | null> => {
        calls.push({ id, force });
        return force ? null : provenLive;
      },
    );
    render(
      <TooltipProvider>
        <ProjectSettingsSection
          project={project}
          onRemoveProject={onRemoveProject}
          onUpdateSetupScript={vi.fn(async () => null)}
        />
      </TooltipProvider>,
    );

    const remove = screen.getByRole("button", { name: "Remove Project" });
    remove.focus();
    fireEvent.click(remove);
    // Confirm: unforced, so the daemon refuses and names the terminals.
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm Remove Project" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(provenLive);
    // The armed label says exactly what the next click will do.
    fireEvent.click(
      screen.getByRole("button", { name: "Stop terminals and remove" }),
    );
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls).toEqual([
      { id: "p1", force: false },
      { id: "p1", force: true },
    ]);
  });
});
