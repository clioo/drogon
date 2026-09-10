// @vitest-environment jsdom
/* C04 identity editor interaction tests: current values hydrate the
 * form, the save carries the read identity version as
 * expectedIdentityVersion (with user provenance), blank names and
 * no-op saves are blocked, and busy/error/conflict states render. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BotIdentityEditor } from "./BotIdentityEditor";
import type { BotIdentitySaveRequest } from "./BotIdentityEditor";

afterEach(cleanup);

function setup(
  overrides: Partial<Parameters<typeof BotIdentityEditor>[0]> = {},
) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <BotIdentityEditor
      botId="bot-1"
      identityVersion={6}
      identity={{
        displayName: "Arya",
        handle: "arya",
        title: "Scout",
        instructions: "Guard the realm.",
      }}
      busy={false}
      error={null}
      conflict={null}
      onSave={onSave}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSave, onCancel, ...utils };
}

describe("BotIdentityEditor", () => {
  it("hydrates the form from the bot's current identity", () => {
    setup();
    expect(
      (screen.getByTestId("bot-identity-name") as HTMLInputElement).value,
    ).toBe("Arya");
    expect((screen.getByLabelText("Handle") as HTMLInputElement).value).toBe(
      "arya",
    );
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe(
      "Scout",
    );
    expect(
      (screen.getByLabelText("Purpose") as HTMLTextAreaElement).value,
    ).toBe("Guard the realm.");
  });

  it("saves with the read identity version and user provenance", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByTestId("bot-identity-name"), {
      target: { value: "Arya Stark" },
    });
    fireEvent.click(screen.getByTestId("bot-identity-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const request = onSave.mock.calls[0][0] as BotIdentitySaveRequest;
    expect(request).toMatchObject({
      botId: "bot-1",
      expectedIdentityVersion: 6,
      provenance: { origin: "user" },
      displayIdentity: {
        displayName: "Arya Stark",
        handle: "arya",
        title: "Scout",
      },
      instructions: "Guard the realm.",
    });
    expect(request.requestId).toBe(request.provenance.requestId);
  });

  it("blocks an empty name instead of firing an invalid request", () => {
    const { onSave } = setup();
    const save = screen.getByTestId("bot-identity-save") as HTMLButtonElement;
    const name = screen.getByTestId("bot-identity-name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Arya Stark" } });
    expect(save.disabled).toBe(false);
    fireEvent.change(name, { target: { value: "   " } });
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    fireEvent.submit(screen.getByTestId("bot-identity-editor"));
    expect(onSave).not.toHaveBeenCalled();
  });

  it("disables save until something actually changes", () => {
    const { onSave } = setup();
    const save = screen.getByTestId("bot-identity-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Purpose"), {
      target: { value: "New purpose." },
    });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("shows the saving state and disables the controls while busy", () => {
    setup({ busy: true });
    expect(screen.getByText("Saving…")).toBeTruthy();
    expect(
      (screen.getByTestId("bot-identity-save") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByText("Cancel") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("renders the error alert and the structured conflict", () => {
    setup({ error: "Identity store unavailable." });
    const alert = screen.getByTestId("bot-identity-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Identity store unavailable.");
    cleanup();
    setup({
      conflict: { expectedVersion: 6, currentVersion: 7 },
    });
    const banner = screen.getByTestId("bot-identity-conflict");
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain("you expected version 6");
    expect(banner.textContent).toContain("now version 7");
  });

  it("cancels through the caller", () => {
    const { onCancel } = setup();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
