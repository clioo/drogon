import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { TitlebarLeftControls } from "./TitlebarLeftControls";

function render(props: {
  showSidebarToggle: boolean;
  showHistoryControls: boolean;
  floating?: boolean;
  canGoBack?: boolean;
}): string {
  return renderToString(
    createElement(TitlebarLeftControls, {
      canGoBack: props.canGoBack ?? false,
      canGoForward: false,
      showSidebarToggle: props.showSidebarToggle,
      showHistoryControls: props.showHistoryControls,
      floating: props.floating ?? false,
      backShortcutLabel: "x",
      forwardShortcutLabel: "y",
      toggleShortcutLabel: "z",
      onToggleSidebar: () => {},
      onGoBack: () => {},
      onGoForward: () => {},
    }),
  );
}

describe("TitlebarLeftControls chrome gates", () => {
  test("settings surfaces unmount the toggle and history pair", () => {
    const html = render({
      showSidebarToggle: false,
      showHistoryControls: false,
    });
    expect(html).not.toContain("Toggle sidebar");
    expect(html).not.toContain("Go back");
    expect(html).not.toContain("Go forward");
    expect(html).toContain("Drogon");
  });

  test("workspace surfaces keep toggle plus back/forward", () => {
    const html = render({
      showSidebarToggle: true,
      showHistoryControls: true,
    });
    expect(html).toContain('aria-label="Toggle sidebar"');
    expect(html).toContain('aria-label="Go back"');
    expect(html).toContain('aria-label="Go forward"');
  });

  test("collapsed sidebar shrink-wraps the cluster", () => {
    const floating = render({
      showSidebarToggle: true,
      showHistoryControls: true,
      floating: true,
    });
    expect(floating).toContain("w-max");
    const docked = render({
      showSidebarToggle: true,
      showHistoryControls: true,
      floating: false,
    });
    expect(docked).toContain("w-full");
  });
});
