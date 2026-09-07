// V2 keyboard/focus/theme CDP probe (committed, V2-owned). Real dev
// drogond + real dev Electron over Playwright CDP; no mocks, no fixture
// daemon. Lifecycle uses the existing scripts/acceptance-process.mjs
// seams (start/stop), never raw SIGKILL. Shots go to gitignored
// .preflight/v2-kbd-<ts>/; the JSON report prints to stdout.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire as createRequireRoot } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(
  fileURLToPath(new URL("../../../../../package.json", import.meta.url)),
);
const appDir = path.join(ROOT, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const daemonBin = path.join(
  ROOT,
  "target",
  "debug",
  process.platform === "win32" ? "drogond.exe" : "drogond",
);
const { chromium } = createRequireRoot(path.join(ROOT, "package.json"))("playwright");
const { startAcceptanceProcess, stopAcceptanceProcess } = await import(
  path.join(ROOT, "scripts", "acceptance-process.mjs")
);

if (process.platform === "win32") {
  console.log(
    JSON.stringify({ status: "UNVERIFIED", reason: "probe not yet verified on Windows", checks: [] }, null, 1),
  );
  process.exitCode = 2;
  process.exit(process.exitCode);
}

const fixture = await mkdtemp(path.join(tmpdir(), "v2-kbd-"));
const dataDir = path.join(fixture, "data");
await mkdir(dataDir, { recursive: true });
const folder = path.join(fixture, "folder");
await mkdir(folder);
// A realistically long repository name: everyday repo names exceed the
// header space a narrow window can give the workspace heading.
const longFolder = path.join(
  fixture,
  "responsiveshellprobewithadeliberatelylongrepositoryname",
);
await mkdir(longFolder);
const shots = path.join(ROOT, ".preflight", `v2-kbd-${Date.now()}`);
await mkdir(shots, { recursive: true });

const report = { status: "FAILED", checks: [], shots };
let daemon;
let desktop;
let browser = null;
let page = null;
let probeWorkspaceId = null;
async function stopOwned(child, label) {
  if (!child) return null;
  const result = await stopAcceptanceProcess(child);
  report.checks.push(`${label}: ${result.verdict}${result.forced ? " (FORCED)" : ""}`);
  if (result.forced || result.verdict !== "exited") report.status = "FAILED";
  return result;
}
// Redundant control channels: the renderer bridge first, the existing CLI
// against the same data dir when the page is dead. Final invariant demands
// every retained session verdict===exited (unverifiable is not death).
import { execFile } from "node:child_process";

const cliBin = path.join(
  ROOT,
  "target",
  "debug",
  process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli",
);

function cliJson(args) {
  return new Promise((resolve, reject) => {
    execFile(cliBin, ["--data-dir", dataDir, "--json", ...args], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`cli ${args.slice(0, 2).join(" ")} failed: ${stderr || error.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (cause) {
        reject(new Error(`cli ${args.slice(0, 2).join(" ")} bad JSON: ${cause.message}`));
      }
    });
  });
}

function checked(envelope, what) {
  if (!envelope || envelope.ok !== true)
    throw new Error(`${what} not ok: ${JSON.stringify(envelope?.error ?? envelope)}`);
  return envelope.result;
}

// Layout-matrix helpers (V2 shell breadth): pure in-page measurements, no mocks.
async function layoutAudit() {
  return page.evaluate(() => {
    const targets = [];
    const sidebar = document.querySelector('aside[aria-label="Workspaces"]');
    if (sidebar) targets.push(["sidebar", sidebar]);
    document
      .querySelectorAll('nav[aria-label="Panels"] button')
      .forEach((b) => targets.push(["panels-nav", b]));
    document
      .querySelectorAll(".header-actions button")
      .forEach((b, i) => targets.push([`header-action-${i}`, b]));
    return {
      scrollWidth: document.scrollingElement.scrollWidth,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      headingSpill: (() => {
        const name = document.querySelector(".workspace-heading strong");
        if (!name) return 0;
        return {
          spill: name.scrollWidth - name.clientWidth,
          clipped: getComputedStyle(name).overflowX === "hidden",
        };
      })(),
      targets: targets.map(([name, el]) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return {
          name,
          label: (el.textContent ?? "").trim().slice(0, 24),
          disabled: el.disabled === true,
          rect: [
            Math.round(r.left),
            Math.round(r.top),
            Math.round(r.right),
            Math.round(r.bottom),
          ],
          inViewport:
            r.width > 0 &&
            r.height > 0 &&
            r.left >= 0 &&
            r.top >= 0 &&
            r.right <= window.innerWidth &&
            r.bottom <= window.innerHeight,
          hitOk: hit === el || el.contains(hit),
          hit: hit
            ? `${hit.tagName}.${String(hit.className?.baseVal ?? hit.className ?? "").slice(0, 50)}`
            : null,
        };
      }),
    };
  });
}

async function assertLayout(label, { withTargets }) {
  // Audit only a settled shell: transient busy states legitimately disable
  // controls (disabled = pointer-events-none), which is behavior, not layout.
  await page.waitForFunction(
    () => {
      const buttons = [...document.querySelectorAll(".header-actions button")];
      return buttons.length > 0 && buttons.every((b) => !b.disabled);
    },
    { timeout: 20000 },
  );
  const audit = await layoutAudit();
  assert.ok(
    audit.scrollWidth <= audit.innerWidth,
    `${label}: horizontal overflow scrollWidth ${audit.scrollWidth} > innerWidth ${audit.innerWidth}`,
  );
  report.checks.push(
    `layout-no-h-overflow-${label}(${audit.scrollWidth}<=${audit.innerWidth})`,
  );
  // The workspace heading must be clip-contained: a long unbroken name must
  // ellipsize inside its box, never paint under the header action buttons
  // (the sibling .path rule already behaves this way).
  assert.ok(
    audit.headingSpill.clipped === true,
    `${label}: workspace heading not clip-contained (overflow-x visible, spill ${audit.headingSpill.spill}px)`,
  );
  report.checks.push(
    `layout-heading-clip-contained-${label}(spill ${audit.headingSpill.spill}px)`,
  );
  if (!withTargets) return;
  const broken = audit.targets.filter((t) => !t.inViewport || !t.hitOk);
  assert.deepEqual(
    broken,
    [],
    `${label}: clipped/covered primary controls ${JSON.stringify(broken)} audit=${JSON.stringify(audit)}`,
  );
  report.checks.push(
    `layout-primary-controls-clickable-${label}(${audit.targets.length})`,
  );
}

async function setSystemTheme() {
  await page.evaluate(() => {
    window.localStorage.setItem(
      "drogon:settings:ui",
      JSON.stringify({ settings: { theme: "system" } }),
    );
  });
  await page.reload();
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();
}

// Contrast evidence (settled themes only): WCAG 2.x relative-luminance
// ratios computed in-page from getComputedStyle used values. Intermediate or
// transitioning theme colors are explicitly NOT evaluated here.
async function setSettledTheme(theme) {
  await page.evaluate((value) => {
    window.localStorage.setItem(
      "drogon:settings:ui",
      JSON.stringify({ settings: { theme: value } }),
    );
  }, theme);
  await page.reload();
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();
  await page.emulateMedia({ colorScheme: theme });
  await page.waitForFunction(
    (want) => {
      const dark = want === "dark";
      const root = document.documentElement;
      if (root.classList.contains("dark") !== dark) return false;
      return (
        getComputedStyle(root).getPropertyValue("--background").trim() ===
        (dark ? "#0a0a0a" : "#fff")
      );
    },
    theme,
    { timeout: 10000 },
  );
}

// Self-contained page-side measurement: parses resolved rgb()/rgba() colors,
// composites alpha over the actual adjacent surface, and returns WCAG ratios.
function measureContrast() {
  const parse = (color) => {
    const m = /rgba?\(([^)]+)\)/.exec(color);
    if (!m) return null;
    const parts = m[1].split(",").map((s) => parseFloat(s.trim()));
    if (parts.length < 3 || parts.some((v) => Number.isNaN(v))) return null;
    return {
      r: parts[0],
      g: parts[1],
      b: parts[2],
      a: parts.length > 3 ? parts[3] : 1,
    };
  };
  const over = (fg, bg) => {
    // General (un-premultiplied) Porter-Duff "A over B": bg may itself be
    // non-opaque (multi-layer surface() chains), so its channels must be
    // weighted by bg.a and the result un-premultiplied by the output alpha.
    const a = fg.a + bg.a * (1 - fg.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (fg.r * fg.a + bg.r * bg.a * (1 - fg.a)) / a,
      g: (fg.g * fg.a + bg.g * bg.a * (1 - fg.a)) / a,
      b: (fg.b * fg.a + bg.b * bg.a * (1 - fg.a)) / a,
      a,
    };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const style = (el, prop) => getComputedStyle(el)[prop];
  const body = document.body;
  const bodyBg = parse(style(body, "backgroundColor"));
  const muted = document.querySelector(".sidebar-footer");
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent.trim() === "New terminal",
  );
  const header = document.querySelector(".session-header");
  if (!bodyBg || !muted || !button || !header) return null;
  // ROOT correction: a transparent element shows its nearest opaque
  // ancestor, not the body (e.g. transparent .sidebar-footer renders over
  // opaque .workspace-sidebar #fafafa/#171717). Composite every layer from
  // the body down to the element, stopping at the first opaque result.
  const surface = (el) => {
    const chain = [];
    for (
      let node = el;
      node && node.nodeType === 1;
      node = node.parentElement
    ) {
      chain.push(node);
      if (node === body) break;
    }
    // Painter's order: start at the element, composite outward until opaque.
    let bg = null;
    for (let i = 0; i < chain.length; i++) {
      const layer = parse(style(chain[i], "backgroundColor"));
      if (!layer) continue;
      bg = bg === null ? layer : over(bg, layer);
      if (bg.a >= 1) break;
    }
    return bg ?? bodyBg;
  };
  const mutedSurface = surface(muted);
  const buttonBg = surface(button);
  const headerSurface = surface(header);
  // Header icons: lucide glyphs stroke with currentColor, so the button's
  // computed color is the icon foreground; ghost buttons render on
  // transparent over the canvas.
  const iconRatio = (ariaLabel) => {
    const btn = [...document.querySelectorAll(".header-actions button")].find(
      (b) => b.getAttribute("aria-label") === ariaLabel,
    );
    if (!btn) return null;
    const source = btn.querySelector("svg") ?? btn;
    const surfaceColor = surface(btn);
    return ratio(over(parse(style(source, "color")), surfaceColor), surfaceColor);
  };
  return {
    body: ratio(parse(style(body, "color")), bodyBg),
    muted: ratio(
      over(parse(style(muted, "color")), mutedSurface),
      mutedSurface,
    ),
    primaryButton: ratio(
      over(parse(style(button, "color")), buttonBg),
      buttonBg,
    ),
    border: ratio(
      over(parse(style(header, "borderBottomColor")), headerSurface),
      headerSurface,
    ),
    icons: {
      refresh: iconRatio("Refresh connection"),
      inspector: iconRatio("Toggle session details"),
    },
  };
}

function assertContrast(theme, measured) {
  report.contrast = report.contrast ?? {};
  const textThreshold = 4.5;
  const uiThreshold = 3.0;
  const record = (name, ratio, threshold, gate) => {
    const pass = ratio >= threshold;
    const tag = `${theme}-${name}(${ratio.toFixed(2)}:1,AA-${pass ? "pass" : "fail"}${gate ? "" : ",recorded"})`;
    report.checks.push(`contrast-${tag}`);
    if (gate) {
      assert.ok(
        pass,
        `${theme} ${name}: contrast ${ratio.toFixed(2)}:1 below AA ${threshold}:1`,
      );
    }
    return `${ratio.toFixed(2)}:1 ${pass ? "AA-pass" : "AA-fail"}`;
  };
  report.contrast[theme] = {
    bodyText: record("body-text", measured.body, textThreshold, true),
    mutedText: record("muted-text", measured.muted, textThreshold, true),
    primaryButton: record(
      "primary-button-text",
      measured.primaryButton,
      textThreshold,
      true,
    ),
    // Hairline divider vs canvas: decorative boundary (no information is
    // conveyed solely by the border), so the WCAG 3.0 non-text verdict is
    // recorded and reported, not gated - the report owns the conclusion.
    border: record("border-ui", measured.border, uiThreshold, false),
  };
  // Header icons, settled dark only: the glyphs are the visible meaning
  // for sighted low-vision users, so aria-label/tooltip duplication does NOT
  // waive them - meaningful header glyphs gate at non-text 3.0 (ROOT).
  if (theme === "dark" && measured.icons) {
    const icons = {};
    for (const [name, value] of Object.entries(measured.icons)) {
      if (value === null) continue;
      icons[name] = record(`icon-${name}`, value, uiThreshold, true);
    }
    report.contrast[theme].icons = icons;
  }
}

async function pageUsable() {
  if (!page) return false;
  try {
    await page.evaluate(() => true);
    return true;
  } catch {
    return false;
  }
}

async function listSessions(workspaceId) {
  if (await pageUsable()) {
    const response = await page.evaluate(async (id) => window.drogon.sessions(id), workspaceId);
    if (!response.ok) throw new Error(response.error.message);
    return { channel: "page", sessions: response.result.sessions };
  }
  const result = checked(await cliJson(["terminal", "list", "--workspace", workspaceId]), "cli terminal list");
  return { channel: "cli", sessions: result.sessions };
}

async function stopSession(session) {
  if (await pageUsable()) {
    const response = await page.evaluate(
      async (target) => window.drogon.stop({ sessionId: target.id, incarnation: target.incarnation }),
      { id: session.id, incarnation: session.incarnation },
    );
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  }
  return checked(
    await cliJson(["terminal", "close", "--session", session.id, "--incarnation", session.incarnation]),
    `cli terminal close ${session.id}`,
  );
}

async function cleanupSessions(workspaceId) {
  if (!workspaceId) return;
  const first = await listSessions(workspaceId);
  report.checks.push(`session-cleanup-list-via-${first.channel}(${first.sessions.length})`);
  for (const session of first.sessions) {
    if (session.verdict === "exited") continue;
    const stopped = await stopSession(session);
    assert.equal(stopped.verdict, "exited", `session ${session.id} must exit on exact stop`);
    assert.equal(stopped.id, session.id);
    assert.equal(stopped.incarnation, session.incarnation);
    report.checks.push(`session-cleanup-exited:${session.id}`);
  }
  const last = await listSessions(workspaceId);
  const counts = {};
  for (const session of last.sessions) counts[session.verdict] = (counts[session.verdict] ?? 0) + 1;
  const nonExited = last.sessions.filter((session) => session.verdict !== "exited");
  assert.equal(nonExited.length, 0, `all retained sessions must be exited, got ${JSON.stringify(counts)}`);
  report.checks.push(`session-cleanup-all-exited(${JSON.stringify(counts)})`);
}

async function runtimeFence() {
  let status;
  if (await pageUsable()) {
    const response = await page.evaluate(async () => window.drogon.status());
    if (!response.ok) throw new Error(response.error.message);
    status = response.result;
  } else {
    status = checked(await cliJson(["status"]), "cli status");
  }
  const hostId = status.hostId ?? status.host_id;
  const serviceInstanceId = status.serviceInstanceId ?? status.service_instance_id;
  const capabilities = status.capabilities ?? [];
  assert.ok(hostId && serviceInstanceId, "status must carry host/service identity");
  if (!capabilities.includes("runtime.quiescent-shutdown.v1")) {
    report.checks.push("runtime-fence: capability not advertised, process stop only");
    return;
  }
  const admitted = checked(
    await cliJson(["rpc", "runtime.shutdown", "--params", JSON.stringify({ hostId, serviceInstanceId })]),
    "runtime.shutdown",
  );
  assert.equal(admitted.accepted, true, "shutdown must be admitted");
  report.checks.push("runtime-fence: shutdown admitted, observing kernel exit");
}
try {
  daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], { stdio: "ignore" });
  desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixture, "electron"),
      ...(process.platform === "win32" ? {} : { SHELL: "/bin/sh" }),
    },
  });
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timeout = setTimeout(() => reject(new Error(`no DevTools endpoint: ${tail}`)), 30000);
    desktop.once("error", reject);
    desktop.once("exit", () => reject(new Error(`electron exited early: ${tail}`)));
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const m = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (m) {
        clearTimeout(timeout);
        resolve(m[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  for (let i = 0; i < 200 && !page; i++) {
    page = browser.contexts()[0]?.pages()[0];
    if (!page) await delay(50);
  }
  assert.ok(page, "electron must render a page");
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByText("Service 0.1.0", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Add workspace", exact: true }).first().click();
  await page.getByLabel("Folder path").fill(folder);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("heading", { name: "Start a session" }).waitFor();
  probeWorkspaceId = await page.evaluate(async () => {
    const response = await window.drogon.workspaces();
    if (!response.ok) throw new Error(response.error.message);
    return response.result.workspaces[0].id;
  });

  // 1. Keyboard shortcut creates a terminal (darwin mod is Meta).
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+Shift+N`);
  await page.getByRole("tab").first().waitFor();
  assert.equal(await page.getByRole("tab").count(), 1);
  report.checks.push("keyboard-shortcut-creates-terminal");
  await page.screenshot({ path: path.join(shots, "kbd-new-terminal.png") });

  // 2. Second terminal + arrow/Home tab navigation with focus.
  await page.keyboard.press(`${mod}+Shift+N`);
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"]').length === 2);
  await page.getByRole("tab").last().focus();
  await page.keyboard.press("Home");
  await page.waitForFunction(() => {
    const tab = document.querySelector('[role="tab"]');
    return tab?.getAttribute("aria-selected") === "true" && document.activeElement === tab;
  });
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].at(-1);
    return tab?.getAttribute("aria-selected") === "true" && document.activeElement === tab;
  });
  report.checks.push("arrow-home-tab-navigation-moves-selection-and-focus");
  await page.screenshot({ path: path.join(shots, "kbd-tab-nav.png") });

  // 3. System theme drives .dark on the root (default theme is system).
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.screenshot({ path: path.join(shots, "theme-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  await page.screenshot({ path: path.join(shots, "theme-light.png") });
  report.checks.push("system-theme-toggles-dark-class");

  // 4. Explicit-theme palette matrix: theme choice x OS scheme asserts
  // computed custom properties + color-scheme, not just the .dark class.
  const DARK = { background: "#0a0a0a", foreground: "#fafafa", scheme: "dark" };
  const LIGHT = { background: "#fff", foreground: "#0a0a0a", scheme: "light" };
  const matrix = [
    ["system", "dark", DARK],
    ["system", "light", LIGHT],
    ["dark", "dark", DARK],
    ["dark", "light", DARK],
    ["light", "dark", LIGHT],
    ["light", "light", LIGHT],
  ];
  for (const [theme, os, expected] of matrix) {
    await page.evaluate((value) => {
      window.localStorage.setItem("drogon:settings:ui", JSON.stringify({ settings: value }));
    }, { theme });
    await page.reload();
    await page.getByText("Service 0.1.0", { exact: true }).waitFor();
    await page.emulateMedia({ colorScheme: os });
    await page.waitForFunction(
      (want) => {
        const style = getComputedStyle(document.documentElement);
        return (
          style.getPropertyValue("--background").trim() === want.background &&
          style.getPropertyValue("--foreground").trim() === want.foreground &&
          style.colorScheme === want.scheme
        );
      },
      expected,
      { timeout: 10000 },
    );
    const actual = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        background: style.getPropertyValue("--background").trim(),
        foreground: style.getPropertyValue("--foreground").trim(),
        scheme: style.colorScheme,
      };
    });
    assert.deepEqual(actual, expected, `theme=${theme} os=${os}`);
    report.checks.push(`theme-matrix-${theme}-on-${os}-os`);
  }
  await page.screenshot({ path: path.join(shots, "theme-matrix-done.png") });

  // Availability follows the real service; inactive panels remain unmounted.
  const service = await page.evaluate(() => window.drogon.status());
  assert.equal(service.ok, true);
  assert.ok(Array.isArray(service.result.capabilities));
  for (const [name, capability] of [
    ["Files", "files.v1"],
    ["Bots", "bot.snapshot.v1"],
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.waitFor();
    const available = service.result.capabilities.includes(capability);
    assert.equal(await button.isDisabled(), !available);
    if (!available) {
      assert.ok(((await button.getAttribute("title")) ?? "").includes(capability));
    }
    assert.equal(await page.locator(`section[aria-label="${name}"]`).count(), 0);
    report.checks.push(`${name.toLowerCase()}-availability-matches-service-and-inactive-panel-unmounted`);
  }
  assert.equal(await page.getByRole("tab").count(), 2);
  await page.screenshot({ path: path.join(shots, "panels-hidden-mount.png") });

  // 6. Layout matrix: responsive shell invariants at 1440x1000 and 760x600
  // in light and dark - no horizontal overflow, sidebar/Panels/header
  // controls visible and clickable (no clipped primary action), and the
  // inspector auto-hides at <=1100px while its toggle still works.
  await setSystemTheme();
  // Select the long-named workspace so the header carries realistic content
  // through every matrix size (short demo names never stress the heading).
  await page
    .getByRole("button", { name: "Add workspace", exact: true })
    .first()
    .click();
  await page.getByLabel("Folder path").fill(longFolder);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page
    .getByRole("button", {
      name: "responsiveshellprobewithadeliberatelylongrepositoryname",
    })
    .click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: "light" });
  await assertLayout("1440-light", { withTargets: true });
  await page.screenshot({ path: path.join(shots, "layout-1440-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await assertLayout("1440-dark", { withTargets: false });
  await page.screenshot({ path: path.join(shots, "layout-1440-dark.png") });

  await page.setViewportSize({ width: 760, height: 600 });
  await page.emulateMedia({ colorScheme: "light" });
  await assertLayout("760-light", { withTargets: true });
  // A real primary action must complete at the small size: open and cancel
  // the add-workspace form end to end.
  await page
    .getByRole("button", { name: "Add workspace", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  report.checks.push("layout-760-add-workspace-form-cycle");
  await page.screenshot({ path: path.join(shots, "layout-760-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await assertLayout("760-dark", { withTargets: true });
  await page.screenshot({ path: path.join(shots, "layout-760-dark.png") });

  // Inspector: open wide, shrink below 1101px -> auto-hidden by the shell
  // effect; the toggle must still work at the small size (overlay mode).
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: "Toggle session details", exact: true })
    .click();
  await page.locator('aside[aria-label="Session details"]').waitFor();
  report.checks.push("inspector-opens-wide");
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForFunction(
    () => !document.querySelector('aside[aria-label="Session details"]'),
  );
  report.checks.push("inspector-auto-hides-below-1101");
  await page
    .getByRole("button", { name: "Toggle session details", exact: true })
    .click();
  await page.locator('aside[aria-label="Session details"]').waitFor();
  await page.screenshot({ path: path.join(shots, "inspector-overlay-1000.png") });
  await page
    .getByRole("button", { name: "Toggle session details", exact: true })
    .click();
  await page.waitForFunction(
    () => !document.querySelector('aside[aria-label="Session details"]'),
  );
  report.checks.push("inspector-toggle-works-below-1101");
  await assertLayout("1000-inspector-closed", { withTargets: false });

  // 7. Contrast evidence: settled light and settled dark only (explicit
  // theme via the settings envelope + reload + token-stable wait). Text
  // surfaces gate on AA 4.5:1; the border hairline verdict is recorded for
  // the report, not gated (decorative divider, see contrast-report.md).
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const theme of ["light", "dark"]) {
    await setSettledTheme(theme);
    await page.waitForFunction(measureContrast, { timeout: 15000 });
    const measured = await page.evaluate(measureContrast);
    assert.ok(measured, `${theme}: contrast surfaces not measurable`);
    await page.screenshot({
      path: path.join(shots, `contrast-${theme}.png`),
    });
    assertContrast(theme, measured);
  }

  // Static prerequisites only; accept-desktop --files owns rendered Files acceptance.
  const cssAssets = path.join(appDir, "out", "renderer", "assets");
  const cssFile = (await readdir(cssAssets)).find((f) => f.endsWith(".css"));
  assert.ok(cssFile, "built renderer CSS not found - run electron-vite build");
  const builtCss = await readFile(path.join(cssAssets, cssFile), "utf8");
  const count = (needle) => builtCss.split(needle).length - 1;
  const cssNeedles = [
    // Token values as emitted by the build (light value minifies #ffffff -> #fff,
    // same color; the byte-identical source form is asserted in review).
    ["editor-surface-token-dark", "--editor-surface: #1e1e1e;", 2],
    ["editor-surface-token-light", "--editor-surface: #fff;", 2],
    ["files-panel-split", ".files-panel {", 2],
    ["workspace-explorer-tree", ".workspace-explorer {", 2],
    [
      "files-panel-stacked-media",
      "@media (max-width: 1100px) {",
      1,
    ],
    ["editor-pane-canvas", ".editor-pane {", 1],
    ["editor-pane-header", ".editor-pane-header {", 2],
    ["tree-fixed-240px", "width: 240px;", 1],
    ["editor-surface-textarea", ".editor-pane-surface {", 1],
    ["editor-surface-no-resize", "resize: none", 1],
    ["explorer-row", ".workspace-explorer-row {", 1],
    ["explorer-row-selected", ".workspace-explorer-row[data-current", 1],
    ["notice-overlay", ".files-panel-truncated", 1],
    // color-mix borders ship as progressive enhancement: var() fallback plus
    // an @supports-wrapped color-mix override per the build pipeline.
    ["color-mix-border", "color-mix(in srgb, var(--border) 72%, transparent)", 3],
    [
      "color-mix-supports-guard",
      "@supports (color: color-mix(in lab, red, red))",
      1,
    ],
  ];
  for (const [name, needle, min] of cssNeedles) {
    const hits = count(needle);
    assert.ok(
      hits >= min,
      `files-split css missing ${name}: ${hits} < ${min} hits for ${JSON.stringify(needle)}`,
    );
    report.checks.push(`files-split-css-${name}(hits=${hits})`);
  }

  report.status = "PASSED";
} finally {
  try {
    await cleanupSessions(probeWorkspaceId);
    await runtimeFence();
  } catch (error) {
    report.checks.push(`cleanup: FAILED (${error.message})`);
    report.status = "FAILED";
  }
  if (browser) await browser.close().catch(() => {});
  await stopOwned(desktop, "desktop");
  await stopOwned(daemon, "daemon");
  console.log(JSON.stringify(report, null, 1));
  if (report.status !== "PASSED") process.exitCode = 1;
}
