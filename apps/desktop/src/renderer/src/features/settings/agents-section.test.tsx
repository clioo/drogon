// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   #221: the Settings → Agents Pi model row shows the fork's helper copy
   with the documented example, and an unmappable value surfaces the
   fork's error without saving. */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Harness } from "../../../../shared/session-contract";
import type { HarnessAgentDefault } from "../../settings-store";
import { PI_MODEL_ERROR, PI_MODEL_EXAMPLE } from "../shell/pi-model-mapping";
import { AgentsSection } from "./agents-section";

afterEach(cleanup);

const harnesses: Harness[] = [
  { harnessId: "pi", displayName: "Pi", availability: "available", executable: "/opt/pi" },
  { harnessId: "claude", displayName: "Claude Code", availability: "available", executable: "/opt/claude" },
];

function mount(onHarnessDefaultChange: (harnessId: string, next: HarnessAgentDefault) => void) {
  return render(
    <AgentsSection
      harnesses={harnesses}
      defaultHarnessId=""
      onDefaultHarnessChange={() => {}}
      harnessDefaults={{}}
      onHarnessDefaultChange={onHarnessDefaultChange}
    />,
  );
}

describe("AgentsSection Pi model (#221)", () => {
  test("the Pi row shows the fork's helper with the documented example", () => {
    mount(() => {});
    expect(document.body.textContent).toContain(PI_MODEL_EXAMPLE);
    expect(document.body.textContent).toContain(
      "Use an exact Pi provider/model ID",
    );
  });

  test("an unmappable Pi model shows the fork's error and does not save", () => {
    const onHarnessDefaultChange = vi.fn();
    mount(onHarnessDefaultChange);
    fireEvent.change(screen.getByLabelText("Pi model"), {
      target: { value: "has spaces" },
    });
    expect(screen.getByText(PI_MODEL_ERROR)).toBeTruthy();
    expect(onHarnessDefaultChange).not.toHaveBeenCalled();
  });

  test("provider/model and bare ids save for Pi", () => {
    const onHarnessDefaultChange = vi.fn();
    mount(onHarnessDefaultChange);
    fireEvent.change(screen.getByLabelText("Pi model"), {
      target: { value: PI_MODEL_EXAMPLE },
    });
    expect(onHarnessDefaultChange).toHaveBeenCalledWith("pi", {
      model: PI_MODEL_EXAMPLE,
      effort: "",
      permissionMode: "inherit",
    });
  });
});
