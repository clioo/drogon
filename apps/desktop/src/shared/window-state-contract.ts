// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
//   src/main/window/main-window-state-lifecycle.ts (debounced persist,
//   near-minimum guard, atomic bounds+maximized pair, close/before-quit
//   freeze)
//   src/main/window/main-window-visual-lifecycle.ts (MIN_WIDTH/MIN_HEIGHT),
//   src/main/persistence (saved windowMaximized/windowBounds defaults).
// Adapted: Drogon has no Store class, so the pair persists to one JSON file
// under app.getPath("userData"); the source's getUI()-side defaults
// (1400×920, not maximized) become the first-launch constants.
import { z } from "zod";

export const WINDOW_STATE_FILE_NAME = "window-state.json";

/** First-launch window size (source Store default). */
export const DEFAULT_WINDOW_WIDTH = 1400;
export const DEFAULT_WINDOW_HEIGHT = 920;

/** BrowserWindow minWidth/minHeight (main/index.ts createWindow). */
export const MIN_WINDOW_WIDTH = 720;
export const MIN_WINDOW_HEIGHT = 480;

export const windowBoundsSchema = z.object({
  x: z.number().int().min(-100000).max(100000),
  y: z.number().int().min(-100000).max(100000),
  width: z.number().int().min(MIN_WINDOW_WIDTH).max(100000),
  height: z.number().int().min(MIN_WINDOW_HEIGHT).max(100000),
});
export type WindowBounds = z.infer<typeof windowBoundsSchema>;

export const windowStateFileSchema = z.object({
  version: z.literal(1),
  bounds: windowBoundsSchema.nullable(),
  maximized: z.boolean(),
});
export type WindowStateFile = z.infer<typeof windowStateFileSchema>;

/** What createWindow needs before touching the screen. */
export type RestoredWindowState = {
  bounds: WindowBounds | null;
  maximized: boolean;
};

export const DEFAULT_RESTORED_WINDOW_STATE: RestoredWindowState = {
  bounds: null,
  maximized: false,
};

/**
 * Near-minimum guard (source saveBounds/unmaximize): teardown races can land
 * at min size; persisting that would shrink every future launch. Mirrors the
 * source's `<=` comparison so exactly-min bounds are skipped too.
 */
export function isNearMinimumBounds(bounds: {
  width: number;
  height: number;
}): boolean {
  return (
    bounds.width <= MIN_WINDOW_WIDTH || bounds.height <= MIN_WINDOW_HEIGHT
  );
}

/**
 * Parses the raw file contents. Anything malformed or foreign yields the
 * first-launch default instead of throwing, so a corrupt file can never
 * wedge startup.
 */
export function parseWindowStateFile(raw: string | null | undefined): RestoredWindowState {
  if (!raw) return DEFAULT_RESTORED_WINDOW_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    const validated = windowStateFileSchema.safeParse(parsed);
    if (!validated.success) return DEFAULT_RESTORED_WINDOW_STATE;
    return {
      bounds: validated.data.bounds,
      maximized: validated.data.maximized,
    };
  } catch {
    return DEFAULT_RESTORED_WINDOW_STATE;
  }
}
