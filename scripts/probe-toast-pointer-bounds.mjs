// Toast-layer pointer-bounds probe (regression for the packaged acceptance
// failure where a Sonner toast intercepted the Bots form's "Create Bot"
// click). Renders the oracle page under
// apps/desktop/src/renderer/src/components/ui/__oracle__ over a bare vite dev
// server — the REAL Toaster, the REAL BotCreationForm and the REAL main.css —
// and answers the conditions with real hit-testing (no jsdom, no force-clicks,
// no programmatic dismissal to paper over the overlap).
//
// Usage: node scripts/probe-toast-pointer-bounds.mjs [--out <dir>] [--json]
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(path.join(root, "apps/desktop/package.json"));
const { createServer } = require("vite");
const tailwindcss = require("@tailwindcss/vite").default;
const rendererRoot = path.join(root, "apps/desktop/src/renderer");
const outIndex = process.argv.indexOf("--out");
const outDir = outIndex !== -1
  ? path.resolve(process.argv[outIndex + 1])
  : path.join(root, ".preflight/toast-pointer-bounds");
await mkdir(outDir, { recursive: true });

const results = [];
const failures = [];
const diagnostics = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const overlaps = (a, b) =>
  a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * A plain Playwright click on the Create Bot submit. A blocked click is
 * reported (with the element that swallowed it) instead of aborting the run,
 * so the probe lists every broken contract in one pass.
 */
async function clickSubmit(page) {
  try {
    await page.click("button[type='submit']");
    return null;
  } catch (error) {
    const lines = String(error.message).split("\n");
    const intercepted = lines.find((line) => line.includes("intercepts pointer events"));
    return intercepted?.trim() ?? error.message.split("\n")[0];
  }
}

const server = await createServer({
  root: rendererRoot,
  configFile: false,
  plugins: [tailwindcss()],
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  resolve: {
    dedupe: ["react", "react-dom", "sonner", "lucide-react", "radix-ui", "clsx", "tailwind-merge"],
  },
  esbuild: { jsx: "automatic" },
});
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch();
try {
  // 1400x920 is Drogon's default window size; the packaged acceptance runs at
  // the app's own bounds, where the Bots form column and the bottom-right
  // toast column overlap.
  const page = await browser.newPage({
    viewport: { width: 1400, height: 920 },
  });
  page.setDefaultTimeout(15000);
  await page.goto(`http://127.0.0.1:${port}/src/components/ui/__oracle__/index.html`);
  await page.waitForSelector('[data-oracle-ready="true"]', {
    state: "attached",
  });
  // The journey reaches the failing click with the Advanced disclosure open
  // (Agent + Model + Handle + Title + Memories) and the submit scrolled to the
  // bottom of the panel, which is what plants it inside the toast column.
  await page.getByText(/^Advanced · /).click();
  await page.getByLabel("Model", { exact: true }).waitFor();
  // The form footer starts below the fold; plant it exactly where the
  // acceptance's real click on the covered control ends up.
  await page.evaluate(() => {
    document
      .querySelector("button[type='submit']")
      ?.scrollIntoView({ block: "end" });
  });
  await delay(300);

  const submitBox = await page.evaluate(() => window.__toastOracle.submitRect());
  assert.ok(submitBox, "the oracle must render the Create Bot submit");
  const submitCenter = {
    x: submitBox.left + submitBox.width / 2,
    y: submitBox.top + submitBox.height / 2,
  };
  check(
    "the oracle reproduces the journey's enabled Create Bot submit",
    (await page.evaluate(() => window.__toastOracle.submitDisabled())) === false,
    `rect=${JSON.stringify(submitBox)}`,
  );
  const baseline = await page.evaluate(
    (point) => window.__toastOracle.hitTest(point.x, point.y),
    submitCenter,
  );
  check(
    "baseline: the Create Bot submit receives its own clicks with no toast raised",
    baseline?.isSubmit === true,
    JSON.stringify(baseline),
  );

  // The packaged acceptance raises notifications earlier in the run, so a
  // live stack can still be over the Bots submit when the journey clicks it.
  // Three toasts is Sonner's visible-toast count.
  await page.evaluate(() => window.__toastOracle.raiseHeld(3));
  await page.waitForSelector("[data-sonner-toast][data-mounted='true']");
  await delay(800);
  const stacked = await page.evaluate(() => window.__toastOracle.state());
  diagnostics.push({ step: "three held toasts", stacked });
  const frontToast = stacked.toasts.find((toast) => toast.dataFront === "true");
  assert.ok(frontToast, `a front toast must exist: ${JSON.stringify(stacked.toasts)}`);
  const stackOverlapsSubmit = stacked.toasts.some((toast) =>
    overlaps(toast.rect, submitBox),
  );
  check(
    "the acceptance condition is reproduced: the toast stack covers the Create Bot submit",
    stackOverlapsSubmit,
    `submit=${JSON.stringify(submitBox)} toasts=${JSON.stringify(stacked.toasts.map((t) => t.rect))}`,
  );
  await page.screenshot({ path: path.join(outDir, "toast-stack-over-submit.png") });

  // (1) The toast layer must not claim pointer events over content it does
  // not paint. The layer is a 26rem-wide fixed box; probe its own box corners,
  // which no toast covers.
  const columnPoints = stacked.toaster
    ? [
        { x: stacked.toaster.left + 4, y: stacked.toaster.top + 2, where: "layer top-left" },
        { x: stacked.toaster.right - 4, y: stacked.toaster.top + 2, where: "layer top-right" },
      ]
    : [];
  for (const point of columnPoints) {
    const hit = await page.evaluate(
      (p) => window.__toastOracle.hitTest(p.x, p.y),
      point,
    );
    check(
      `the toast layer claims no pointer events at the ${point.where}`,
      hit?.inToaster !== true,
      JSON.stringify(hit),
    );
  }

  // A point above the topmost painted toast must reach page content. Probed
  // with the stack collapsed: Sonner's own 15px expanded-hover gap belongs to
  // the stack while the pointer is inside it (it is what keeps the expanded
  // stack from flickering between toasts), so the honest contract to pin is
  // the collapsed one.
  await page.mouse.move(300, 300);
  await delay(700);
  const collapsed = await page.evaluate(() => window.__toastOracle.state());
  const topMost = Math.min(...collapsed.toasts.map((toast) => toast.rect.top));
  const outsidePoints = [
    { x: submitCenter.x, y: Math.max(1, topMost - 4), where: "above the whole stack" },
    { x: Math.max(1, Math.min(...collapsed.toasts.map((t) => t.rect.left)) - 8), y: submitCenter.y, where: "left of the stack" },
  ];
  check(
    "the stack really is collapsed for the outside-bounds probes",
    collapsed.toasts.every((toast) => toast.dataExpanded === "false"),
    JSON.stringify(collapsed.toasts.map((toast) => toast.dataExpanded)),
  );
  for (const point of outsidePoints) {
    const hit = await page.evaluate(
      (p) => window.__toastOracle.hitTest(p.x, p.y),
      point,
    );
    check(
      `a visible toast claims no pointer events ${point.where}`,
      hit?.inToaster !== true,
      JSON.stringify(hit),
    );
  }

  // (2) The acceptance condition itself, with the stack LIVE (exactly what
  // the packaged journey hits: an "Automation run queued." notification raised
  // by the Automations journey is still on screen when the Bots journey
  // clicks Create Bot). The click is a plain Playwright click — no force, no
  // prior dismissal, no wait — and the proof is the page's own submit counter.
  const liveClickError = await clickSubmit(page);
  const submitWithLiveStack = await page.evaluate(() =>
    window.__toastOracle.submitCount(),
  );
  check(
    "a live toast over the Create Bot submit does not block the click",
    submitWithLiveStack === 1 && liveClickError === null,
    liveClickError ?? `submitCount=${submitWithLiveStack}`,
  );

  // (3) The toast's own affordances stay real: a plain (non-forced) click on
  // the front toast's close button dismisses it.
  const closeButton = page
    .locator("[data-sonner-toast][data-front='true'] [data-close-button]")
    .first();
  await closeButton.click();
  const immediate = await page.evaluate(
    (point) => ({
      hit: window.__toastOracle.hitTest(point.x, point.y),
      state: window.__toastOracle.state(),
    }),
    submitCenter,
  );
  diagnostics.push({ step: "immediately after dismissing the front toast", immediate });
  const removedNodes = immediate.state.toasts.filter(
    (toast) => toast.dataRemoved === "true",
  );
  check(
    "a dismissed toast leaves an exit node that is still measured",
    removedNodes.length > 0,
    `removed=${removedNodes.length} of ${immediate.state.toasts.length}`,
  );
  check(
    "a dismissed toast stops claiming pointer events, not just its opacity",
    removedNodes.every((toast) => toast.pointerEvents === "none"),
    JSON.stringify(removedNodes.map((toast) => toast.pointerEvents)),
  );

  // The reported defect, measured at the pixels: a click anywhere inside a
  // dismissed toast's own (invisible) box must not land on that node for the
  // whole exit animation. (Another toast may legitimately have moved into the
  // same band, so the check is that the dismissed node itself is not the
  // target — not that the band is empty.)
  for (const [index, toast] of removedNodes.entries()) {
    const point = {
      x: toast.rect.left + toast.rect.width / 2,
      y: toast.rect.top + toast.rect.height / 2,
    };
    const hit = await page.evaluate(
      (p) => window.__toastOracle.hitTest(p.x, p.y),
      point,
    );
    check(
      `dismissed toast ${index} blocks nothing at its own center`,
      hit?.toastId !== toast.id,
      JSON.stringify({ hit, dismissed: toast.id }),
    );
  }

  // The click must really land: Playwright retries intercepted clicks, so the
  // proof is the page's own submit counter.
  const beforeSubmitClick = await page.evaluate(
    (point) => ({
      hit: window.__toastOracle.hitTest(point.x, point.y),
      state: window.__toastOracle.state(),
    }),
    submitCenter,
  );
  diagnostics.push({ step: "before the post-dismiss submit click", beforeSubmitClick });
  const dismissedClickError = await clickSubmit(page);
  const submitAfter = await page.evaluate(() => window.__toastOracle.submitCount());
  check(
    "the Create Bot submit really runs after a toast is dismissed over it",
    submitAfter === 2 && dismissedClickError === null,
    dismissedClickError ?? `submitCount=${submitAfter}`,
  );

  // Nothing in the toast layer may stay hit-testable once every toast is gone.
  await page.evaluate(() => {
    for (const toast of document.querySelectorAll("[data-sonner-toast]")) {
      const close = toast.querySelector("[data-close-button]");
      if (close instanceof HTMLElement) close.click();
    }
  });
  await page.waitForFunction(
    () => document.querySelectorAll("[data-sonner-toast]").length === 0,
    null,
    { timeout: 5000 },
  );
  const emptied = await page.evaluate(() => {
    const center = window.__toastOracle.elementCenter("button[type='submit']");
    return {
      hit: center
        ? window.__toastOracle.hitTest(center.x, center.y)
        : null,
      state: window.__toastOracle.state(),
    };
  });
  diagnostics.push({ step: "after every toast left the layer", emptied });
  check(
    "an emptied toast layer leaves no hit area over the form",
    emptied.hit?.isSubmit === true,
    JSON.stringify(emptied.hit),
  );

  await page.evaluate(() => window.__toastOracle.raise("stale"));
  await delay(400);
  await page.evaluate(() => window.__toastOracle.dismiss("stale"));
  await delay(500);
  const dismissed = await page.evaluate(() => {
    const center = window.__toastOracle.elementCenter("button[type='submit']");
    return {
      hit: center
        ? window.__toastOracle.hitTest(center.x, center.y)
        : null,
      state: window.__toastOracle.state(),
    };
  });
  check(
    "a programmatically dismissed toast leaves no node and no hit area",
    dismissed.state.toasts.length === 0 && dismissed.hit?.isSubmit === true,
    JSON.stringify({ hit: dismissed.hit, toasts: dismissed.state.toasts.length }),
  );

  // Toast actions must keep working: a toast that offers an action runs it.
  // Both the native action slot and a custom React body's own controls are
  // pinned, because the card around them is now transparent to the pointer.
  await page.evaluate(() => window.__toastOracle.raiseWithAction("actionable"));
  const actionButton = page.locator("[data-sonner-toast] [data-button]").first();
  await actionButton.waitFor();
  await actionButton.click();
  const actionCount = await page.evaluate(() => window.__toastOracle.actionCount());
  check(
    "a toast's own action button still runs its handler",
    actionCount === 1,
    `actionCount=${actionCount}`,
  );

  await page.evaluate(() => window.__toastOracle.dismiss("actionable"));
  await page.evaluate(() =>
    window.__toastOracle.raiseWithBodyButton("body-button"),
  );
  const bodyButton = page.getByRole("button", { name: "Force Delete" });
  await bodyButton.waitFor();
  await bodyButton.click();
  const bodyActionCount = await page.evaluate(() =>
    window.__toastOracle.actionCount(),
  );
  check(
    "a control rendered inside a custom toast body still runs its handler",
    bodyActionCount === 2,
    `actionCount=${bodyActionCount}`,
  );
  await page.evaluate(() => window.__toastOracle.dismiss("body-button"));

  // The close button is the affordance this app turns on for every toast, so
  // it has to stay a real click target while the stack is live.
  await page.waitForFunction(
    () => document.querySelectorAll("[data-sonner-toast]").length === 0,
    null,
    { timeout: 5000 },
  );
  await page.evaluate(() => window.__toastOracle.raiseHeld(1));
  await page.waitForSelector("[data-sonner-toast][data-front='true']");
  const beforeReachable = await page.evaluate(
    () => document.querySelectorAll("[data-sonner-toast]").length,
  );
  await page
    .locator("[data-sonner-toast][data-front='true'] [data-close-button]")
    .first()
    .click();
  await delay(600);
  const afterReachable = await page.evaluate(
    () => document.querySelectorAll("[data-sonner-toast]").length,
  );
  check(
    "a live toast's close button is still a real click target",
    afterReachable === beforeReachable - 1,
    `before=${beforeReachable} after=${afterReachable}`,
  );

  await page.close();
} finally {
  await browser.close();
  await server.close();
}

if (process.argv.includes("--json")) {
  await writeFile(
    path.join(outDir, "toast-pointer-bounds.json"),
    `${JSON.stringify({ results, diagnostics }, null, 2)}\n`,
  );
}
if (failures.length > 0) {
  console.error(`\n${failures.length} of ${results.length} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`\n${results.length} checks passed`);
}
