import { app, ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  mentuBridgeSchemas,
  mentuResultSchemas,
} from "../shared/mentu-contract";
import { resultSchemas } from "../shared/result-validation";
import type { Result } from "../shared/session-contract";
import { callNative } from "./native-client";
import { registerMentuOpenTabResult } from "./mentu-open-relay";

// Registered here rather than editing shared/result-validation.ts directly:
// identical precedent to main/tasks-bridge.ts's registration of
// `tasksResultSchemas`.
for (const [method, schema] of Object.entries(mentuResultSchemas)) {
  resultSchemas[method] = schema;
}

export type MentuMethod = keyof typeof mentuBridgeSchemas;
type NativeCall = (
  method: string,
  params: object,
  requestId?: string,
) => Promise<Result<unknown>>;

const nativeMethodFor: Record<MentuMethod, string> = {
  mentuRecipes: "mentu.recipes",
  mentuRecipe: "mentu.recipe",
  mentuRecipeSave: "mentu.recipe_save",
  mentuRuntime: "mentu.runtime",
  mentuApprove: "mentu.approve",
  mentuRun: "mentu.run",
  mentuRuns: "mentu.runs",
  mentuRunStatus: "mentu.run_status",
  mentuRunEvidence: "mentu.run_evidence",
  mentuRetry: "mentu.retry",
  mentuCancel: "mentu.cancel",
};

const invalid = {
  ok: false,
  error: {
    code: "invalid_argument",
    message: "Invalid Mentu request.",
    retryable: false,
  },
} as const;

export async function dispatchMentuRequest(
  method: MentuMethod,
  input: unknown,
  call: NativeCall = callNative,
): Promise<Result<unknown>> {
  const parsed = mentuBridgeSchemas[method].safeParse(input);
  if (!parsed.success) return { ...invalid };
  const nativeMethod = nativeMethodFor[method];
  const result = await call(nativeMethod, parsed.data);
  if (!result.ok) return result;
  const checked =
    mentuResultSchemas[
      nativeMethod as keyof typeof mentuResultSchemas
    ].safeParse(result.result);
  if (!checked.success)
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: "The Mentu response does not match its contract.",
        retryable: false,
      },
    };
  return { ok: true, result: checked.data };
}

const channelFor: Record<MentuMethod, string> = {
  mentuRecipes: "drogon:mentuRecipes",
  mentuRecipe: "drogon:mentuRecipe",
  mentuRecipeSave: "drogon:mentuRecipeSave",
  mentuRuntime: "drogon:mentuRuntime",
  mentuApprove: "drogon:mentuApprove",
  mentuRun: "drogon:mentuRun",
  mentuRuns: "drogon:mentuRuns",
  mentuRunStatus: "drogon:mentuRunStatus",
  mentuRunEvidence: "drogon:mentuRunEvidence",
  mentuRetry: "drogon:mentuRetry",
  mentuCancel: "drogon:mentuCancel",
};

/**
 * Registers one `ipcMain.handle` per Mentu channel with the same
 * sender/frame gate main/index.ts applies to its own bridge. Own
 * registration (rather than `bridgeSchemas` entries) because that map is
 * coordinator-owned; see `main/tasks-bridge.ts` for the identical
 * precedent.
 */
export function registerMentuBridge(
  getWindow: () => BrowserWindow | null,
): void {
  // Additive (Mentu-as-tab): the renderer's own verdict for a `mentu.open`
  // relay command arrives on this channel, and the same window getter is
  // what the relay poller delivers requests to.
  registerMentuOpenTabResult(getWindow);
  for (const method of Object.keys(mentuBridgeSchemas) as MentuMethod[]) {
    ipcMain.handle(channelFor[method], async (event, input: unknown) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { ...invalid };
      return dispatchMentuRequest(method, input);
    });
  }
}

// Must match `MENTU_LOCK_REVISION` in `crates/drogon-core/src/mentu/runtime.rs`
// and `scripts/mentu-runtime-provision.mjs`.
const MENTU_RUNTIME_LOCK_REVISION = "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3";

/**
 * Where `scripts/mentu-runtime-provision.mjs` staged a runtime for this
 * build: `process.resourcesPath` once packaged (populated by
 * `scripts/package-desktop.mjs`), or the repo's own resources in dev.
 * Apple Silicon packages include the verified official release by default.
 */
function bundledMentuRuntimeSourcePath(): string {
  const resourcesRoot = app.isPackaged
    ? process.resourcesPath
    : path.join(app.getAppPath(), "resources");
  const executable = process.platform === "win32" ? "mentu-recipes.exe" : "mentu-recipes";
  return path.join(
    resourcesRoot,
    "mentu-runtime",
    MENTU_RUNTIME_LOCK_REVISION,
    "bin",
    executable,
  );
}

/**
 * One-time, local-only provisioning of the pinned Mentu runtime (journey J9
 * fresh-install usability) from this build's bundled copy, when one exists.
 * No-ops when absent in an unprovisioned dev checkout. Never touches the
 * network, `PATH` or Homebrew: `mentu.runtime_install` only copies local
 * bytes that already match the lock's sha256. There is no renderer-facing
 * install affordance to wire this through: the read-only reference's own
 * `MentuRuntimeMessage`/`recipe-pane-controller.ts` have no install button
 * either, since the fork instead bakes its runtime into the app bundle at
 * build time (see the PR for the full comparison).
 *
 * `sourcePath`/`call`/`retryDelayMs`/`attempts` are overridable for tests,
 * so they never touch the real `electron` app, a real daemon connection, or
 * a real clock delay.
 */
export async function autoInstallBundledMentuRuntime(
  call: NativeCall = callNative,
  sourcePath: string = bundledMentuRuntimeSourcePath(),
  retryDelayMs = 500,
  // `bootstrapDaemon()` already waited for the daemon to answer once before
  // this runs, but a cold first-run daemon (fresh SQLite schema, a loaded
  // dev machine) can still take a beat past that to accept a second
  // connection; retry generously rather than silently skipping install.
  attempts = 10,
): Promise<void> {
  if (!existsSync(sourcePath)) return;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await call("mentu.runtime_install", { sourcePath });
    if (result.ok) {
      console.log(`[drogon] mentu runtime auto-install: ${JSON.stringify(result.result)}`);
      return;
    }
    if (!result.error.retryable || attempt === attempts) {
      console.error(`[drogon] mentu runtime auto-install failed: ${result.error.message}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
