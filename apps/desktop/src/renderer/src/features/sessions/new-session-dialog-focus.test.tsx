// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NewSessionDialog } from "./NewSessionDialog";
import type { Harness } from "../../../../shared/session-contract";

afterEach(cleanup);

const harnesses: Harness[] = [
  {
    harnessId: "pi",
    displayName: "Pi",
    availability: "available",
    executable: "/usr/local/bin/pi",
  },
];

describe("New session dialog focus", () => {
  it("autofocuses the name input on open", async () => {
    render(
      <NewSessionDialog
        harnesses={harnesses}
        defaultHarnessId="pi"
        onClose={vi.fn()}
        onCreate={async () => null}
      />,
    );
    const nameInput = await screen.findByLabelText("Name (optional)");
    expect(document.activeElement).toBe(nameInput);
  });
});
