import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";
import {
  mentuBridgeSchemas,
  mentuResultSchemas,
  type MentuRuntimeResult,
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
    message: "Invalid Work Graph request.",
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
        message: "The Work Graph response does not match its contract.",
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
      if (!isTrustedRenderer(window, event)) return { ...invalid };
      return dispatchMentuRequest(method, input);
    });
  }
  ipcMain.handle("drogon:mentuInstall", async (event) => {
    const window = getWindow();
    if (!isTrustedRenderer(window, event)) return { ...invalid };
    return installOfficialMentuRuntime();
  });
}

function isTrustedRenderer(
  window: BrowserWindow | null,
  event: Electron.IpcMainInvokeEvent,
): boolean {
  return Boolean(
    window &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame,
  );
}

// Must match `crates/drogon-core/src/mentu/runtime.rs` and
// `scripts/mentu-runtime-provision.mjs`.
export const MENTU_RUNTIME_LOCK_REVISION =
  "c82ccfa0ebbe77d62193e068821ba6e74f87a8d3";
export const MENTU_RUNTIME_LOCK_SHA256 =
  "f00528a940185e9433ad65b02e7de251d7d3d856c9d24d38f8b1474a1ca8bc5d";
export const MENTU_RUNTIME_RELEASE_URL =
  "https://github.com/mentu-ai/mentu-recipes/releases/download/v0.5.0/mentu-recipes-macos-arm64";
const MAX_MENTU_DOWNLOAD_BYTES = 64 * 1024 * 1024;

type MentuInstallDeps = {
  call?: NativeCall;
  fetchImpl?: typeof fetch;
  platform?: NodeJS.Platform;
  arch?: string;
  releaseUrl?: string;
  expectedSha256?: string;
};

function installError(
  code: string,
  message: string,
  retryable: boolean,
): Result<never> {
  return { ok: false, error: { code, message, retryable } };
}

function checkedRuntimeResult(value: unknown): Result<MentuRuntimeResult> {
  const parsed = mentuResultSchemas["mentu.runtime"].safeParse(value);
  if (!parsed.success)
    return installError(
      "internal_error",
      "The Mentu runtime response does not match its contract.",
      false,
    );
  return { ok: true, result: parsed.data };
}

/**
 * User-initiated installation of the pinned runtime. Drogon never downloads
 * Mentu during packaging or startup: this path runs only from the macOS
 * Settings action, verifies the release bytes, and lets the daemon perform
 * its own lock verification before activating them.
 */
export async function installOfficialMentuRuntime(
  deps: MentuInstallDeps = {},
): Promise<Result<MentuRuntimeResult>> {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  if (platform !== "darwin" || arch !== "arm64")
    return installError(
      "mentu_install_unsupported",
      "Mentu installation is available only on Apple silicon Macs.",
      false,
    );

  const call = deps.call ?? callNative;
  const current = await call("mentu.runtime", {});
  if (!current.ok) return current as Result<MentuRuntimeResult>;
  const checkedCurrent = checkedRuntimeResult(current.result);
  if (!checkedCurrent.ok) return checkedCurrent;
  if (
    checkedCurrent.result.runtime.expectedRevision !==
      MENTU_RUNTIME_LOCK_REVISION ||
    checkedCurrent.result.runtime.expectedSha256 !== MENTU_RUNTIME_LOCK_SHA256
  )
    return installError(
      "mentu_runtime_lock_mismatch",
      "The running Drogon service expects a different Mentu runtime. Restart Drogon and try again.",
      false,
    );
  if (
    checkedCurrent.result.runtime.available &&
    checkedCurrent.result.runtime.lockMatches
  )
    return checkedCurrent;

  const temporary = await mkdtemp(path.join(tmpdir(), "drogon-mentu-install-"));
  try {
    const response = await (deps.fetchImpl ?? fetch)(
      deps.releaseUrl ?? MENTU_RUNTIME_RELEASE_URL,
      { signal: AbortSignal.timeout(120_000) },
    );
    if (!response.ok)
      return installError(
        "mentu_download_failed",
        `Mentu download failed (${response.status}).`,
        true,
      );
    const declaredSize = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredSize) &&
      declaredSize > MAX_MENTU_DOWNLOAD_BYTES
    )
      return installError(
        "mentu_download_invalid",
        "The Mentu download exceeded the allowed size.",
        false,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_MENTU_DOWNLOAD_BYTES)
      return installError(
        "mentu_download_invalid",
        "The Mentu download exceeded the allowed size.",
        false,
      );
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    const expectedSha256 = deps.expectedSha256 ?? MENTU_RUNTIME_LOCK_SHA256;
    if (actualSha256 !== expectedSha256)
      return installError(
        "mentu_download_invalid",
        "The Mentu download did not match Drogon's approved runtime.",
        false,
      );

    const sourcePath = path.join(temporary, "mentu-recipes");
    await writeFile(sourcePath, bytes, { mode: 0o755 });
    const installed = await call("mentu.runtime_install", { sourcePath });
    if (!installed.ok) return installed as Result<MentuRuntimeResult>;
    const checkedInstall = mentuResultSchemas[
      "mentu.runtime_install"
    ].safeParse(installed.result);
    if (!checkedInstall.success)
      return installError(
        "internal_error",
        "The Mentu installation response does not match its contract.",
        false,
      );
    return { ok: true, result: { runtime: checkedInstall.data.runtime } };
  } catch (error) {
    return installError(
      "mentu_download_failed",
      error instanceof Error ? error.message : "Mentu download failed.",
      true,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
