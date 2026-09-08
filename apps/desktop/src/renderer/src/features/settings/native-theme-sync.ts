// MIT Copyright (c) 2026 Lovecast Inc.
// Renderer half of the nativeTheme relay (#241). The "System" theme must
// resolve from main's nativeTheme.shouldUseDarkColors (QA r3 / live proof:
// the web contents' media query can disagree with main's native signal and
// never adapts), with live OS updates, applied to the document root — the
// shell, terminal panes and editor all key off that class through their own
// observers.
//
// Ported from the Orca reference (read-only):
//   src/main/startup/main-process-ready-runtime.ts:91 (themeSource mirrors
//     the stored theme) — mirrored here over the bridge at start,
//   src/main/ipc/settings.ts:188 (themeSource follows the choice) — the
//     Appearance section reports each change through reportThemeChoice,
//   src/renderer/src/lib/document-theme.ts resolveDocumentTheme (system
//     follows the OS; explicit choices win) — this repo's resolution lives
//     in renderer/src/theme.ts resolveEffectiveTheme.
// Because the web contents' media query itself can lie, this module also
// installs a matchMedia shim for the dark-scheme query: every consumer
// (App's theme effect, terminal panes) then reads the native signal through
// the standard API, and the live OS updates arrive as synthesized change
// events from the nativeTheme relay. The theme choice stays in the single
// settings store; explicit Dark/Light always win over the shim. Without the
// bridge (old preload, plain browser) everything here is a no-op.
import {
  parsePersistedSettings,
  settingsStorageKey,
  type Theme,
} from "../../settings-store";
import type {
  NativeThemeBridge,
  NativeThemeState,
} from "../../../../shared/settings-contract";
import {
  applyThemeToRoot,
  resolveEffectiveTheme,
  type ThemeRoot,
} from "../../theme";

/** Past the store's save debounce and its maximum pending delay. */
const PERSISTED_ADOPT_DELAYS_MS = [1_300, 5_300];

/**
 * After a themeSource write, shouldUseDarkColors may settle a tick (or
 * more) later — the invoke response can still carry the pre-settle value.
 * Re-pull until it converges; every pull carries the authoritative state.
 */
const SETTLE_PULL_DELAYS_MS = [0, 150, 600, 2_000, 5_000];

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

export type NativeThemeSyncDeps = {
  bridge: NativeThemeBridge;
  /** The single store's persisted envelope reader (injectable for tests). */
  readPersistedTheme(): Theme;
  root: ThemeRoot;
};

/** Reads the persisted theme straight from the envelope (App flushes ≤1s). */
export function persistedTheme(storage: {
  getItem(key: string): string | null;
}): Theme {
  try {
    return (
      parsePersistedSettings(storage.getItem(settingsStorageKey("ui")))
        .theme ?? "system"
    );
  } catch {
    return "system";
  }
}

// The section is the theme control surface: it reports each choice here so
// the sync's resolution never races the store's debounced flush.
let liveThemeReporter: ((theme: Theme) => void) | null = null;

/** Reports a theme choice made through the Appearance section. */
export function reportThemeChoice(theme: Theme): void {
  liveThemeReporter?.(theme);
}

/** Latest known native signal; seeds the matchMedia shim synchronously. */
let nativeDark = false;

function setNativeDark(dark: boolean): void {
  nativeDark = dark;
  darkSchemeListeners?.notify();
}

type DarkSchemeListeners = {
  add(callback: () => void): void;
  remove(callback: () => void): void;
  notify(): void;
};
let darkSchemeListeners: DarkSchemeListeners | null = null;

/** Test hook: clears the installed shim so a test can re-install it. */
export function resetMatchMediaShimForTests(): void {
  darkSchemeListeners = null;
  nativeDark = false;
}

/** Test hook for shim-only tests: pushes a native signal without a bridge. */
export function setNativeDarkForTests(dark: boolean): void {
  setNativeDark(dark);
}

/**
 * Serves the dark-scheme media query from the native signal instead of the
 * (possibly wrong) web-contents media state. Other queries pass through.
 * Installed once; a frozen or missing matchMedia keeps the app untouched.
 */
export function installMatchMediaShim(
  getWindow: () => { matchMedia(query: string): MediaQueryList } | undefined,
): void {
  const win = getWindow();
  if (!win || darkSchemeListeners) return;
  const listeners = new Set<() => void>();
  const original =
    typeof win.matchMedia === "function" ? win.matchMedia.bind(win) : null;
  const fallback = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  let shim: MediaQueryList | null = null;
  try {
    shim = {
      get matches() {
        return nativeDark;
      },
      media: DARK_SCHEME_QUERY,
      onchange: null,
      addEventListener: (type: string, callback: EventListenerOrEventListenerObject) => {
        if (type === "change") listeners.add(callback as () => void);
      },
      removeEventListener: (type: string, callback: EventListenerOrEventListenerObject) => {
        listeners.delete(callback as () => void);
      },
      addListener: (callback: () => void) => {
        listeners.add(callback);
      },
      removeListener: (callback: () => void) => {
        listeners.delete(callback);
      },
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    win.matchMedia = (query: string) =>
      query === DARK_SCHEME_QUERY
        ? shim!
        : original
          ? original(query)
          : fallback(query);
  } catch {
    return;
  }
  const registered: DarkSchemeListeners = {
    add: (callback) => listeners.add(callback),
    remove: (callback) => listeners.delete(callback),
    notify: () => {
      const event =
        typeof MediaQueryListEvent === "function"
          ? new MediaQueryListEvent("change", {
              matches: nativeDark,
              media: DARK_SCHEME_QUERY,
            })
          : new Event("change");
      for (const callback of [...listeners])
        (callback as (e: Event) => void)(event);
    },
  };
  darkSchemeListeners = registered;
}

export function startNativeThemeSync(
  deps?: Partial<NativeThemeSyncDeps> & {
    storage?: { getItem(key: string): string | null };
  },
): () => void {
  const bridge =
    deps?.bridge ??
    (typeof window === "undefined" ? undefined : window.drogon?.nativeTheme);
  if (!bridge) return () => {};
  const storage = deps?.storage ?? window.localStorage;
  const readPersistedTheme =
    deps?.readPersistedTheme ?? (() => persistedTheme(storage));
  const root: ThemeRoot = deps?.root ?? document.documentElement;

  let disposed = false;
  let currentTheme: Theme | null = null;
  let adoptTimers: ReturnType<typeof setTimeout>[] = [];

  const apply = (): void => {
    applyThemeToRoot(
      root,
      resolveEffectiveTheme(currentTheme ?? readPersistedTheme(), nativeDark),
    );
  };
  // 'updated' is only a wake-up signal: Electron may deliver it around the
  // property flip, so every application re-pulls the authoritative state.
  const repull = (): void => {
    void bridge
      .state()
      .then((state) => {
        if (disposed) return;
        setNativeDark(state.shouldUseDarkColors);
        apply();
      })
      .catch(() => {});
  };
  const settleRepull = (): void => {
    for (const delay of SETTLE_PULL_DELAYS_MS) {
      adoptTimers.push(setTimeout(repull, delay));
    }
  };
  // A write that bypassed the section (e.g. the status-bar theme cycle)
  // lands in the envelope only after the store's debounce; adopt it past
  // both deadlines so the resolution converges on the persisted truth.
  const adoptPersistedSoon = (): void => {
    for (const delay of PERSISTED_ADOPT_DELAYS_MS) {
      adoptTimers.push(
        setTimeout(() => {
          if (disposed) return;
          currentTheme = readPersistedTheme();
          repull();
        }, delay),
      );
    }
  };

  installMatchMediaShim(() =>
    typeof window === "undefined" ? undefined : window,
  );

  // Boot reconciliation: the pull corrects a stale initial render, and the
  // source mirror (reference startup line) makes Electron's own surfaces
  // agree with the stored choice; the settle pulls then converge on the
  // post-settle native state.
  repull();
  void bridge.setThemeSource(readPersistedTheme()).catch(() => {});
  settleRepull();
  adoptPersistedSoon();
  const unsubscribe = bridge.onChange(() => repull());
  liveThemeReporter = (theme) => {
    if (disposed) return;
    currentTheme = theme;
    void bridge.setThemeSource(theme).catch(() => {});
    apply();
    settleRepull();
    adoptPersistedSoon();
  };
  return () => {
    disposed = true;
    liveThemeReporter = null;
    unsubscribe();
    for (const timer of adoptTimers) clearTimeout(timer);
    adoptTimers = [];
  };
}
