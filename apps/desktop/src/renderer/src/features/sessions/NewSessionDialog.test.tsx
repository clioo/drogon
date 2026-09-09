// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { NewSessionDialog } from "./NewSessionDialog";
import type { Harness } from "../../../../shared/session-contract";

installRadixJsdomStubs();
afterEach(cleanup);
const pi: Harness = {
  harnessId: "pi",
  displayName: "Pi",
  executable: "/bin/pi",
  availability: "available",
};
const codex: Harness = { ...pi, harnessId: "codex", displayName: "Codex" };
const props = () => ({
  harnesses: [pi, codex],
  defaultHarnessId: "pi",
  onClose: vi.fn(),
  onCreate: vi.fn(async () => null as string | null),
});

test("starts the chosen enabled harness without a project picker", async () => {
  const input = props();
  render(<NewSessionDialog {...input} />);
  expect(screen.queryByRole("combobox", { name: "Project" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
  fireEvent.change(screen.getByLabelText("Name (optional)"), {
    target: { value: "Research" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  await waitFor(() =>
    expect(input.onCreate).toHaveBeenCalledWith("Research", "codex"),
  );
  await waitFor(() => expect(input.onClose).toHaveBeenCalledOnce());
});

test("waits for a usable catalog and adopts its default", () => {
  const input = props();
  const view = render(<NewSessionDialog {...input} harnesses={[]} />);
  expect(
    screen
      .getByRole("button", { name: "Start session" })
      .hasAttribute("disabled"),
  ).toBe(true);
  view.rerender(<NewSessionDialog {...input} />);
  expect(
    (screen.getByRole("radio", { name: "Pi" }) as HTMLInputElement).checked,
  ).toBe(true);
});

test("does not expose missing or unsupported launchers", () => {
  render(
    <NewSessionDialog
      {...props()}
      harnesses={[
        { ...pi, availability: "missing" },
        { ...codex, availability: "unsupported_launcher" },
      ]}
    />,
  );
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  expect(
    screen
      .getByRole("button", { name: "Start session" })
      .hasAttribute("disabled"),
  ).toBe(true);
});

test("repairs a pick removed from the enabled catalog", () => {
  const input = props();
  const view = render(<NewSessionDialog {...input} />);
  fireEvent.click(screen.getByRole("radio", { name: "Codex" }));
  view.rerender(<NewSessionDialog {...input} harnesses={[pi]} />);
  expect(screen.queryByRole("radio", { name: "Codex" })).toBeNull();
  expect(
    (screen.getByRole("radio", { name: "Pi" }) as HTMLInputElement).checked,
  ).toBe(true);
});

test("keeps the form open on a launch failure, and allows retry", async () => {
  const input = props();
  input.onCreate.mockResolvedValueOnce("Harness could not start");
  render(<NewSessionDialog {...input} />);
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  await screen.findByRole("alert");
  expect(input.onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start session" }));
  await waitFor(() => expect(input.onClose).toHaveBeenCalledOnce());
});

test("cancel does not create any session", () => {
  const input = props();
  render(<NewSessionDialog {...input} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(input.onCreate).not.toHaveBeenCalled();
});
