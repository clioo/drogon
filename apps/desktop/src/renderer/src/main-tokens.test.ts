// Pins the design tokens of both color schemes against the Orca source values,
// mirroring the reference asset tests (src/renderer/src/assets/*.test.ts):
// parse apps/desktop/src/renderer/src/assets/main.css text and assert the
// `:root` (light) and `.dark` token blocks byte-for-byte.
// Ported token values: MIT Copyright (c) 2026 Lovecast Inc.
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const mainCss = fs.readFileSync(
  new URL("./assets/main.css", import.meta.url),
  "utf8",
);

/** Extract `name: value;` pairs from the first CSS block named by selector. */
function tokenBlock(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing ${selector} block`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const end = css.indexOf("\n}", open);
  const body = css
    .slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = new Map<string, string>();
  let acc = "";
  for (const raw of body.split("\n")) {
    acc += `\n${raw}`;
    if (!acc.trim().endsWith(";")) continue; // multi-line declaration
    const match = acc.match(/^\s*(--[a-z0-9-]+):\s*([\s\S]+);\s*$/);
    if (match) tokens.set(match[1], match[2].trim());
    acc = "";
  }
  return tokens;
}

const light = () => tokenBlock(mainCss, ":root");
const dark = () => tokenBlock(mainCss, ".dark");

describe("main.css design tokens (orca-drogon fidelity)", () => {
  it("light scheme carries the source :root values", () => {
    const t = light();
    expect(t.get("--app-font-family")).toBe(
      "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    );
    expect(t.get("--font-sans")).toBe("var(--app-font-family)");
    expect(t.get("--font-mono")).toBe(
      "'SF Mono', SFMono-Regular, ui-monospace, 'Cascadia Code', Menlo, Consolas, 'Liberation Mono',\n    monospace",
    );
    expect(t.get("--radius")).toBe("0.625rem");
    expect(t.get("--background")).toBe("#fff");
    expect(t.get("--foreground")).toBe("#0a0a0a");
    expect(t.get("--editor-surface")).toBe("#ffffff");
    expect(t.get("--card")).toBe("#fff");
    expect(t.get("--card-foreground")).toBe("#0a0a0a");
    expect(t.get("--popover")).toBe("#fff");
    expect(t.get("--popover-foreground")).toBe("#0a0a0a");
    expect(t.get("--primary")).toBe("#171717");
    expect(t.get("--primary-foreground")).toBe("#fafafa");
    expect(t.get("--secondary")).toBe("#f5f5f5");
    expect(t.get("--secondary-foreground")).toBe("#171717");
    expect(t.get("--muted")).toBe("#f5f5f5");
    expect(t.get("--muted-foreground")).toBe("#737373");
    expect(t.get("--accent")).toBe("#f5f5f5");
    expect(t.get("--accent-foreground")).toBe("#171717");
    expect(t.get("--destructive")).toBe("#e40014");
    expect(t.get("--destructive-foreground")).toBe("#fcf3f3");
    expect(t.get("--border")).toBe("#e5e5e5");
    expect(t.get("--input")).toBe("#e5e5e5");
    expect(t.get("--ring")).toBe("#a1a1a1");
    expect(t.get("--sidebar")).toBe("#fafafa");
    expect(t.get("--sidebar-foreground")).toBe("#0a0a0a");
    expect(t.get("--sidebar-primary")).toBe("#171717");
    expect(t.get("--sidebar-primary-foreground")).toBe("#fafafa");
    expect(t.get("--sidebar-accent")).toBe("#f5f5f5");
    expect(t.get("--sidebar-accent-foreground")).toBe("#171717");
    expect(t.get("--sidebar-border")).toBe("#e5e5e5");
    expect(t.get("--sidebar-ring")).toBe("#a1a1a1");
    expect(t.get("--worktree-sidebar")).toBe("#f5f5f5");
    expect(t.get("--worktree-sidebar-foreground")).toBe("#0a0a0a");
    expect(t.get("--worktree-sidebar-accent")).toBe("#eaeaea");
    expect(t.get("--worktree-sidebar-accent-foreground")).toBe("#171717");
    expect(t.get("--worktree-sidebar-border")).toBe("#e5e5e5");
    expect(t.get("--worktree-sidebar-ring")).toBe("#a1a1a1");
    expect(t.get("--chart-1")).toBe("var(--color-blue-300)");
    expect(t.get("--chart-5")).toBe("var(--color-blue-800)");
    expect(t.get("--status-success")).toBe("#15803d");
    expect(t.get("--workspace-status-done")).toBe("#c7a594");
    expect(t.get("--workspace-status-review")).toBe("#16a34a");
    expect(t.get("--workspace-status-progress")).toBe("#d4a300");
    expect(t.get("--agent-question")).toBe("var(--color-orange-600)");
    expect(t.get("--agent-question-text")).toBe("var(--color-orange-700)");
    expect(t.get("--ai-action-accent")).toBe("var(--color-violet-500)");
    expect(t.get("--annotation-highlight")).toBe("#f59e0b");
    expect(t.get("--tab-group-split-divider")).toBe("#868690");
    // Drogon alias for sections below that predate the source token set.
    expect(t.get("--bg-titlebar")).toBe("var(--card)");
  });

  it("dark scheme carries the source .dark values", () => {
    const t = dark();
    expect(t.get("--background")).toBe("#0a0a0a");
    expect(t.get("--foreground")).toBe("#fafafa");
    expect(t.get("--editor-surface")).toBe("#1e1e1e");
    expect(t.get("--card")).toBe("#171717");
    expect(t.get("--card-foreground")).toBe("#fafafa");
    expect(t.get("--popover")).toBe("#171717");
    expect(t.get("--popover-foreground")).toBe("#fafafa");
    expect(t.get("--primary")).toBe("#e5e5e5");
    expect(t.get("--primary-foreground")).toBe("#171717");
    expect(t.get("--secondary")).toBe("#262626");
    expect(t.get("--secondary-foreground")).toBe("#fafafa");
    expect(t.get("--muted")).toBe("#262626");
    expect(t.get("--muted-foreground")).toBe("#a1a1a1");
    expect(t.get("--accent")).toBe("#404040");
    expect(t.get("--accent-foreground")).toBe("#fafafa");
    expect(t.get("--destructive")).toBe("#ff6568");
    expect(t.get("--destructive-foreground")).toBe("#df2225");
    expect(t.get("--border")).toBe("rgb(255 255 255 / 0.07)");
    expect(t.get("--input")).toBe("rgb(255 255 255 / 0.15)");
    expect(t.get("--ring")).toBe("#737373");
    expect(t.get("--sidebar")).toBe("#171717");
    expect(t.get("--sidebar-foreground")).toBe("#fafafa");
    expect(t.get("--sidebar-primary")).toBe("#1447e6");
    expect(t.get("--sidebar-primary-foreground")).toBe("#fafafa");
    expect(t.get("--sidebar-accent")).toBe("#262626");
    expect(t.get("--sidebar-accent-foreground")).toBe("#fafafa");
    expect(t.get("--sidebar-border")).toBe("rgb(255 255 255 / 0.07)");
    expect(t.get("--sidebar-ring")).toBe("#525252");
    expect(t.get("--worktree-sidebar")).toBe("#2a2a2a");
    expect(t.get("--worktree-sidebar-foreground")).toBe("#fafafa");
    expect(t.get("--worktree-sidebar-accent")).toBe("#353535");
    expect(t.get("--worktree-sidebar-accent-foreground")).toBe("#fafafa");
    expect(t.get("--worktree-sidebar-border")).toBe("rgb(255 255 255 / 0.07)");
    expect(t.get("--worktree-sidebar-ring")).toBe("#737373");
    expect(t.get("--chart-1")).toBe("var(--color-blue-300)");
    expect(t.get("--status-success")).toBe("#86efac");
    expect(t.get("--agent-question")).toBe("var(--color-orange-500)");
    expect(t.get("--agent-question-text")).toBe("var(--color-orange-300)");
    expect(t.get("--ai-action-accent")).toBe("var(--color-violet-400)");
    expect(t.get("--annotation-highlight")).toBe("#fbbf24");
    expect(t.get("--tab-group-split-divider")).toBe("#71717a");
  });

  it("schemes stay paired: every token in one exists in the other", () => {
    // --bg-titlebar is a Drogon-only alias defined once in :root; the font
    // stacks and radius are source globals that .dark never redeclares either.
    const l = light();
    const d = dark();
    const lightOnly = [...l.keys()].filter((k) => !d.has(k));
    const darkOnly = [...d.keys()].filter((k) => !l.has(k));
    expect(lightOnly.sort()).toEqual(
      ["--app-font-family", "--bg-titlebar", "--font-mono", "--font-sans", "--radius"].sort(),
    );
    expect(darkOnly).toEqual([]);
  });

  it("bundles the Geist and Nerd Font @font-face rules from the source", () => {
    expect(mainCss).toContain("url('./fonts/Geist-Variable.woff2') format('woff2')");
    expect(mainCss).toMatch(
      /font-family: 'Geist';[^}]*font-weight: 100 900;/s,
    );
    expect(mainCss).toMatch(
      /font-family: 'Orca Nerd Font Symbols';[^}]*unicode-range: U\+E000-F8FF, U\+F0000-FFFFD, U\+100000-10FFFD;/s,
    );
    for (const file of [
      "Geist-Variable.woff2",
      "SymbolsNerdFontMono-Regular.woff2",
      "Geist-OFL.txt",
      "SymbolsNerdFontMono-OFL.txt",
    ]) {
      expect(
        fs.existsSync(new URL(`./assets/fonts/${file}`, import.meta.url)),
        `missing bundled font artifact ${file}`,
      ).toBe(true);
    }
  });

  it("maps the theme roles through @theme inline like the source", () => {
    for (const role of [
      "--color-background",
      "--color-card-foreground",
      "--color-sidebar-ring",
      "--color-chart-3",
      "--color-status-success",
      "--color-workspace-status-review",
      "--color-terminal-pane-title-on-dark-fg",
    ]) {
      expect(mainCss).toContain(`${role}: var(`);
    }
    expect(mainCss).toContain("--radius-lg: var(--radius);");
    expect(mainCss).toContain("--shadow-floating: 0 10px 24px rgb(0 0 0 / 0.18);");
  });
});
