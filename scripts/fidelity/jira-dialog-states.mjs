// R17-C fidelity driver: renders the ported Jira create dialog and issue
// workspace in a bare vite dev server (the oracle page under the feature
// dir — R17-B's Tasks chrome has not landed, so these cannot mount into
// the app yet) and captures CDP-backed screenshots per state and theme.
//
// Usage: node scripts/fidelity/jira-dialog-states.mjs [--out <dir>]
//
// Captures, at 1280x800 plus a 390x844 pass over the create dialog:
//   create-empty.{light,dark}.png       dialog freshly opened
//   create-filled.{light,dark}.png      title/body/custom field prefilled
//   detail.{light,dark}.png             issue workspace (sheet) open
// Exits nonzero when a capture fails.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(
  path.join(root, "apps/desktop/package.json"),
);
const { createServer } = require("vite");
const tailwindcss = require("@tailwindcss/vite").default;
const rendererRoot = path.join(root, "apps/desktop/src/renderer");
const oracleDir = path.join(
  rendererRoot,
  "src/features/tasks/jira/__oracle__",
);
const outIndex = process.argv.indexOf("--out");
const outDir = outIndex !== -1
  ? path.resolve(process.argv[outIndex + 1])
  : path.join(root, ".preflight/fidelity/jira-dialogs");
await mkdir(outDir, { recursive: true });

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
const captures = [];
try {
  const states = [
    { name: "create-empty", query: "state=create" },
    { name: "create-filled", query: "state=create&filled=1" },
    { name: "detail", query: "state=detail" },
  ];
  for (const state of states) {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      });
      await page.goto(`http://127.0.0.1:${port}/src/features/tasks/jira/__oracle__/index.html?${state.query}&theme=${theme}`);
      // The dialog/sheet must be mounted and open before the shot.
      await page.waitForSelector('[data-oracle-ready="true"]', { timeout: 15_000 });
      await page.waitForSelector('[role="dialog"]', { timeout: 15_000 });
      await page.waitForTimeout(400);
      const file = path.join(outDir, `${state.name}.${theme}.png`);
      await page.screenshot({ path: file, fullPage: false });
      captures.push(file);
      await page.close();
    }
  }
  // Narrow viewport pass over the create dialog (mobile sheet sanity).
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    await page.goto(`http://127.0.0.1:${port}/src/features/tasks/jira/__oracle__/index.html?state=create&theme=${theme}`);
    await page.waitForSelector('[role="dialog"]', { timeout: 15_000 });
    await page.waitForTimeout(400);
    const file = path.join(outDir, `create-empty.narrow.${theme}.png`);
    await page.screenshot({ path: file, fullPage: false });
    captures.push(file);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}

assert.equal(captures.length, 8, "expected 8 captures");
console.log(`captured ${captures.length} states -> ${outDir}`);
for (const file of captures) console.log(`  ${path.relative(root, file)}`);
