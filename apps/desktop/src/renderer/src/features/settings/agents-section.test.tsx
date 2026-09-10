// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Source behaviors: AgentsPane, AgentDefaultSetting, AgentCatalogRow and launch editors.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "../../components/ui/tooltip";
import { AGENT_SETTINGS_DEFAULTS, type AgentSettings, type AgentSettingsUpdate } from "../../../../shared/agent-settings-contract";
import { AgentsSection } from "./agents-section";
import { agentSettingsState } from "./agent-settings-state";
import { AgentDefaultArgsInput, AgentCommandOverrideInput, AgentDefaultEnvInput } from "./AgentLaunchDefaultsEditor";

const original = window.drogon;
let settings: AgentSettings;
let update: ReturnType<typeof vi.fn>;
const harnesses = [
  { harnessId: "pi" as const, displayName: "Pi", availability: "available" as const, executable: "/fixture/pi" },
  { harnessId: "claude" as const, displayName: "Claude Code", availability: "available" as const, executable: "/fixture/claude" },
];
beforeEach(async () => {
  settings = structuredClone(AGENT_SETTINGS_DEFAULTS);
  update = vi.fn(async ({ updates }: { updates: AgentSettingsUpdate }) => {
    settings = { ...settings, ...updates } as AgentSettings;
    return { ok: true, result: { settings, initialized: true } };
  });
  window.drogon = { ...original, harnesses: vi.fn(async () => ({ ok: true, result: { hostId: "fixture", harnesses } })),
    agentSettings: { get: vi.fn(async () => ({ ok: true, result: { settings, initialized: true } })), update },
    usage: { snapshot: vi.fn(async () => ({ ok: true, result: { awake: { mode: "off", active: false, supported: true } } })), setAwake: vi.fn() },
  } as unknown as typeof window.drogon;
  await agentSettingsState.load();
});
afterEach(() => { cleanup(); window.drogon = original; });
function mount(overrides?: { capabilityAvailable?: boolean }) {
  return render(<TooltipProvider><AgentsSection harnesses={harnesses} defaultHarnessId="" harnessDefaults={{}} onDefaultHarnessChange={() => {}} onHarnessDefaultChange={() => {}} capabilityAvailable={overrides?.capabilityAvailable} /></TooltipProvider>);
}

// User-feature-closure item 7: an old daemon missing agent.settings.v1
// (crates/drogon-core/src/lib.rs's CAPABILITIES) must not have this panel
// silently claim full functionality -- it previously had no capability
// awareness at all. `capabilityAvailable` defaults to true (omitted prop =
// legacy callers/tests keep compiling unchanged) so only an explicit false
// -- App.tsx wiring isAgentSettingsAvailable(liveCapabilities) -- shows the
// notice; it never blocks rendering (a stale/local view of settings is
// still useful) and never triggers a restart on its own.
describe("agent.settings.v1 mixed-version guard", () => {
  test("shows no capability notice once the daemon advertises the capability", async () => {
    mount();
    await screen.findByText("2 detected");
    expect(screen.queryByText(/agent settings/i, { selector: "[role=status]" })).toBeNull();
  });

  test("shows a non-blocking notice, and the panel still renders, when the daemon withholds agent.settings.v1", async () => {
    mount({ capabilityAvailable: false });
    await screen.findByText("2 detected");
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/restart/i);
    expect(screen.getByRole("status").textContent).not.toMatch(/restart the app/i);
    expect(screen.getByRole("status").textContent).toContain("stops every session");
    // The fieldset (and its controls) still render -- a capability gap is
    // surfaced, not a reason to hide the panel.
    expect(screen.getByRole("button", { name: "Auto" }).closest("fieldset")?.disabled).toBe(true);
  });
});
describe("source Agents pane", () => {
  test("source order, copy and detected-only default pills replace the synthetic model form", async () => {
    mount();
    await screen.findByText("2 detected");
    expect(screen.getByText("Manage AI agents, set a default, and customize commands.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Auto" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["Default Agent", "Prompt Cache Timer", "Agent Permissions", "Installed2 detected", "Available to install3 agents"]);
    expect(screen.queryByLabelText("Pi model")).toBeNull();
    expect(screen.getByRole("button", { name: "No agent (blank terminal)" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Agent status hooks" }).getAttribute("aria-checked")).toBe("true");
  });
  test("default Auto, blank and explicit selection use distinct persisted values", async () => {
    mount();
    for (const [name, value] of [["No agent (blank terminal)", "blank"], ["Pi", "pi"], ["Auto", null]] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(update).toHaveBeenLastCalledWith({ updates: { defaultTuiAgent: value } }));
    }
  });
  test("status hooks, titles and cache switches persist through the native settings seam", async () => {
    mount();
    for (const [label, field, value] of [["Agent status hooks", "agentStatusHooksEnabled", false], ["Auto-generate tab titles", "tabAutoGenerateTitle", true], ["Cache Timer", "promptCacheTimerEnabled", true]] as const) {
      fireEvent.click(screen.getByRole("switch", { name: label }));
      await waitFor(() => expect(update).toHaveBeenLastCalledWith({ updates: { [field]: value } }));
    }
    expect(await screen.findByRole("combobox", { name: "Timer Duration" })).toBeTruthy();
  });
  test("availability uses the source segmented control and persists disabled IDs", async () => {
    mount();
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Pi availability" })).getByRole("radio", { name: "Disabled" }));
    await waitFor(() => expect(update).toHaveBeenLastCalledWith({ updates: { disabledTuiAgents: ["pi"] } }));
    expect(screen.queryByRole("button", { name: "Pi" })).toBeNull();
  });
  test("refresh re-runs real host detection, and failure keeps the Retry path", async () => {
    mount();
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(false));
    vi.mocked(window.drogon.harnesses).mockRejectedValueOnce(new Error("unreachable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Couldn’t detect installed agents. Check the host connection and try again.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
  });
  test("save failures show an error, not a successfully toggled preference", async () => {
    mount();
    update.mockResolvedValueOnce({ ok: false, error: { message: "Read-only settings directory", code: "io_error", retryable: false } });
    fireEvent.click(screen.getByRole("switch", { name: "Auto-generate tab titles" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Read-only settings directoryRetry");
    expect(screen.getByRole("switch", { name: "Auto-generate tab titles" }).getAttribute("aria-checked")).toBe("false");
  });
});
describe("source launch editors", () => {
  test("command commits on blur and resets to the default binary", () => {
    const save = vi.fn();
    render(<AgentCommandOverrideInput defaultCmd="pi" cmdOverride="/old/pi" onSaveOverride={save} />);
    const input = screen.getByRole("textbox", { name: "Command" });
    fireEvent.change(input, { target: { value: " /fixture/pi " } }); fireEvent.blur(input);
    expect(save).toHaveBeenLastCalledWith("/fixture/pi");
    fireEvent.click(screen.getByRole("button", { name: "Reset" })); expect(save).toHaveBeenLastCalledWith("");
  });
  test("Escape discards edits without saving the stale draft or closing Settings", () => {
    const save = vi.fn(); const close = vi.fn();
    render(<div onKeyDown={close}><AgentDefaultArgsInput defaultArgs="" argsOverride="--thinking high" onSaveArgs={save} /></div>);
    const input = screen.getByRole("textbox", { name: "Arguments" });
    input.focus(); fireEvent.change(input, { target: { value: "--thinking low" } }); fireEvent.keyDown(input, { key: "Escape" });
    expect(save).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
    expect(input).toHaveProperty("value", "--thinking high");
  });
  test("oversized environment text refuses a save", () => {
    const save = vi.fn();
    render(<AgentDefaultEnvInput defaultEnv={{}} envOverride={{}} onSaveEnv={save} />);
    const input = screen.getByRole("textbox", { name: "Environment" });
    fireEvent.change(input, { target: { value: "A=" + "x".repeat(8192) } }); fireEvent.blur(input);
    expect(save).not.toHaveBeenCalled(); expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "A=fixture B=2" } }); fireEvent.blur(input);
    expect(save).toHaveBeenCalledWith({ A: "fixture", B: "2" });
  });
});
