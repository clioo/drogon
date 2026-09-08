import { z } from "zod";
import type { Result } from "./session-contract";

// J10 settings contract: validation for the additive SettingsStore keys and
// for the read-only git/GitHub probes. Limits mirror the harness bridge
// (shared/bridge-validation.ts): free text, never NUL/control characters.

const noControlChars = /^[^\x00-\x1f\x7f]*$/;

export const terminalFontSizeSchema = z.number().int().min(9).max(32);

export const defaultHarnessIdSchema = z
  .string()
  .max(128)
  .regex(noControlChars);

const freeText = (max: number) =>
  z.string().max(max).regex(noControlChars);

export const harnessAgentDefaultSchema = z.object({
  model: freeText(4096),
  effort: freeText(256),
  permissionMode: z.enum(["inherit", "unattended"]),
});
export type HarnessAgentDefaultSettings = z.infer<
  typeof harnessAgentDefaultSchema
>;

export const harnessDefaultsSchema = z
  .record(
    z.string().min(1).max(128).regex(noControlChars),
    harnessAgentDefaultSchema,
  )
  .refine((value) => Object.keys(value).length <= 16);

export const notifyOnAgentNeedsInputSchema = z.boolean();

/** Source vocabulary: terminal renderer policy (global-settings-types.ts). */
export const terminalGpuAccelerationSchema = z.enum(["auto", "on", "off"]);

export const settingsSubsetAdditionSchema = z.object({
  terminalFontSize: terminalFontSizeSchema,
  defaultHarnessId: defaultHarnessIdSchema,
  harnessDefaults: harnessDefaultsSchema,
  notifyOnAgentNeedsInput: notifyOnAgentNeedsInputSchema,
  terminalGpuAcceleration: terminalGpuAccelerationSchema,
});

// Read-only probes: git identity of a workspace path, and `gh auth status`.
// Both are local observations, never credentials: the gh output is truncated
// and the bridge never returns tokens.

export const gitIdentityInputSchema = z.object({
  workspacePath: z
    .string()
    .min(1)
    .max(32768)
    .refine((value) => !value.includes("\0")),
});
export type GitIdentityInput = z.infer<typeof gitIdentityInputSchema>;

export const gitIdentityResultSchema = z.object({
  workspacePath: z.string(),
  available: z.boolean(),
  name: z.string().max(1024).nullish(),
  email: z.string().max(1024).nullish(),
  reason: z.string().max(512).nullish(),
});
export type GitIdentityResult = z.infer<typeof gitIdentityResultSchema>;

export const ghAuthStatusResultSchema = z.object({
  available: z.boolean(),
  loggedIn: z.boolean(),
  /** Truncated human-readable `gh auth status` output (or the reason it is unavailable). */
  output: z.string().max(4096),
});
export type GhAuthStatusResult = z.infer<typeof ghAuthStatusResultSchema>;

export const cliStatusResultSchema = z.object({
  available: z.boolean(),
  /** Command name that resolved (`drogon-cli` or the `drogon` alias). */
  commandName: z.string().min(1).max(128),
  /** Resolved executable path, or null when no candidate exists. */
  commandPath: z.string().max(4096).nullable(),
  /** First line of `<command> --version`, or null when it never ran. */
  version: z.string().max(256).nullable(),
  /** Human-readable detail (or the reason it is unavailable). */
  detail: z.string().max(1024),
});
export type CliStatusResult = z.infer<typeof cliStatusResultSchema>;

export interface SettingsProbeBridge {
  gitIdentity(input: GitIdentityInput): Promise<Result<GitIdentityResult>>;
  ghAuthStatus(): Promise<Result<GhAuthStatusResult>>;
  cliStatus(): Promise<Result<CliStatusResult>>;
}

declare module "./session-contract" {
  interface DesktopBridge {
    settings: SettingsProbeBridge;
  }
}
