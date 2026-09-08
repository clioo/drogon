// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from the Orca reference (read-only):
//   src/main/system-fonts.ts
//     (listSystemFontFamilies with per-platform enumeration: system_profiler
//      on macOS, InstalledFontCollection on Windows, fc-list on Linux;
//      cached, timed out, curated fallback per platform)
// Adapted: child processes run through this repo's injectable execFile
// runner (same shape as main/settings-probes.ts) instead of
// shared/child-process/run-process, so tests never spawn OS font tools.

import { execFile } from "node:child_process";
import { ipcMain } from "electron";
import type { BrowserWindow } from "electron";

const SYSTEM_FONT_LIST_TIMEOUT_MS = 15_000;
// Why: large macOS font catalogs can make system_profiler exceed 15s even
// when it is healthy; keep the longer wait scoped to that slow command.
const MAC_SYSTEM_FONT_LIST_TIMEOUT_MS = 45_000;

export type FontListRunOk = {
  ok: true;
  stdout: string;
};
export type FontListRunFail = { ok: false; reason: string };
export type FontListRunResult = FontListRunOk | FontListRunFail;
export type FontListRunner = (
  file: string,
  args: string[],
  options: { timeoutMs: number; maxBuffer: number },
) => Promise<FontListRunResult>;

function defaultRunner(
  file: string,
  args: string[],
  options: { timeoutMs: number; maxBuffer: number },
): Promise<FontListRunResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) return resolve({ ok: false, reason: "font-tool-failed" });
        resolve({ ok: true, stdout: String(stdout ?? "") });
      },
    );
  });
}

let cachedFonts: string[] | null = null;
let fontsPromise: Promise<string[]> | null = null;

/** Test seam: drops the memoized enumeration so each test re-runs the runner. */
export function resetCachedSystemFonts(): void {
  cachedFonts = null;
  fontsPromise = null;
}

export async function listSystemFontFamilies(
  runner: FontListRunner = defaultRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<string[]> {
  if (cachedFonts) return cachedFonts;
  if (fontsPromise) return fontsPromise;
  fontsPromise = loadSystemFontFamilies(runner, platform)
    .then((fonts) => {
      cachedFonts = fonts.length > 0 ? fonts : fallbackFonts(platform);
      return cachedFonts;
    })
    .catch(() => {
      cachedFonts = fallbackFonts(platform);
      return cachedFonts;
    })
    .finally(() => {
      fontsPromise = null;
    });
  return fontsPromise;
}

function loadSystemFontFamilies(
  runner: FontListRunner,
  platform: NodeJS.Platform,
): Promise<string[]> {
  if (platform === "darwin") return listMacFonts(runner);
  if (platform === "win32") return listWindowsFonts(runner);
  return listLinuxFonts(runner);
}

async function listMacFonts(runner: FontListRunner): Promise<string[]> {
  const result = await runner(
    "system_profiler",
    ["SPFontsDataType", "-json"],
    { timeoutMs: MAC_SYSTEM_FONT_LIST_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error("system_profiler failed");
  const parsed = JSON.parse(result.stdout) as {
    SPFontsDataType?: { typefaces?: { family?: string }[] }[];
  };
  return uniqueSorted(
    (parsed.SPFontsDataType ?? []).flatMap((font) =>
      (font.typefaces ?? []).map((typeface) => typeface.family),
    ),
  );
}

async function listLinuxFonts(runner: FontListRunner): Promise<string[]> {
  const result = await runner("fc-list", [":", "family"], {
    timeoutMs: SYSTEM_FONT_LIST_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!result.ok) throw new Error("fc-list failed");
  return uniqueSorted(
    result.stdout
      .split("\n")
      .flatMap((line) => line.split(","))
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

async function listWindowsFonts(runner: FontListRunner): Promise<string[]> {
  // Why: PowerShell 5.1 emits redirected stdout in the OEM code page; pin UTF-8
  // before the first name is written or localized families arrive as mojibake.
  const script = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
$fonts = New-Object System.Drawing.Text.InstalledFontCollection
$fonts.Families | ForEach-Object { $_.Name }
`;
  const result = await runner(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeoutMs: SYSTEM_FONT_LIST_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error("font enumeration failed");
  return uniqueSorted(
    result.stdout
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

function uniqueSorted(values: (string | undefined)[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim() ?? "")
        .filter((value) => value.length > 0 && !value.startsWith(".")),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

export function fallbackFonts(platform: NodeJS.Platform): string[] {
  if (platform === "darwin")
    return ["SF Mono", "Menlo", "Monaco", "JetBrains Mono", "Fira Code"];
  if (platform === "win32")
    return ["Cascadia Mono", "Consolas", "Lucida Console", "JetBrains Mono", "Fira Code"];
  return [
    "JetBrains Mono",
    "Fira Code",
    "DejaVu Sans Mono",
    "Liberation Mono",
    "Ubuntu Mono",
    "Noto Sans Mono",
  ];
}

/**
 * Registers `drogon:fontsList` with the same sender/frame gate
 * main/index.ts applies to its own bridge. Returns plain string arrays
 * (display names only, no file paths) so no host detail leaks shape.
 */
export function registerFontsBridge(
  getWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("drogon:fontsList", async (event) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      return [];
    try {
      return await listSystemFontFamilies();
    } catch {
      return fallbackFonts(process.platform);
    }
  });
}
