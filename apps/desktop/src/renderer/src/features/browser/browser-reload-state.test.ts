// Reload control states: the button doubles as Stop mid-load and Retry
// after a failure; failed loads always retry (never plain-reload).
import { describe, expect, test } from "vitest";
import {
  browserReloadButtonLabel,
  resolveBrowserReloadButtonLabelKind,
  resolveBrowserReloadIntent,
} from "./browser-reload-state";

describe("browser reload states", () => {
  test("the toolbar button is Stop while loading", () => {
    expect(
      resolveBrowserReloadIntent("button", { loading: true, hasLoadError: false }),
    ).toBe("stop");
    expect(
      resolveBrowserReloadButtonLabelKind({ loading: true, hasLoadError: false }),
    ).toBe("stop");
    expect(browserReloadButtonLabel("stop")).toBe("Stop");
  });

  test("a failed load retries from every entry point", () => {
    for (const trigger of ["button", "reload", "hard-reload"] as const) {
      expect(
        resolveBrowserReloadIntent(trigger, { loading: false, hasLoadError: true }),
      ).toBe("retry-load");
    }
    expect(
      resolveBrowserReloadButtonLabelKind({ loading: false, hasLoadError: true }),
    ).toBe("retry");
    expect(browserReloadButtonLabel("retry")).toBe("Retry");
  });

  test("an idle page reloads, with hard reload behind the menu", () => {
    expect(
      resolveBrowserReloadIntent("button", { loading: false, hasLoadError: false }),
    ).toBe("reload");
    expect(
      resolveBrowserReloadIntent("reload", { loading: false, hasLoadError: false }),
    ).toBe("reload");
    expect(
      resolveBrowserReloadIntent("hard-reload", { loading: false, hasLoadError: false }),
    ).toBe("hard-reload");
    expect(
      resolveBrowserReloadButtonLabelKind({ loading: false, hasLoadError: false }),
    ).toBe("reload");
    expect(browserReloadButtonLabel("reload")).toBe("Reload");
  });

  test("loading wins over a stale error for the label", () => {
    expect(
      resolveBrowserReloadButtonLabelKind({ loading: true, hasLoadError: true }),
    ).toBe("stop");
  });
});
