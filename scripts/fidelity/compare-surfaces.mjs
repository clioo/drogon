// R5-F fidelity oracle: source-anchored rendered comparison of orca-drogon
// (reference, read-only) vs the Drogon rewrite candidate (owned processes).
//
// Usage:
//   node scripts/fidelity/compare-surfaces.mjs --ref <cdp-url> --out <dir>
//     [--cand <cdp-url>] [--states a,b,c] [--no-dark] [--keep]
//
// --ref  CDP http endpoint of the running orca-drogon dev app (confirmation
//        only: the script never creates data there, only navigates views and
//        opens/closes ephemeral overlays).
// --out  Output dir; default .preflight/fidelity/<timestamp>/.
// --cand Optional existing candidate CDP endpoint. When absent the script
//        launches its OWN production candidate: target/debug/drogond plus
//        Electron on apps/desktop (out/ production bundle) with
//        --remote-debugging-port=0, all inside a temp fixture it cleans up.
// --keep Leave owned candidate processes running (debugging only).
//
// Per state and per color scheme (light + dark at 1440x900) it captures:
//   <state>.{ref,cand}.{png,aria.yaml,dom.json}
// plus a cropped status-bar strip, then writes report.md (ranked differences,
// each citing the reference SOURCE file and the candidate file to change)
// and index.html (side-by-side viewer). Exits 0 with a report on success.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
  runAcceptanceProcess,
} from "../acceptance-process.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const REF_ROOT = "/Users/carlos/Documents/Drogon-mentu-session";
const VIEWPORT = { width: 1440, height: 900 };

const args = process.argv.slice(2);
function flag(name, def = null) {
  const i = args.indexOf(name);
  if (i === -1) return def;
  if (i + 1 < args.length && !args[i + 1].startsWith("--")) return args[i + 1];
  return true;
}
const REF_CDP = flag("--ref", "http://127.0.0.1:9445");
const CAND_CDP = flag("--cand", null);
const OUT = flag("--out", null);
const NO_DARK = args.includes("--no-dark");
const KEEP = args.includes("--keep");
const STATES_FILTER = flag("--states", null)?.split(",").map((s) => s.trim());

// ---------------------------------------------------------------------------
// Source inventory: MVP surface -> reference source anchors (read-only).
// The oracle reads these files at runtime; missing paths are recorded, never
// created. Expected values are extracted with the listed line patterns.
// ---------------------------------------------------------------------------
const SURFACES = [
  {
    id: "shell-sidebar",
    label: "Shell + sidebar",
    refDir: "src/renderer/src/components/sidebar",
    refFiles: [
      "src/renderer/src/components/Sidebar.tsx",
      "src/renderer/src/components/sidebar/index.tsx",
      "src/renderer/src/components/sidebar/SidebarNav.tsx",
      "src/renderer/src/components/sidebar/workspace-chrome-metrics.ts",
      "src/renderer/src/components/sidebar/SidebarHeader.tsx",
    ],
    probes: ["width", "w-[", "sidebar", "Projects", "aria-label", "sidebarWidth", "MIN_WIDTH", "MAX_WIDTH"],
    candFiles: ["apps/desktop/src/renderer/src/features/shell/Sidebar.tsx"],
  },
  {
    id: "tab-bar",
    label: "Tab bar",
    refDir: "src/renderer/src/components/tab-bar",
    refFiles: [
      "src/renderer/src/components/tab-bar/TabBar.tsx",
      "src/renderer/src/components/tab-bar/tab-bar-surface.tsx",
      "src/renderer/src/components/tab-bar/tab-width-rules.ts",
      "src/renderer/src/components/tab-bar/SortableTab.tsx",
    ],
    probes: ["height", "h-", "aria-selected", "role=\"tab\"", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/shell/TabBar.tsx"],
  },
  {
    id: "status-bar",
    label: "Status bar",
    refDir: "src/renderer/src/components/status-bar",
    refFiles: [
      "src/renderer/src/components/status-bar/StatusBar.tsx",
      "src/renderer/src/components/status-bar/StatusBarSurface.tsx",
      "src/renderer/src/components/status-bar/icons.tsx",
    ],
    probes: ["height", "h-", "Settings", "Help", "usage", "awake", "Ports"],
    candFiles: [
      "apps/desktop/src/renderer/src/components/status-bar/StatusBar.tsx",
    ],
  },
  {
    id: "palette",
    label: "Palette (Cmd+K) + quick open (Cmd+P)",
    refDir: "src/renderer/src/components/cmd-j",
    refFiles: [
      "src/renderer/src/components/cmd-j/palette-filter.ts",
      "src/renderer/src/components/cmd-j/palette-results.ts",
      "src/renderer/src/components/cmd-j/PaletteFilterChips.tsx",
    ],
    probes: ["cmd", "ctrl", "meta", "shortcut", "placeholder", "aria-label"],
    candFiles: [
      "apps/desktop/src/renderer/src/components/command-palette/CommandPalette.tsx",
      "apps/desktop/src/renderer/src/shortcuts.ts",
    ],
  },
  {
    id: "settings",
    label: "Settings (Appearance)",
    refDir: "src/renderer/src/components/settings",
    refFiles: [
      "src/renderer/src/components/settings/AppearancePane.tsx",
      "src/renderer/src/components/settings/AppearanceInterfaceSection.tsx",
      "src/renderer/src/components/settings/AdvancedPane.tsx",
    ],
    probes: ["Appearance", "Theme", "aria-label", "role=\"dialog\""],
    candFiles: ["apps/desktop/src/renderer/src/settings-panel.tsx"],
  },
  {
    id: "changes",
    label: "Changes / diff",
    refDir: "src/renderer/src/components/right-sidebar/source-control",
    refFiles: [
      "src/renderer/src/components/right-sidebar/source-control/panel/panel-content.tsx",
      "src/renderer/src/components/right-sidebar/source-control/panel/commit-surface.tsx",
      "src/renderer/src/components/right-sidebar/source-control/listing/uncommitted-sections.tsx",
      "src/renderer/src/components/right-sidebar/source-control/review/hosted-review-header-chrome.tsx",
    ],
    probes: ["Stage", "Commit", "Push", "aria-label", "diff"],
    candFiles: ["apps/desktop/src/renderer/src/features/source-control/"],
  },
  {
    id: "automations",
    label: "Automations page",
    refDir: "src/renderer/src/components/automations",
    refFiles: [
      "src/renderer/src/components/automations/AutomationsPage.tsx",
      "src/renderer/src/components/automations/AutomationEditorDialog.tsx",
      "src/renderer/src/components/automations/automation-page-parts.tsx",
    ],
    probes: ["Automations", "Schedule", "cron", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/automations/"],
  },
  {
    id: "browser",
    label: "Browser pane",
    refDir: "src/renderer/src/components/browser-pane",
    refFiles: [
      "src/renderer/src/components/browser-pane/BrowserPane.tsx",
      "src/renderer/src/components/browser-pane/ClientHostedBrowserPagePane.tsx",
    ],
    probes: ["address", "Back", "Forward", "Reload", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/browser/"],
  },
  {
    id: "tasks",
    label: "Tasks page",
    refDir: "src/renderer/src/components/task-page",
    refFiles: [
      "src/renderer/src/components/task-page/TaskPage.tsx",
      "src/renderer/src/components/task-page/ListChrome.tsx",
      "src/renderer/src/components/task-page/github/List.tsx",
    ],
    probes: ["Tasks", "Issues", "Filter", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/shell/SidebarNav.tsx"],
  },
  {
    id: "bots",
    label: "Bots page",
    refDir: "src/renderer/src/components/bots",
    refFiles: [
      "src/renderer/src/components/bots/BotsPage.tsx",
      "src/renderer/src/components/bots/BotsPageForms.tsx",
      "src/renderer/src/components/bots/use-bots-page-controller.ts",
    ],
    probes: ["Bots", "preset", "chat", "aria-label"],
    candFiles: ["apps/desktop/src/renderer/src/features/bots/"],
  },
  {
    id: "tokens",
    label: "Design tokens + styleguide",
    refDir: "src/renderer/src/assets",
    refFiles: ["src/renderer/src/assets/main.css", "docs/STYLEGUIDE.md"],
    probes: [
      "--background",
      "--sidebar",
      "--font-sans",
      "--radius",
      "--muted-foreground",
      "monochrome",
    ],
    candFiles: ["apps/desktop/src/renderer/src/assets/main.css"],
  },
];

function scoreProbeLine(line) {
  const l = line.toLowerCase();
  let score = 0;
  if (l.includes("classname")) score += 3;
  if (l.includes("aria-")) score += 3;
  if (/\d+px/.test(l)) score += 3;
  if (l.includes("width") || l.includes("height")) score += 2;
  if (l.includes("--")) score += 2;
  if (l.includes("translate(") || l.includes("copy")) score += 1;
  if (l.includes("import ")) score -= 4;
  if (l.trim().startsWith("//") || l.trim().startsWith("*")) score -= 2;
  return score;
}

async function buildInventory() {
  const { readdir } = await import("node:fs/promises");
  const entries = [];
  for (const surface of SURFACES) {
    const found = [];
    for (const rel of surface.refFiles) {
      const abs = path.join(REF_ROOT, rel);
      if (!existsSync(abs)) {
        found.push({ file: rel, exists: false, matches: [] });
        continue;
      }
      let text = null;
      try {
        text = await readFile(abs, "utf8");
      } catch {
        found.push({ file: rel, exists: true, matches: ["(unreadable)"] });
        continue;
      }
      // Round-robin across probes (rank 0 of every probe, then rank 1, …)
      // up to 8: every probe stays represented, otherwise px-heavy lines
      // starve the font probes.
      const seen = new Set();
      const matches = [];
      const groups = surface.probes.map((probe) => {
        const group = [];
        for (const line of text.split("\n")) {
          if (line.toLowerCase().includes(probe.toLowerCase())) {
            const trimmed = line.trim().slice(0, 170);
            if (trimmed && !group.some((g) => g.line === trimmed))
              group.push({ probe, line: trimmed, score: scoreProbeLine(line) });
          }
        }
        group.sort((a, b) => b.score - a.score);
        return group.slice(0, 3);
      });
      for (let rank = 0; rank < 3 && matches.length < 8; rank++) {
        for (const group of groups) {
          if (matches.length >= 8) break;
          const s = group[rank];
          if (!s || seen.has(s.line)) continue;
          seen.add(s.line);
          matches.push(`${s.probe}: ${s.line}`);
        }
      }
      found.push({ file: rel, exists: true, matches });
    }
    // Exact source components: list the surface directory (non-test first).
    let dirListing = [];
    if (surface.refDir) {
      try {
        const names = await readdir(path.join(REF_ROOT, surface.refDir));
        const rank = (n) =>
          n.endsWith(".test.tsx") || n.endsWith(".test.ts") ? 2 : n.startsWith("use-") ? 1 : 0;
        dirListing = names
          .filter((n) => !n.startsWith("."))
          .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
          .slice(0, 24);
      } catch {
        dirListing = ["(dir not found)"];
      }
    }
    entries.push({ ...surface, ref: found, dirListing });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Normalization: paths/usernames are never differences.
// ---------------------------------------------------------------------------
export function normalizeText(value) {
  return String(value)
    .replace(/\/Users\/[^/\s]+/g, "<HOME>")
    .replace(/\/private\/var\/folders\/[^\s"']*/g, "<TMP>")
    .replace(/\/var\/folders\/[^\s"']*/g, "<TMP>")
    .replace(/\/tmp\/[^\s"']*/g, "<TMP>")
    .replace(/\b[a-f0-9]{7,40}\b/gi, "<HASH>")
    .replace(/[0-9]+h\s+[0-9]+m/g, "<DUR>")
    .replace(/[0-9]+d\s+[0-9]+h/g, "<DUR>")
    .replace(/\s+/g, " ")
    .trim();
}

function ariaLines(snapshot) {
  return String(snapshot || "")
    .split("\n")
    .map((l) => normalizeText(l))
    .filter(Boolean);
}

// Multiset diff with "changed" pairing: a ref-only line and a cand-only line
// sharing the same `- <role>` prefix and indentation count as a text change.
export function diffAria(refSnap, candSnap) {
  const ref = ariaLines(refSnap);
  const cand = ariaLines(candSnap);
  const refCount = new Map();
  const candCount = new Map();
  for (const l of ref) refCount.set(l, (refCount.get(l) ?? 0) + 1);
  for (const l of cand) candCount.set(l, (candCount.get(l) ?? 0) + 1);
  const refOnly = [];
  const candOnly = [];
  for (const [l, n] of refCount) {
    const m = candCount.get(l) ?? 0;
    for (let i = 0; i < n - Math.min(n, m); i++) refOnly.push(l);
  }
  for (const [l, n] of candCount) {
    const m = refCount.get(l) ?? 0;
    for (let i = 0; i < n - Math.min(n, m); i++) candOnly.push(l);
  }
  // Pair key: ARIA role plus the control's accessible name (first quoted
  // string). The same control in a different state (e.g. [disabled] toggled)
  // pairs as "changed"; different controls fall to missing/added instead of
  // being force-paired into misleading "text differs" rows.
  const pairKey = (l) => {
    const m = l.match(/^(\s*-\s*[\w]+)(.*)$/);
    if (!m) return l.slice(0, 40);
    const q = m[2].match(/"([^"]*)"/);
    return q ? `${m[1].trim()}|${q[1].slice(0, 60)}` : `${m[1].trim()}|${m[2].trim().slice(0, 60)}`;
  };
  const prefix = pairKey;
  const changed = [];
  const usedCand = new Set();
  const missing = [];
  for (const r of refOnly) {
    const idx = candOnly.findIndex(
      (c, i) => !usedCand.has(i) && prefix(c) === prefix(r),
    );
    if (idx !== -1) {
      usedCand.add(idx);
      changed.push({ ref: r, cand: candOnly[idx] });
    } else missing.push(r);
  }
  const added = candOnly.filter((_, i) => !usedCand.has(i));
  return { refLines: ref.length, candLines: cand.length, missing, added, changed };
}

// ---------------------------------------------------------------------------
// Rendered capture: PNG + ARIA snapshot + normalized DOM outline.
// ---------------------------------------------------------------------------
const REGION_QUERIES = {
  sidebar: [
    'aside[aria-label="Sidebar"]',
    "aside",
    '[class*="sidebar"]',
    '[class*="shell-sidebar"]',
  ],
  tablist: ['[role="tablist"]', '[class*="tab-strip"]', '[class*="terminal-tabs"]'],
  statusbar: [
    '[class*="status-bar"]',
    "footer",
    '[aria-label*="Usage"]',
    '[class*="statusbar"]',
  ],
  heading: ["h1", '[role="heading"]', "h2"],
};

async function domOutline(page) {
  return page.evaluate((queries) => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const regions = {};
    for (const [key, sels] of Object.entries(queries)) {
      // Several selectors can match incidental children (icons, buttons), so
      // score every match and keep the largest by area: the region container.
      let best = null;
      for (const sel of sels) {
        let els = [];
        try {
          els = [...document.querySelectorAll(sel)];
        } catch {
          continue;
        }
        for (const el of els) {
          const r = rect(el);
          const area = r.w * r.h;
          if (!best || area > best.area) {
            const cs = getComputedStyle(el);
            best = {
              sel,
              rect: r,
              area,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              color: cs.color,
              background: cs.backgroundColor,
            };
          }
        }
      }
      regions[key] = best;
    }
    // The status strip is a thin full-width bar pinned to the viewport
    // bottom. Segment buttons (usage, ports) also match the selectors but are
    // small; if the winner is not bar-shaped, fall back to bottom-bar
    // geometry so cross-app deltas compare containers, not segments.
    const sb = regions.statusbar;
    if (!sb || sb.rect.h > 44 || sb.rect.w < Math.min(900, innerWidth * 0.6)) {
      let bar = null;
      for (const el of document.querySelectorAll("body *")) {
        const r = rect(el);
        const bottom = r.y + r.h;
        if (
          bottom >= innerHeight - 4 &&
          r.h > 0 &&
          r.h <= 48 &&
          r.w >= Math.min(900, innerWidth * 0.6)
        ) {
          if (!bar || r.width * r.height > bar.area) {
            const cs = getComputedStyle(el);
            bar = {
              sel: "bottom-bar-heuristic",
              rect: r,
              area: r.width * r.height,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              color: cs.color,
              background: cs.backgroundColor,
            };
          }
        }
      }
      if (bar) regions.statusbar = bar;
    }
    const headlines = [];
    for (const el of document.querySelectorAll("h1,h2,h3,[role='heading']")) {
      if (headlines.length >= 12) break;
      const text = (el.textContent || "").trim().slice(0, 160);
      if (!text) continue;
      const cs = getComputedStyle(el);
      headlines.push({
        tag: el.tagName.toLowerCase(),
        text,
        rect: rect(el),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        color: cs.color,
        fontFamily: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      });
    }
    const tabs = [...document.querySelectorAll('[role="tab"]')].slice(0, 12).map((el) => ({
      label: el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 80),
      selected: el.getAttribute("aria-selected"),
      rect: rect(el),
    }));
    return {
      url: location.href,
      title: document.title,
      nodeCount: document.querySelectorAll("body *").length,
      regions,
      headlines,
      tabs,
    };
  }, REGION_QUERIES);
}

function geomDelta(a, b) {
  if (!a || !b) return null;
  return {
    dw: b.rect.w - a.rect.w,
    dh: b.rect.h - a.rect.h,
    dx: b.rect.x - a.rect.x,
    dy: b.rect.y - a.rect.y,
  };
}

async function captureTriple(page, base, scheme) {
  await page.emulateMedia({ colorScheme: scheme });
  await delay(450);
  const suffix = scheme === "dark" ? ".dark" : "";
  const png = `${base}${suffix}.png`;
  await page.screenshot({ path: png, animations: "disabled" });
  let aria = "";
  try {
    aria = await page.locator("body").ariaSnapshot({ timeout: 8000 });
  } catch (error) {
    aria = `(aria snapshot unavailable: ${error.message.split("\n")[0]})`;
  }
  const dom = await domOutline(page);
  // Stored artifacts are normalized too: temp paths, hashes and durations
  // become placeholders so no username or machine path persists on disk.
  const storedAria = String(aria)
    .split("\n")
    .map((line) =>
      line
        .replace(/\/Users\/[^/\s"']+/g, "<HOME>")
        .replace(/\/private\/var\/folders\/[^\s"']*/g, "<TMP>")
        .replace(/\/var\/folders\/[^\s"']*/g, "<TMP>")
        .replace(/\/tmp\/[^\s"']*/g, "<TMP>")
        .replace(/\b[a-f0-9]{7,40}\b/gi, "<HASH>"),
    )
    .join("\n");
  await writeFile(`${base}${suffix}.aria.yaml`, storedAria.endsWith("\n") ? storedAria : `${storedAria}\n`);
  await writeFile(`${base}${suffix}.dom.json`, JSON.stringify(dom, null, 2) + "\n");
  return { png, aria, dom };
}

async function dismissOverlays(page) {
  for (let i = 0; i < 3; i++) {
    try {
      await page.keyboard.press("Escape");
      await delay(150);
    } catch {
      break;
    }
  }
}

// Best-effort click with EXACT accessible-name matching (substring matches
// previously opened the wrong surface). Returns true when it acted.
async function tryClick(page, role, name, timeout = 2500) {
  try {
    const loc = page.getByRole(role, { name, exact: true });
    if ((await loc.count()) === 0) return false;
    await loc.first().click({ timeout });
    await delay(350);
    return true;
  } catch {
    return false;
  }
}

// Overlay census: native dialogs/menus plus the candidate's cmdk palette,
// which is a NON-MODAL plain-div overlay (no role=dialog, no aria-hidden
// backdrop) that still swallows all pointer events while open.
async function overlayState(page) {
  try {
    return await page.evaluate(() => ({
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      menus: document.querySelectorAll('[role="menu"]').length,
      palettes: document.querySelectorAll(".command-palette-overlay").length,
    }));
  } catch {
    return { dialogs: -1, menus: -1, palettes: -1 };
  }
}

function overlayCount(o) {
  return (o.dialogs || 0) + (o.menus || 0) + (o.palettes || 0);
}

// Verified-clean start: dismiss until no dialog/menu remains (or give up and
// say so). Residue from a prior state must never leak into the next capture.
async function ensureClean(page, notes) {
  for (let i = 0; i < 6; i++) {
    const seen = await overlayState(page);
    if (overlayCount(seen) === 0) {
      if (i > 0) notes.push(`cleaned ${i} overlay round(s) before setup`);
      return;
    }
    try {
      await page.keyboard.press("Escape");
      await delay(250);
    } catch {
      break;
    }
  }
  const left = await overlayState(page);
  notes.push(
    `overlays remain before setup (dialogs=${left.dialogs} menus=${left.menus} palettes=${left.palettes})`,
  );
}

async function tryKeys(page, chord) {
  try {
    await page.keyboard.press(chord);
    await delay(500);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Candidate lifecycle (owned processes): real drogond + production Electron.
// ---------------------------------------------------------------------------
async function launchCandidate() {
  const appDir = path.join(root, "apps", "desktop");
  const appRequire = createRequire(path.join(appDir, "package.json"));
  const electron = appRequire("electron");
  assert.ok(
    existsSync(path.join(appDir, "out", "renderer", "index.html")),
    "Production bundle missing: run `pnpm --filter @drogon/desktop build` first",
  );
  const daemonBin = path.join(
    root, "target", "debug", process.platform === "win32" ? "drogond.exe" : "drogond",
  );
  const cliBin = path.join(
    root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
  );
  assert.ok(existsSync(daemonBin), `drogond missing at ${daemonBin}`);
  const fixture = await mkdtemp(path.join(tmpdir(), "r5f-fidelity-"));
  const dataDir = path.join(fixture, "data");
  await mkdir(dataDir, { recursive: true });
  const workspace = path.join(fixture, "folder");
  await mkdir(workspace, { recursive: true });

  const daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
  });
  let daemonError = null;
  daemon.on("error", (error) => {
    daemonError = error;
  });
  const deadline = Date.now() + 12000;
  for (;;) {
    if (daemonError) throw daemonError;
    try {
      const response = await runAcceptanceProcess(
        cliBin, ["--data-dir", dataDir, "--json", "status"], { timeout: 1500 },
      );
      assert.equal(JSON.parse(response.stdout).ok, true);
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
  const desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      ...(process.platform !== "win32" ? { SHELL: "/bin/sh" } : {}),
    },
  });
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(
      () => reject(new Error(`Electron did not publish a debugging endpoint: ${tail}`)),
      25000,
    );
    desktop.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    desktop.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error(`Electron exited before connection: ${tail}`));
    });
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
  });
  const browser = await chromium.connectOverCDP(endpoint);
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    page = browser.contexts()[0]?.pages()[0] ?? null;
    if (!page) await delay(50);
  }
  assert.ok(page, "Electron must create a rendered page");
  page.setDefaultTimeout(15000);
  // R9-B: the sidebar footer is the source toolbar now (settings, help,
  // reveal) — the "Service x.y.z" text is gone, so readiness waits for it.
  await page
    .getByRole("button", { name: "Reveal active workspace", exact: true })
    .waitFor({ timeout: 25000 });
  await page.setViewportSize(VIEWPORT);
  return { browser, page, desktop, daemon, fixture, dataDir, workspace };
}

async function stopCandidate(owned) {
  if (!owned) return [];
  const notes = [];
  try {
    await owned.browser?.close().catch(() => {});
    notes.push("candidate CDP browser: closed");
  } catch {
    notes.push("candidate CDP browser: unverifiable");
  }
  for (const [child, label] of [[owned.desktop, "candidate electron"], [owned.daemon, "candidate drogond"]]) {
    if (!child) continue;
    try {
      const result = await stopAcceptanceProcess(child);
      notes.push(`${label}: ${result.verdict}${result.forced ? " (forced)" : ""}`);
    } catch (error) {
      notes.push(`${label}: stop failed (${error.message.split("\n")[0]})`);
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// State drivers. Each setup(side) returns { notes[], missing[] } and must be
// non-destructive on the reference side: no projects, sessions, files, or
// settings are created there — only view navigation and ephemeral overlays.
// The candidate side may use its own temp fixture freely.
// ---------------------------------------------------------------------------
const MOD = process.platform === "darwin" ? "Meta" : "Control";

async function refSetup(page, state, ctx) {
  const notes = [];
  const missing = [];
  await page.setViewportSize(VIEWPORT);
  await ensureClean(page, notes);
  const chordOverlay = async (chord, label) => {
    await tryKeys(page, chord);
    await delay(1200);
    const seen = await overlayState(page);
    if (overlayCount(seen) > 0) {
      notes.push(
        `${label} chord ${chord}: overlay open (dialogs=${seen.dialogs} menus=${seen.menus} palettes=${seen.palettes})`,
      );
      return true;
    }
    notes.push(`${label} chord ${chord}: no overlay appeared`);
    return false;
  };
  switch (state) {
    case "empty":
      notes.push(`ref as-is: title=${await page.title().catch(() => "?")}`);
      break;
    case "project-terminal":
      missing.push("ref project+terminal fixture intentionally not created (reference is read-only); captured current view");
      notes.push(`tabs visible: ${await page.getByRole("tab").count().catch(() => "?")}`);
      break;
    case "palette":
      // Spec chord first; the reference source binds no command palette to
      // Cmd+K (src/shared/keybindings: Cmd+K is terminal.clear, the worktree
      // "Jump to..." palette is worktree.palette on Mod+J), so fall back to
      // the SOURCE chord and record both attempts honestly.
      if (!(await chordOverlay(`${MOD}+K`, "spec Cmd+K"))) {
        notes.push("source: Cmd+K is terminal.clear (definitions-core-3.ts); trying source chord Mod+J (worktree.palette)");
        if (!(await chordOverlay(`${MOD}+J`, "source Mod+J"))) {
          missing.push("no palette overlay via Cmd+K nor Cmd+J");
        }
      }
      break;
    case "quick-open":
      // Source: worktree.quickOpen "Go to File" defaults to Mod+P
      // (definitions-core-1.ts) — same chord as the spec here.
      if (!(await chordOverlay(`${MOD}+P`, "Cmd+P"))) {
        missing.push("Cmd+P (worktree.quickOpen) opened no overlay in the empty ref");
      }
      break;
    case "settings-appearance":
      if (await tryClick(page, "button", "Settings")) {
        await tryClick(page, "button", "Appearance", 1200).catch(() => {});
        await tryClick(page, "tab", "Appearance", 1200).catch(() => {});
        notes.push("Settings opened via Settings button");
      } else missing.push("no Settings button reachable");
      break;
    case "changes":
      missing.push("ref git fixture intentionally not created (reference is read-only)");
      if (await tryClick(page, "button", "Changes", 1200)) notes.push("Changes view opened");
      else notes.push("no Changes nav; captured current view");
      break;
    case "automations":
      if (await tryClick(page, "button", "Automations")) notes.push("Automations opened");
      else missing.push("no Automations nav reachable");
      break;
    case "browser":
      if (await tryClick(page, "button", "Browser", 1200)) notes.push("Browser opened");
      else {
        missing.push("no Browser nav button in ref sidebar");
        notes.push("captured current view instead");
      }
      break;
    case "tasks":
      if ((await tryClick(page, "button", "Tasks")) || (await tryClick(page, "button", "Open GitHub tasks", 1200)))
        notes.push("Tasks opened");
      else missing.push("no Tasks nav reachable");
      break;
    case "bots":
      if (await tryClick(page, "button", "Bots")) notes.push("Bots opened");
      else missing.push("no Bots nav reachable");
      break;
    case "statusbar-strip":
      notes.push("full-page capture; strip cropped in post");
      break;
    default:
      missing.push(`unknown state ${state}`);
  }
  ctx.refNotes = notes;
  return { notes, missing };
}

const REF_PAGE_STATES = new Set(["automations", "tasks", "bots", "changes", "browser"]);

async function refTeardown(page, state) {
  const notes = [];
  await ensureClean(page, notes);
  // Settings is a full page, not an overlay: Escape cannot leave it.
  if (await tryClick(page, "button", "Back to app", 1500)) {
    notes.push("teardown: Back to app from full-page view");
    await ensureClean(page, notes);
  }
  // Sidebar-nav pages (Automations/Tasks/Bots): return home via Sessions.
  // View navigation only — no data is created or changed.
  if (REF_PAGE_STATES.has(state)) {
    if (await tryClick(page, "button", "Sessions", 1500)) {
      notes.push("teardown: returned home via Sessions");
    }
  }
  return notes;
}

async function candSetup(page, state, ctx) {
  const notes = [];
  const missing = [];
  await page.setViewportSize(VIEWPORT);
  await ensureClean(page, notes);
  const chordOverlay = async (chord, label) => {
    await tryKeys(page, chord);
    await delay(1200);
    const seen = await overlayState(page);
    if (overlayCount(seen) > 0) {
      notes.push(
        `${label} chord ${chord}: overlay open (dialogs=${seen.dialogs} menus=${seen.menus} palettes=${seen.palettes})`,
      );
      return true;
    }
    notes.push(`${label} chord ${chord}: no overlay appeared`);
    return false;
  };
  const ensureProject = async () => {
    if (ctx.candProjectId) return true;
    const count = await page.evaluate(async () => {
      try {
        const r = await window.drogon.workspaces();
        return r.ok ? r.result.workspaces.length : -1;
      } catch {
        return -1;
      }
    }).catch(() => -1);
    if (count > 0) {
      ctx.candProjectId = "existing";
      return true;
    }
    const opened =
      (await tryClick(page, "button", "Add project")) ||
      (await tryClick(page, "button", "Add Project")) ||
      (await tryClick(page, "button", "Create workspace"));
    if (!opened) {
      missing.push("no Add project/workspace affordance");
      return false;
    }
    try {
      await page.getByLabel(/^Folder( or repository)? path$/).fill(ctx.workspace);
      await page
        .getByRole("dialog", { name: "Add Project" })
        .getByRole("button", { name: "Add Project", exact: true })
        .click();
      // R9-B: the empty view is the source's "No workspaces found" block
      // now, so registration readiness waits for a project row instead.
      await page.waitForFunction(
        () => document.querySelector(".shell-project-row") !== null,
        null,
        { timeout: 8000 },
      ).catch(() => {});
      ctx.candProjectId = "created";
      notes.push(`folder project registered at <TMP>/folder`);
      return true;
    } catch (error) {
      missing.push(`project registration failed: ${error.message.split("\n")[0]}`);
      return false;
    }
  };
  const ensureTerminal = async () => {
    const tabs = await page.getByRole("tab").count().catch(() => 0);
    if (tabs > 0) return true;
    if (!(await ensureProject())) return false;
    // The launcher is the tab strip "+" static create menu ("New tab"
    // button opens New Terminal / per-harness rows / New Browser Tab):
    // click through the New Terminal entry.
    if (!(await tryClick(page, "button", "New tab"))) {
      missing.push("no New tab affordance");
      return false;
    }
    await delay(600);
    try {
      const item = page.getByRole("menuitem", { name: "New Terminal", exact: true });
      if ((await item.count()) > 0) {
        await item.first().click({ timeout: 3000 });
        notes.push("create menu: plain New Terminal chosen");
        await delay(500);
      }
    } catch {
      /* single-action launcher: no menu */
    }
    await dismissOverlays(page);
    try {
      await page.getByRole("tab").first().waitFor({ timeout: 20000 });
      // The pty can accept input before the shell prints its first prompt;
      // wait for evidence the shell is alive so the marker is not swallowed.
      await page
        .waitForFunction(
          () => /[$#%]/.test((() => {
        const registry = window.__drogonTerminals;
        if (registry && registry.size > 0) {
          const lines = [];
          for (const terminal of registry.values()) {
            const buffer = terminal.buffer.active;
            for (let row = 0; row < buffer.length; row += 1) {
              lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
            }
          }
          return lines.join("\n");
        }
        return document.querySelector(".xterm-screen")?.textContent ?? "";
      })()),
          null,
          { timeout: 20000 },
        )
        .catch(() => {});
      await page.locator(".xterm-helper-textarea").first().focus({ timeout: 5000 });
      const marker = `FID_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      ctx.marker = marker;
      // Typed input can land while the shell is still initializing and get
      // garbled, so retry with a fresh prompt (Ctrl+C) until echoed.
      let echoed = false;
      for (let attempt = 0; attempt < 3 && !echoed; attempt++) {
        await page.locator(".xterm-helper-textarea").first().focus({ timeout: 5000 });
        await page.keyboard.press("Control+C");
        await delay(400);
        await page.keyboard.type(`printf '${marker}\\n'`);
        await page.keyboard.press("Enter");
        try {
          await page.waitForFunction(
            (value) => (() => {
        const registry = window.__drogonTerminals;
        if (registry && registry.size > 0) {
          const lines = [];
          for (const terminal of registry.values()) {
            const buffer = terminal.buffer.active;
            for (let row = 0; row < buffer.length; row += 1) {
              lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
            }
          }
          return lines.join("\n");
        }
        return document.querySelector(".xterm-screen")?.textContent ?? "";
      })().includes(value),
            marker,
            { timeout: 9000 },
          );
          echoed = true;
        } catch {
          notes.push(`marker attempt ${attempt + 1}: no echo yet, retrying`);
        }
      }
      assert.ok(echoed, `marker ${marker} never echoed in terminal`);
      notes.push("live terminal with marker output");
      return true;
    } catch (error) {
      missing.push(`terminal fixture failed: ${error.message.split("\n")[0]}`);
      return false;
    }
  };
  switch (state) {
    case "empty":
      notes.push(ctx.candProjectId ? "project already exists; captured as-is" : "fresh empty app");
      break;
    case "project-terminal":
      if (!(await ensureTerminal())) missing.push("project-terminal fixture unavailable");
      break;
    case "palette":
      await ensureProject().catch(() => {});
      // Candidate vocabulary (shortcuts.ts PALETTE_SHORTCUTS): the command
      // palette is worktree.palette on Mod+J — Mod+K is terminal.clear and
      // must open nothing outside a terminal.
      if (!(await chordOverlay(`${MOD}+J`, "palette.worktree.palette"))) {
        missing.push("Mod+J (worktree.palette) opened no overlay");
      }
      break;
    case "quick-open":
      await ensureProject().catch(() => {});
      if (!(await chordOverlay(`${MOD}+P`, "palette.worktree.quickOpen"))) {
        missing.push("Mod+P (worktree.quickOpen) opened no overlay");
      }
      break;
    case "settings-appearance": {
      const opened =
        (await tryClick(page, "button", "Settings")) ||
        (await tryClick(page, "button", "Settings", 2500));
      if (opened) {
        await tryClick(page, "button", "Appearance", 1200).catch(() => {});
        await tryClick(page, "tab", "Appearance", 1200).catch(() => {});
        notes.push("Settings panel opened");
      } else missing.push("no Settings affordance reachable");
      break;
    }
    case "changes": {
      if (await ensureProject()) {
        try {
          await execFileAsync("git", ["init"], { cwd: ctx.workspace }).catch(() => {});
          await writeFile(path.join(ctx.workspace, "notes.txt"), "fidelity fixture\n");
          await execFileAsync("git", ["add", "-A"], { cwd: ctx.workspace }).catch(() => {});
          await writeFile(path.join(ctx.workspace, "notes.txt"), "fidelity fixture modified\n");
          notes.push("git fixture: one modified tracked file");
        } catch {
          notes.push("git fixture best-effort only");
        }
        // R6-B: Changes lives in the right activity bar ("Source Control"
        // button; the accessible name carries the ⌘⇧G chord suffix, so the
        // match is non-exact).
        try {
          await page
            .getByRole("button", { name: "Source Control" })
            .first()
            .click({ timeout: 3000 });
          await delay(350);
          notes.push("Changes opened through the right activity bar");
        } catch {
          missing.push("Source Control activity button unavailable (capability or fixture)");
          notes.push("captured terminal view instead");
        }
      }
      break;
    }
    case "automations":
      await ensureProject().catch(() => {});
      if (await tryClick(page, "button", "Automations")) notes.push("Automations nav opened");
      else missing.push("no Automations nav reachable");
      break;
    case "browser":
      await ensureProject().catch(() => {});
      // R6-B: Browser is a tab, opened from the strip "+" static create
      // menu ("New tab" trigger, "New Browser Tab" entry).
      if (await tryClick(page, "button", "New tab")) {
        await delay(600);
        try {
          const entry = page.getByRole("menuitem", { name: "New Browser Tab", exact: true });
          if ((await entry.count()) > 0) {
            await entry.first().click({ timeout: 3000 });
            notes.push("browser tab opened through the + create menu");
            await delay(800);
          } else notes.push("no New Browser Tab menu entry; captured as-is");
        } catch {
          notes.push("create-menu selection best-effort only");
        }
        await dismissOverlays(page);
        try {
          const addr = page.getByPlaceholder(/address|url|search/i);
          if ((await addr.count()) > 0) {
            await addr.first().fill(`file://${path.join(ctx.workspace, "notes.txt")}`);
            await page.keyboard.press("Enter");
            await delay(1200);
            notes.push("local file navigated in pane");
          } else notes.push("no address field; captured pane as-is");
        } catch {
          notes.push("address navigation best-effort only");
        }
      } else missing.push("no New tab affordance reachable");
      break;
    case "tasks":
      await ensureProject().catch(() => {});
      if (await tryClick(page, "button", "Tasks")) notes.push("Tasks nav opened (may be coming-soon placeholder)");
      else missing.push("no Tasks nav reachable");
      break;
    case "bots":
      await ensureProject().catch(() => {});
      if (await tryClick(page, "button", "Bots")) notes.push("Bots route opened");
      else missing.push("no Bots nav reachable");
      break;
    case "statusbar-strip":
      await ensureTerminal().catch(() => {});
      notes.push("full-page capture; strip cropped in post");
      break;
    default:
      missing.push(`unknown state ${state}`);
  }
  return { notes, missing };
}

function execFileAsync(file, args2, opts) {
  return new Promise((resolve, reject) => {
    execFile(file, args2, opts, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
  });
}

async function candTeardown(page, state) {
  const notes = [];
  // SettingsPanel is a native <dialog>: Escape does not reliably dismiss it,
  // so use its explicit Close button first (exact match; session closes are
  // labeled "Close <name> session" and never match).
  if (await tryClick(page, "button", "Close", 1200)) {
    notes.push("teardown: dialog dismissed via Close button");
    await delay(300);
  }
  await ensureClean(page, notes);
  // Return to a stable view so later states start clean: select the first
  // strip tab when one exists (R6-B: no "Terminals" route button remains;
  // Files/Changes live in the right activity bar, Browser as a tab).
  try {
    if ((await page.getByRole("tab").count()) > 0) {
      await page.getByRole("tab").first().click({ timeout: 1500 });
      notes.push("teardown: selected first strip tab");
    }
  } catch {
    /* stay where we are */
  }
  await delay(250);
  return notes;
}

// ---------------------------------------------------------------------------
// Orchestration + ranking + report.
// ---------------------------------------------------------------------------
const ALL_STATES = [
  "empty",
  "project-terminal",
  "palette",
  "quick-open",
  "settings-appearance",
  "changes",
  "automations",
  "browser",
  "tasks",
  "bots",
  "statusbar-strip",
];

const CAND_OWNER = {
  "shell-sidebar": "apps/desktop/src/renderer/src/features/shell/Sidebar.tsx, ProjectList.tsx, WorktreeCard.tsx",
  "tab-bar": "apps/desktop/src/renderer/src/features/shell/TabBar.tsx, TabCreateMenu.tsx, tab-chrome.ts + features/browser/BrowserStripTab.tsx",
  "status-bar": "apps/desktop/src/renderer/src/components/status-bar/StatusBar.tsx",
  palette: "apps/desktop/src/renderer/src/components/command-palette/CommandPalette.tsx + shortcuts.ts",
  settings: "apps/desktop/src/renderer/src/settings-panel.tsx",
  changes: "apps/desktop/src/renderer/src/features/source-control/",
  automations: "apps/desktop/src/renderer/src/features/automations/",
  browser: "apps/desktop/src/renderer/src/features/browser/",
  tasks: "apps/desktop/src/renderer/src/features/shell/SidebarNav.tsx (placeholder; J6 owner builds the page)",
  bots: "apps/desktop/src/renderer/src/features/bots/",
  tokens: "apps/desktop/src/renderer/src/assets/main.css",
};

const STATE_SURFACE = {
  empty: "shell-sidebar",
  "project-terminal": "tab-bar",
  palette: "palette",
  "quick-open": "palette",
  "settings-appearance": "settings",
  changes: "changes",
  automations: "automations",
  browser: "browser",
  tasks: "tasks",
  bots: "bots",
  "statusbar-strip": "status-bar",
};

// Preferred source-value keywords per surface: the ranked item must cite the
// exact value to adopt (a width, a token, a copy string), not an import line.
const SOURCE_PREFERENCE = {
  "shell-sidebar": ["min_width", "max_width", "sidebarwidth", "width:", "w-["],
  "tab-bar": ["height", "h-", "min-h", "classname"],
  "status-bar": ["height", "h-6", "min-h", "classname"],
  palette: ["placeholder", "combobox", "input", "shortcut"],
  settings: ["appearance", "theme", "classname"],
  changes: ["stage", "commit", "diff", "classname"],
  automations: ["schedule", "cron", "classname"],
  browser: ["address", "url", "classname"],
  tasks: ["issue", "filter", "classname"],
  bots: ["preset", "chat", "classname"],
  tokens: ["font", "geist", "text-", "leading", "tracking", "weight"],
};

// Title-anchored source overrides: well-known controls cite their exact
// owner file (verified by grep during R5-F), not the state surface file.
const TITLE_SOURCES = [
  // R6-B right sidebar + tab strip anchors (ordered most-specific first:
  // "Toggle sidebar" is a substring of "Toggle right sidebar").
  { match: "Toggle right sidebar", file: "src/renderer/src/components/right-sidebar/index.tsx", probes: ["Toggle right sidebar", "aria-label"], cand: "apps/desktop/src/renderer/src/features/right-sidebar/RightSidebar.tsx" },
  { match: "Source Control", file: "src/renderer/src/components/right-sidebar/activity-bar-buttons.tsx", probes: ["aria-label", "activityItemAriaLabel"], cand: "apps/desktop/src/renderer/src/features/right-sidebar/RightSidebar.tsx" },
  { match: "New Browser Tab", file: "src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx", probes: ["New Browser Tab"], cand: "apps/desktop/src/renderer/src/features/shell/TabCreateMenu.tsx" },
  { match: "New Terminal", file: "src/renderer/src/components/tab-bar/tab-bar-static-create-menu.tsx", probes: ["New Terminal"], cand: "apps/desktop/src/renderer/src/features/shell/TabCreateMenu.tsx" },
  { match: "Toggle sidebar", file: "src/renderer/src/app-shell/TitlebarLeftControls.tsx", probes: ["Toggle sidebar", "aria-label"], cand: "apps/desktop/src/renderer/src/features/shell/Sidebar.tsx" },
  { match: "Go back", file: "src/renderer/src/app-shell/TitlebarLeftControls.tsx", probes: ["Go back", "aria-label"], cand: "apps/desktop/src/renderer/src/features/shell/Sidebar.tsx" },
  { match: "Go forward", file: "src/renderer/src/app-shell/TitlebarLeftControls.tsx", probes: ["Go forward", "aria-label"], cand: "apps/desktop/src/renderer/src/features/shell/Sidebar.tsx" },
  { match: "Search worktrees and browser tabs", file: "src/renderer/src/components/sidebar/SidebarNav.tsx", probes: ["Search worktrees and browser tabs", "aria-label"], cand: "apps/desktop/src/renderer/src/features/shell/SidebarNav.tsx" },
  { match: "Drogon logo", file: "src/renderer/src/components/Landing.tsx", probes: ["Drogon logo", "alt", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
  { match: "Star on GitHub", file: "src/renderer/src/components/StarNagCard.tsx", probes: ["Star on GitHub", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
  { match: "Create workspace", file: "src/renderer/src/components/Landing.tsx", probes: ["Create workspace", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
  { match: "Add Project", file: "src/renderer/src/components/Landing.tsx", probes: ["Add Project", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
  { match: "Show floating workspace", file: "src/renderer/src/app-shell/use-floating-workspace-panel.ts", probes: ["Show floating workspace", "aria-label"], cand: "apps/desktop/src/renderer/src/App.tsx" },
];

const titleSourceCache = new Map();
async function titleSource(title) {
  const hit = TITLE_SOURCES.find((t) => title.includes(t.match));
  if (!hit) return null;
  if (titleSourceCache.has(hit.match)) return titleSourceCache.get(hit.match);
  let value = "(no probe line matched; open the file)";
  try {
    const text = await readFile(path.join(REF_ROOT, hit.file), "utf8");
    outer: for (const probe of hit.probes) {
      for (const line of text.split("\n")) {
        if (line.includes(probe)) {
          value = `${probe}: ${line.trim().slice(0, 170)}`;
          break outer;
        }
      }
    }
  } catch {
    value = "(source file unreadable)";
  }
  const result = { file: hit.file, value, cand: hit.cand };
  titleSourceCache.set(hit.match, result);
  return result;
}

function surfaceRefFile(surfaceId, inventory) {
  const entry = inventory.find((e) => e.id === surfaceId);
  const prefs = SOURCE_PREFERENCE[surfaceId] ?? [];
  let best = null;
  for (const r of entry?.ref ?? []) {
    if (!r.exists) continue;
    for (const m of r.matches) {
      const line = m.includes(": ") ? m.slice(m.indexOf(": ") + 2) : m;
      let score = scoreProbeLine(line);
      const lower = line.toLowerCase();
      for (const p of prefs) if (lower.includes(p)) score += 5;
      if (!best || score > best.score) best = { file: r.file, value: m, score };
    }
  }
  if (best) return { file: best.file, value: best.value };
  const any = entry?.ref.find((r) => r.exists);
  if (any) return { file: any.file, value: "(no probe line matched; open the file)" };
  return { file: entry?.ref[0]?.file ?? "(unknown)", value: "(source file not found at inventoried path)" };
}

async function runState(side, page, state, outDir, ctx, setup, teardown) {
  const base = path.join(outDir, `${state}.${side}`);
  const { notes, missing } = await setup(page, state, ctx);
  const schemes = NO_DARK ? ["light"] : ["light", "dark"];
  const caps = {};
  for (const scheme of schemes) {
    try {
      caps[scheme] = await captureTriple(page, base, scheme);
    } catch (error) {
      missing.push(`${side} ${scheme} capture failed: ${error.message.split("\n")[0]}`);
    }
  }
  if (state === "statusbar-strip" && caps.light) {
    try {
      const full = caps.light.png;
      const strip = `${base}.strip.png`;
      const box = await page.locator("body").boundingBox();
      const h = box?.height ?? VIEWPORT.height;
      const w = box?.width ?? VIEWPORT.width;
      await page.screenshot({ path: strip, animations: "disabled", clip: { x: 0, y: Math.max(0, h - 48), width: w, height: Math.min(48, h) } });
      notes.push("cropped status strip saved as .strip.png");
    } catch {
      notes.push("strip crop best-effort only");
    }
  }
  try {
    const extra = await teardown(page, state);
    if (Array.isArray(extra)) notes.push(...extra);
  } catch {
    /* teardown is best-effort */
  }
  return { notes, missing, caps };
}

async function rankDifferences(stateResults, inventory) {
  const items = [];
  const push = (area, title, detail, surfaceId, evidence) => {
    const src = surfaceRefFile(surfaceId, inventory);
    items.push({
      area,
      title,
      detail,
      sourceFile: src.file,
      sourceValue: src.value,
      candidateFile: CAND_OWNER[surfaceId] ?? "apps/desktop/src/renderer/src/App.tsx",
      evidence,
      state: detail.state,
    });
  };
  for (const r of stateResults) {
    const surface = STATE_SURFACE[r.state] ?? "shell-sidebar";
    for (const m of r.refMissing) {
      items.push({
        area: "structure",
        title: `[${r.state}] reference side: ${m.slice(0, 120)}`,
        detail: { state: r.state, kind: "ref-missing", text: m },
        sourceFile: surfaceRefFile(surface, inventory).file,
        sourceValue: surfaceRefFile(surface, inventory).value,
        candidateFile: CAND_OWNER[surface],
        evidence: "rendered-only",
        state: r.state,
      });
    }
    for (const m of r.candMissing) {
      items.push({
        area: m.includes("fixture") || m.includes("unavailable") ? "structure" : "interaction",
        title: `[${r.state}] candidate: ${m.slice(0, 120)}`,
        detail: { state: r.state, kind: "cand-missing", text: m },
        sourceFile: surfaceRefFile(surface, inventory).file,
        sourceValue: surfaceRefFile(surface, inventory).value,
        candidateFile: CAND_OWNER[surface],
        evidence: "rendered-only",
        state: r.state,
      });
    }
    if (!r.diff) continue;
    // Chrome geometry cites the chrome owner, not the incidental state.
    const REGION_SURFACE = { sidebar: "shell-sidebar", tablist: "tab-bar", statusbar: "status-bar" };
    for (const [region, dd] of Object.entries(r.diff.geom)) {
      if (!dd || region === "heading") continue;
      if (Math.abs(dd.dw) >= 3 || Math.abs(dd.dh) >= 3) {
        push(
          "layout",
          `[${r.state}] ${region} geometry differs (ref ${dd.refW}x${dd.refH} vs cand ${dd.candW}x${dd.candH})`,
          { state: r.state, kind: "geometry", region, ...dd },
          REGION_SURFACE[region] ?? surface,
          dd.sourceBacked ? "both" : "rendered-only",
        );
      }
    }
    const head = r.diff.headline;
    if (head) {
      push(
        "typography",
        `[${r.state}] headline type differs (ref "${head.refText}" ${head.refSize}/${head.refWeight} vs cand "${head.candText}" ${head.candSize}/${head.candWeight})`,
        { state: r.state, kind: "headline", ...head },
        "tokens",
        "rendered-only",
      );
    }
    for (const c of r.diff.aria.changed.slice(0, 6)) {
      push(
        "copy",
        `[${r.state}] text differs: ref "${c.ref.slice(0, 90)}" vs cand "${c.cand.slice(0, 90)}"`,
        { state: r.state, kind: "text", ref: c.ref, cand: c.cand },
        surface,
        "rendered-only",
      );
    }
    for (const m of r.diff.aria.missing.slice(0, 4)) {
      push(
        "structure",
        `[${r.state}] in ref but not candidate: "${m.slice(0, 100)}"`,
        { state: r.state, kind: "aria-missing", text: m },
        surface,
        "rendered-only",
      );
    }
    for (const a of r.diff.aria.added.slice(0, 4)) {
      push(
        "structure",
        `[${r.state}] in candidate but not ref: "${a.slice(0, 100)}"`,
        { state: r.state, kind: "aria-added", text: a },
        surface,
        "rendered-only",
      );
    }
  }
  // The same chrome delta (sidebar/statusbar width) repeats in every state:
  // collapse identical geometry signatures into one item listing all states
  // so the top-30 has room for per-surface findings.
  const geoSeen = new Map();
  const deduped = [];
  for (const item of items) {
    if (item.detail.kind !== "geometry") {
      deduped.push(item);
      continue;
    }
    const d = item.detail;
    const key = `${d.region}|${d.dw}|${d.dh}|${d.dx}|${d.dy}`;
    const prev = geoSeen.get(key);
    if (!prev) {
      geoSeen.set(key, item);
      item.states = [item.state];
      deduped.push(item);
    } else {
      prev.states.push(item.state);
    }
  }
  // Identical copy/typography findings across states collapse the same way.
  const copySeen = new Map();
  const final = [];
  for (const item of deduped) {
    if (item.detail.kind === "geometry") {
      final.push(item);
      continue;
    }
    const key = `${item.detail.kind}|${item.title.replace(/^\[[^\]]+\]\s*/, "")}`;
    const prev = copySeen.get(key);
    if (!prev) {
      copySeen.set(key, item);
      item.states = item.states ?? [item.state];
      final.push(item);
    } else {
      prev.states.push(item.state);
    }
  }
  for (const item of final) {
    if (item.states?.length > 1) {
      item.title = item.title.replace(
        `[${item.state}]`,
        `[${item.states.length} states: ${item.states.join(", ")}]`,
      );
    }
  }
  for (const item of final) {
    if (!["aria-missing", "aria-added", "text"].includes(item.detail.kind)) continue;
    const anchor = await titleSource(`${item.title} ${item.detail.text ?? ""} ${item.detail.ref ?? ""} ${item.detail.cand ?? ""}`);
    if (anchor) {
      item.sourceFile = anchor.file;
      item.sourceValue = anchor.value;
      item.candidateFile = anchor.cand;
      if (item.evidence === "rendered-only") item.evidence = "both";
    }
  }
  const areaRank = { layout: 0, typography: 1, structure: 2, copy: 3, interaction: 4 };
  const evRank = { both: 0, "rendered-only": 1, "source-only": 2 };
  final.sort(
    (a, b) => evRank[a.evidence] - evRank[b.evidence] || areaRank[a.area] - areaRank[b.area],
  );
  return final.slice(0, 30);
}

function md(items) {
  return items.map((i) => `- ${i}`).join("\n");
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = OUT ? path.resolve(OUT) : path.join(root, ".preflight", "fidelity", runId);
  await mkdir(outDir, { recursive: true });
  const states = STATES_FILTER?.length ? ALL_STATES.filter((s) => STATES_FILTER.includes(s)) : ALL_STATES;

  const inventory = await buildInventory();

  // Reference side (read-only confirmation).
  let refBrowser = null;
  let refPage = null;
  const refMeta = { initialScheme: "light", initialViewport: null };
  try {
    refBrowser = await chromium.connectOverCDP(REF_CDP);
  } catch (error) {
    console.error(
      `Reference app not reachable at ${REF_CDP}: ${error.message.split("\n")[0]}\n` +
        "Start the orca-drogon dev app on this Mac (CDP http://127.0.0.1:9445) and re-run. The candidate was not started.",
    );
    process.exitCode = 2;
    return;
  }
  // Candidate side (owned).
  let owned = null;
  let candPage = null;
  let candBrowser = null;
  try {
    refPage = refBrowser.contexts()[0]?.pages()[0];
    assert.ok(refPage, "Reference CDP has no open page");
    refPage.setDefaultTimeout(15000);
    refMeta.initialViewport = refPage.viewportSize();
    refMeta.initialScheme = await refPage.evaluate(() =>
      matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    ).catch(() => "light");
    refMeta.title = await refPage.title().catch(() => "?");
    refMeta.url = refPage.url();

    if (CAND_CDP) {
      candBrowser = await chromium.connectOverCDP(CAND_CDP);
      candPage = candBrowser.contexts()[0]?.pages()[0];
      assert.ok(candPage, "Candidate CDP has no open page");
      candPage.setDefaultTimeout(15000);
    } else {
      owned = await launchCandidate();
      candPage = owned.page;
    }
    const candVersions = await candPage.evaluate(async () => {
      try {
        const status = await window.drogon.status();
        const build = await window.drogon.buildInfo().catch(() => null);
        return { status: status.ok ? status.result : status, build };
      } catch (error) {
        return { error: error.message };
      }
    }).catch((error) => ({ error: error.message }));

    const ctx = { workspace: owned?.workspace ?? "<external-candidate>" };
    const reacquire = async (browser, label) => {
      const page = browser.contexts()[0]?.pages()[0];
      assert.ok(page, `${label} CDP has no open page (reacquire)`);
      page.setDefaultTimeout(15000);
      return page;
    };
    const safeRun = async (side, page, state, setup, teardown) => {
      try {
        return { result: await runState(side, page, state, outDir, ctx, setup, teardown), page };
      } catch (error) {
        // One bad state (transient CDP blip, HMR reload) must not kill the
        // run: record it, reacquire the page, and continue with the rest.
        console.log(`state ${state} ${side} setup error (isolated): ${error.message.split("\n")[0]}`);
        return {
          result: {
            notes: [],
            missing: [`${side} setup error (isolated, run continued): ${error.message.split("\n")[0]}`],
            caps: {},
          },
          page,
        };
      }
    };
    const stateResults = [];
    for (const state of states) {
      let ref, cand;
      ({ result: ref, page: refPage } = await safeRun("ref", refPage, state, refSetup, refTeardown));
      if (!ref.caps.light) {
        try {
          refPage = await reacquire(refBrowser, "Reference");
        } catch {
          /* keep the old handle; next state will report again */
        }
      }
      ({ result: cand, page: candPage } = await safeRun("cand", candPage, state, candSetup, candTeardown));
      const refCap = ref.caps.light;
      const candCap = cand.caps.light;
      let diff = null;
      if (refCap && candCap) {
        const aria = diffAria(refCap.aria, candCap.aria);
        const geom = {};
        for (const region of Object.keys(REGION_QUERIES)) {
          const a = refCap.dom.regions[region];
          const b = candCap.dom.regions[region];
          const dd = geomDelta(a, b);
          geom[region] = dd
            ? { ...dd, refW: a.rect.w, refH: a.rect.h, candW: b.rect.w, candH: b.rect.h, refSel: a.sel, candSel: b.sel, sourceBacked: true }
            : { missing: true, refSel: a?.sel ?? null, candSel: b?.sel ?? null, sourceBacked: false };
        }
        const rh = refCap.dom.headlines[0];
        const ch = candCap.dom.headlines[0];
        const headline =
          rh && ch && (rh.text !== ch.text || rh.fontSize !== ch.fontSize || rh.fontWeight !== ch.fontWeight)
            ? {
                refText: rh.text.slice(0, 80),
                candText: ch.text.slice(0, 80),
                refSize: rh.fontSize,
                candSize: ch.fontSize,
                refWeight: rh.fontWeight,
                candWeight: ch.fontWeight,
                refFont: rh.fontFamily,
                candFont: ch.fontFamily,
              }
            : null;
        diff = { aria, geom, headline };
      }
      stateResults.push({
        state,
        refNotes: ref.notes,
        refMissing: ref.missing,
        candNotes: cand.notes,
        candMissing: cand.missing,
        diff,
      });
      console.log(
        `state ${state}: ref aria ${refCap ? ariaLines(refCap.aria).length : "?"} lines, ` +
          `cand aria ${candCap ? ariaLines(candCap.aria).length : "?"} lines` +
          (diff ? `, missing=${diff.aria.missing.length} added=${diff.aria.added.length} changed=${diff.aria.changed.length}` : ""),
      );
    }

    // Restore the reference page's views and appearance overrides; data untouched.
    try {
      await refPage.emulateMedia({ colorScheme: refMeta.initialScheme });
      if (refMeta.initialViewport) await refPage.setViewportSize(refMeta.initialViewport);
      const restoreNotes = [];
      await ensureClean(refPage, restoreNotes);
      await tryClick(refPage, "button", "Back to app", 1500);
      await tryClick(refPage, "button", "Sessions", 1500);
      await ensureClean(refPage, restoreNotes);
      if (restoreNotes.length) console.log(`ref restore: ${restoreNotes.join("; ")}`);
    } catch {
      /* best-effort restore */
    }

    const ranked = await rankDifferences(stateResults, inventory);
    const report = renderReport({ runId, states, inventory, stateResults, ranked, refMeta, candVersions, outDir });
    await writeFile(path.join(outDir, "report.md"), report);
    await writeFile(path.join(outDir, "index.html"), renderIndex(states));
    console.log(JSON.stringify({ status: "PASSED", report: path.join(outDir, "report.md"), states, ranked: ranked.length }));
  } finally {
    try {
      await refBrowser?.close().catch(() => {});
    } catch {
      /* nothing owned here */
    }
    if (candBrowser && !owned) {
      try {
        await candBrowser.close().catch(() => {});
      } catch {
        /* external candidate left alone */
      }
    }
    if (owned && !KEEP) {
      const notes = await stopCandidate(owned);
      for (const n of notes) console.log(`cleanup: ${n}`);
    } else if (owned && KEEP) {
      console.log(`kept: fixture ${owned.fixture}`);
    }
  }
}

function renderReport({ runId, states, inventory, stateResults, ranked, refMeta, candVersions, outDir }) {
  const lines = [];
  lines.push(`# R5-F fidelity report — ${runId}`);
  lines.push("");
  lines.push(`Viewport 1440x900, schemes: ${NO_DARK ? "light" : "light + dark"}.`);
  lines.push(`Reference (read-only, confirmation only): CDP ${REF_CDP} — title "${refMeta.title}", url ${refMeta.url}.`);
  lines.push(`Candidate: ${CAND_CDP ? `external CDP ${CAND_CDP}` : "owned production bundle (apps/desktop/out) + real drogond in a temp data dir, --remote-debugging-port=0"}.`);
  lines.push(`Candidate versions: ${JSON.stringify(candVersions).slice(0, 400)}`);
  lines.push("");
  lines.push("Method: the SOURCE OF TRUTH is the reference source code. Expected structure, classes/tokens, copy, shortcuts and behavior come from the inventoried files below; the running reference instance only confirms the rendered result. Sensitive text (paths, usernames, hashes, durations) is normalized to placeholders before diffing and is never a difference. Where a surface does not exist on one side, the state records \"missing\" explicitly.");
  lines.push("");
  lines.push("## 1. Source component inventory (reference)");
  lines.push("");
  lines.push("| MVP surface | Reference source (exists?) | Expected-value probes | Candidate owner |");
  lines.push("|---|---|---|---|");
  for (const entry of inventory) {
    const refs = entry.ref.map((r) => `${r.file}${r.exists ? "" : " (NOT FOUND)"}`).join("<br>");
    const probes = entry.ref.flatMap((r) => r.matches).slice(0, 3).join("<br>") || "—";
    lines.push(`| ${entry.label} | ${refs} | ${probes} | ${(entry.candFiles ?? []).join("<br>")} |`);
  }
  lines.push("");
  lines.push("Exact source components per surface (`<dir>`: first files, tests last):");
  lines.push("");
  for (const entry of inventory) {
    lines.push(`- ${entry.label} — \`${entry.refDir ?? "(no dir)"}\`: ${(entry.dirListing ?? []).slice(0, 14).join(", ")}`);
  }
  lines.push("");
  lines.push("Reference token anchors (`src/renderer/src/assets/main.css`): `--app-font-family: 'Geist', …`, `--font-mono: 'SF Mono', …`, `--radius: 0.625rem`, monochrome roles (`background/foreground`, `sidebar/*`, `muted`, `accent`, `border`, `ring`), git decoration tokens; see `docs/STYLEGUIDE.md` for roles. Candidate must adopt the same variables in `apps/desktop/src/renderer/src/assets/main.css`.");
  lines.push("");
  lines.push("## 2. Per-state results");
  lines.push("");
  for (const r of stateResults) {
    lines.push(`### ${r.state}`);
    lines.push("");
    if (r.diff) {
      const { aria, geom, headline } = r.diff;
      lines.push(`- ARIA: ref ${aria.refLines} lines vs cand ${aria.candLines} lines — missing ${aria.missing.length}, added ${aria.added.length}, changed ${aria.changed.length}.`);
      for (const [region, dd] of Object.entries(geom)) {
        if (!dd || dd.missing) {
          lines.push(`- Geometry ${region}: not measurable on ${!dd ? "both" : "one"} side(s) (ref sel ${dd?.refSel ?? "—"}, cand sel ${dd?.candSel ?? "—"}).`);
        } else {
          lines.push(`- Geometry ${region}: ref ${dd.refW}x${dd.refH} @(${dd.refSel}) vs cand ${dd.candW}x${dd.candH} @(${dd.candSel}) — Δw ${dd.dw}, Δh ${dd.dh}, Δx ${dd.dx}, Δy ${dd.dy}.`);
        }
      }
      if (headline) lines.push(`- Headline: ref "${headline.refText}" ${headline.refSize}/${headline.refWeight} ${headline.refFont} vs cand "${headline.candText}" ${headline.candSize}/${headline.candWeight} ${headline.candFont}.`);
      for (const c of aria.changed.slice(0, 8)) lines.push(`  - text: ref "${c.ref.slice(0, 120)}" → cand "${c.cand.slice(0, 120)}"`);
      for (const m of aria.missing.slice(0, 6)) lines.push(`  - ref-only: "${m.slice(0, 120)}"`);
      for (const a of aria.added.slice(0, 6)) lines.push(`  - cand-only: "${a.slice(0, 120)}"`);
    } else {
      lines.push("- No light-scheme pair captured on both sides; see missing notes.");
    }
    if (r.refNotes.length) lines.push(md(r.refNotes.map((n) => `ref note: ${n}`)));
    if (r.refMissing.length) lines.push(md(r.refMissing.map((n) => `ref MISSING: ${n}`)));
    if (r.candNotes.length) lines.push(md(r.candNotes.map((n) => `cand note: ${n}`)));
    if (r.candMissing.length) lines.push(md(r.candMissing.map((n) => `cand MISSING: ${n}`)));
    lines.push("");
  }
  lines.push("## 3. Ranked differences (top 30 by user visibility)");
  lines.push("");
  lines.push("Layout regions first, then typography, then copy/icons, then interactions. `both` = confirmed by source reading AND rendered comparison; `rendered-only` = seen rendered, source value to adopt is cited from the inventory file.");
  lines.push("");
  ranked.forEach((item, i) => {
    lines.push(`### ${i + 1}. [${item.area}] [${item.evidence}] ${item.title}`);
    lines.push("");
    lines.push(`- State: ${item.state}. Kind: ${item.detail.kind}.`);
    lines.push(`- Source (adopt this): \`${item.sourceFile}\` — ${item.sourceValue}`);
    lines.push(`- Candidate file to change: \`${item.candidateFile}\``);
    if (item.detail.text) lines.push(`- Detail: "${String(item.detail.text).slice(0, 200)}"`);
    if (item.detail.kind === "geometry") lines.push(`- Detail: Δw ${item.detail.dw}px, Δh ${item.detail.dh}px, Δx ${item.detail.dx}px, Δy ${item.detail.dy}px.`);
    if (item.detail.kind === "text") lines.push(`- Detail: ref "${String(item.detail.ref).slice(0, 160)}" vs cand "${String(item.detail.cand).slice(0, 160)}".`);
    lines.push("");
  });
  if (!ranked.length) {
    lines.push("No differences recorded (both sides identical or nothing measurable — treat with suspicion, see §2).");
    lines.push("");
  }
  lines.push("## 4. Artifacts");
  lines.push("");
  lines.push(`- \`.preflight/fidelity/<run>/<state>.{ref,cand}.{png,aria.yaml,dom.json}\` (+ \`.dark.*\`, \`statusbar-strip.*.strip.png\`). PNG/HTML stay git-ignored; only this report.md is committed.`);
  lines.push("- `index.html` (ignored): side-by-side viewer for this run.");
  lines.push(`- Run dir: ${outDir}`);
  lines.push("");
  return lines.join("\n");
}

function renderIndex(states) {
  const rows = states
    .map((s) => {
      const cell = (side, dark) =>
        `<td><div>${s}.${side}${dark ? ".dark" : ""}</div><a href="${s}.${side}${dark ? ".dark" : ""}.png"><img loading="lazy" style="max-width:100%" src="${s}.${side}${dark ? ".dark" : ""}.png"></a><div><a href="${s}.${side}${dark ? ".dark" : ""}.aria.yaml">aria</a> · <a href="${s}.${side}${dark ? ".dark" : ""}.dom.json">dom</a></div></td>`;
      return `<tr><th>${s}</th>${cell("ref", false)}${cell("cand", false)}</tr>` +
        (NO_DARK ? "" : `<tr><th>${s} (dark)</th>${cell("ref", true)}${cell("cand", true)}</tr>`);
    })
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>fidelity run</title></head><body><h1>fidelity run (ref vs cand)</h1><table border="1" cellpadding="8"><tr><th>state</th><th>ref</th><th>cand</th></tr>${rows}</table></body></html>\n`;
}

await main().catch((error) => {
  console.error(`FIDELITY FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});

