// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
          onRemoveProject={vi.fn()}
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
