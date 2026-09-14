// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { MentuRuntimeInfo } from "../../../../shared/mentu-contract";
import {
  MentuRuntimeSetting,
  type MentuSettingsBridge,
} from "./mentu-runtime-setting";

const missingRuntime: MentuRuntimeInfo = {
  available: false,
  path: null,
  version: null,
  expectedRevision: "revision",
  expectedSha256: "a".repeat(64),
  actualSha256: null,
  lockMatches: false,
  message: "not installed",
};
const installedRuntime: MentuRuntimeInfo = {
  ...missingRuntime,
  available: true,
  path: "/fixture/mentu-recipes",
  version: "0.5.0",
  actualSha256: "a".repeat(64),
  lockMatches: true,
  message: null,
};
const unusableRuntime: MentuRuntimeInfo = {
  ...installedRuntime,
  available: false,
  message: "The installed Mentu runtime could not be started on this host.",
};

afterEach(cleanup);

describe("Mentu optional runtime setting", () => {
  test("is absent off macOS and performs no probe", () => {
    const bridge: MentuSettingsBridge = {
      mentuRuntime: vi.fn(),
      mentuInstall: vi.fn(),
    };
    const { container } = render(
      <MentuRuntimeSetting bridge={bridge} isMac={false} />,
    );
    expect(container.innerHTML).toBe("");
    expect(bridge.mentuRuntime).not.toHaveBeenCalled();
  });

  test("does not offer installation when the host cannot run the pinned runtime", async () => {
    const bridge: MentuSettingsBridge = {
      mentuRuntime: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "mentu_runtime_unsupported",
          message: "The optional Mentu runtime is available only on Apple silicon Macs.",
          retryable: false,
        },
      })),
      mentuInstall: vi.fn(),
    };
    render(<MentuRuntimeSetting bridge={bridge} isMac />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The optional Mentu runtime is available only on Apple silicon Macs.",
    );
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(bridge.mentuInstall).not.toHaveBeenCalled();
  });

  test("does not offer a reinstall when the locked binary cannot start", async () => {
    const bridge: MentuSettingsBridge = {
      mentuRuntime: vi.fn(async () => ({
        ok: true as const,
        result: { runtime: unusableRuntime },
      })),
      mentuInstall: vi.fn(),
    };
    render(<MentuRuntimeSetting bridge={bridge} isMac />);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The installed Mentu runtime could not be started on this host.",
    );
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(bridge.mentuInstall).not.toHaveBeenCalled();
  });

  test("shows installed state without offering another install", async () => {
    const bridge: MentuSettingsBridge = {
      mentuRuntime: vi.fn(async () => ({
        ok: true as const,
        result: { runtime: installedRuntime },
      })),
      mentuInstall: vi.fn(),
    };
    render(<MentuRuntimeSetting bridge={bridge} isMac />);

    expect(await screen.findByText("Installed")).toBeTruthy();
    expect(screen.getByText("Installed · 0.5.0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(bridge.mentuInstall).not.toHaveBeenCalled();
  });

  test("installs only after the user chooses Install", async () => {
    const bridge: MentuSettingsBridge = {
      mentuRuntime: vi.fn(async () => ({
        ok: true as const,
        result: { runtime: missingRuntime },
      })),
      mentuInstall: vi.fn(async () => ({
        ok: true as const,
        result: { runtime: installedRuntime },
      })),
    };
    render(<MentuRuntimeSetting bridge={bridge} isMac />);

    const install = await screen.findByRole("button", { name: "Install" });
    expect(bridge.mentuInstall).not.toHaveBeenCalled();
    fireEvent.click(install);
    expect(await screen.findByText("Installed · 0.5.0")).toBeTruthy();
    expect(bridge.mentuInstall).toHaveBeenCalledTimes(1);
  });

  test("keeps a failed install retryable and announces the error", async () => {
    const install = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "mentu_download_failed",
          message: "The download is temporarily unavailable.",
          retryable: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        result: { runtime: installedRuntime },
      });
    const bridge: MentuSettingsBridge = {
      mentuRuntime: vi.fn(async () => ({
        ok: true as const,
        result: { runtime: missingRuntime },
      })),
      mentuInstall: install,
    };
    render(<MentuRuntimeSetting bridge={bridge} isMac />);

    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The download is temporarily unavailable.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(install).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Installed · 0.5.0")).toBeTruthy();
  });
});
