import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  SETTINGS_DEFAULTS,
  SettingsStore,
  mergeSettingLayers,
  parsePersistedSettings,
  readTerminalGpuAcceleration,
  settingsStorageKey,
  writeTerminalGpuAcceleration,
} from "./settings-store";
import type { SettingsSubset, StorageLike } from "./settings-store";

const defaults: SettingsSubset = {
  theme: "system",
  inspectorVisible: true,
  locale: "en",
  terminalFontSize: 13,
  defaultHarnessId: "",
  harnessDefaults: {},
  notifyOnAgentNeedsInput: true,
  terminalGpuAcceleration: "auto",
};

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  seed(key: string, value: string): void {
    this.map.set(key, value);
  }
  peek(key: string): string | null {
    return this.map.get(key) ?? null;
  }
}

describe("merge precedence (defaults < persisted < migration < launchOverride)", () => {
  it("applies defaults when no upper layers are present", () => {
    expect(mergeSettingLayers({ defaults })).toEqual(defaults);
  });
  it("lets each upper layer override every layer below it", () => {
    const merged = mergeSettingLayers({
      defaults,
      persisted: { theme: "dark" },
      migration: { theme: "light" },
      launchOverride: { theme: "system" },
    });
    expect(merged.theme).toBe("system");
    expect(
      mergeSettingLayers({ defaults, persisted: { theme: "dark" } }).theme,
    ).toBe("dark");
    expect(
      mergeSettingLayers({ defaults, migration: { theme: "light" } }).theme,
    ).toBe("light");
  });
  it("keeps an explicit false even when upper layers leave the key absent", () => {
    const merged = mergeSettingLayers({
      defaults,
      persisted: { inspectorVisible: false },
      migration: { locale: "es" },
    });
    expect(merged.inspectorVisible).toBe(false);
    expect(merged.locale).toBe("es");
    expect(merged.theme).toBe("system");
  });
  it("still honours ordered precedence when upper layers set the same key explicitly", () => {
    expect(
      mergeSettingLayers({
        defaults,
        persisted: { inspectorVisible: false },
        migration: { inspectorVisible: true },
      }).inspectorVisible,
    ).toBe(true);
  });
});

describe("malformed and foreign persisted payloads", () => {
  it("returns no overrides for missing or malformed raw payloads", () => {
    expect(parsePersistedSettings(null)).toEqual({});
    expect(parsePersistedSettings(undefined)).toEqual({});
    expect(parsePersistedSettings("")).toEqual({});
    expect(parsePersistedSettings("not json{")).toEqual({});
    expect(parsePersistedSettings("[1,2,3]")).toEqual({});
    expect(parsePersistedSettings('"just a string"')).toEqual({});
  });
  it("rejects foreign envelopes without throwing", () => {
    expect(
      parsePersistedSettings('{"routeId":"terminal","state":{"scrollTop":3}}'),
    ).toEqual({});
    expect(parsePersistedSettings('{"settings":"dark"}')).toEqual({});
    expect(parsePersistedSettings('{"settings":[["theme","dark"]]}')).toEqual(
      {},
    );
  });
  it("keeps only known fields with well-typed values", () => {
    expect(
      parsePersistedSettings(
        '{"settings":{"theme":"dark","inspectorVisible":false,"locale":"es","evilKey":123}}',
      ),
    ).toEqual({ theme: "dark", inspectorVisible: false, locale: "es" });
    expect(
      parsePersistedSettings(
        '{"settings":{"theme":"blurple","inspectorVisible":"yes","locale":42}}',
      ),
    ).toEqual({});
  });
  it("falls back to defaults when the storage payload is garbage", () => {
    const storage = new MemoryStorage();
    storage.seed(settingsStorageKey("ui"), "not json{");
    const store = new SettingsStore(storage, { namespace: "ui" });
    expect(() => store.get("theme")).not.toThrow();
    expect(store.get("theme")).toBe("system");
    expect(store.get("inspectorVisible")).toBe(true);
  });
  it("falls back to defaults when the storage read itself throws", () => {
    const store = new SettingsStore(
      new MemoryStorage(),
      { namespace: "ui" },
    );
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("disk error");
      },
      setItem: () => {
        throw new Error("disk error");
      },
    };
    void store;
    expect(() => new SettingsStore(throwing, { namespace: "ui" })).not.toThrow();
    expect(new SettingsStore(throwing, { namespace: "ui" }).get("theme")).toBe(
      "system",
    );
  });
});

describe("typed get/set for the UI-chrome subset", () => {
  it("applies catalog-anchored defaults on a fresh store", () => {
    const store = new SettingsStore(new MemoryStorage(), { namespace: "ui" });
    expect(store.get("theme")).toBe("system");
    expect(store.get("inspectorVisible")).toBe(true);
    expect(store.get("locale")).toBe("en");
    expect(SETTINGS_DEFAULTS.theme).toBe("system");
  });
  it("set returns the updated in-memory state and get reflects it", () => {
    const store = new SettingsStore(new MemoryStorage(), { namespace: "ui" });
    const state = store.set("theme", "dark");
    expect(state.theme).toBe("dark");
    expect(state.inspectorVisible).toBe(true);
    expect(store.get("theme")).toBe("dark");
    store.set("inspectorVisible", false);
    store.set("locale", "es");
    expect(store.get("inspectorVisible")).toBe(false);
    expect(store.get("locale")).toBe("es");
  });
  it("launchOverride beats a differing persisted value", () => {
    const storage = new MemoryStorage();
    storage.seed(
      settingsStorageKey("ui"),
      '{"settings":{"theme":"dark","locale":"en"}}',
    );
    const store = new SettingsStore(storage, {
      namespace: "ui",
      launchOverride: { theme: "light" },
    });
    expect(store.get("theme")).toBe("light");
    expect(store.get("locale")).toBe("en");
  });
});

describe("persistence round-trip through injected storage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes the merged state under the namespaced key on flush", () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage, { namespace: "ui" });
    store.set("locale", "es");
    store.flush();
    expect(settingsStorageKey("ui")).toBe("drogon:settings:ui");
    const raw = storage.peek(settingsStorageKey("ui"));
    expect(JSON.parse(raw as string)).toEqual({
      settings: {
        theme: "system",
        inspectorVisible: true,
        locale: "es",
        terminalFontSize: 13,
        defaultHarnessId: "",
        harnessDefaults: {},
        notifyOnAgentNeedsInput: true,
        terminalGpuAcceleration: "auto",
      },
    });
  });
  it("restores persisted state into a new store instance", () => {
    const storage = new MemoryStorage();
    const first = new SettingsStore(storage, { namespace: "ui" });
    first.set("theme", "dark");
    first.set("inspectorVisible", false);
    first.flush();
    const second = new SettingsStore(storage, { namespace: "ui" });
    expect(second.get("theme")).toBe("dark");
    expect(second.get("inspectorVisible")).toBe(false);
    expect(second.get("locale")).toBe("en");
  });
  it("debounces writes by 1s", () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage, { namespace: "ui" });
    store.set("locale", "es");
    vi.advanceTimersByTime(999);
    expect(storage.peek(settingsStorageKey("ui"))).toBeNull();
    vi.advanceTimersByTime(1);
    expect(storage.peek(settingsStorageKey("ui"))).not.toBeNull();
  });
  it("caps pending writes at 5s even when sets keep rescheduling", () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage, { namespace: "ui" });
    for (let offset = 0; offset <= 5; offset += 1) {
      store.set("inspectorVisible", offset % 2 === 0);
      if (offset < 5) vi.advanceTimersByTime(900);
    }
    expect(storage.peek(settingsStorageKey("ui"))).toBeNull();
    vi.advanceTimersByTime(499);
    expect(storage.peek(settingsStorageKey("ui"))).toBeNull();
    vi.advanceTimersByTime(1);
    expect(storage.peek(settingsStorageKey("ui"))).not.toBeNull();
  });
  it("never throws when the storage write fails", () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("disk error");
      },
    };
    const store = new SettingsStore(throwing, { namespace: "ui" });
    expect(() => store.set("locale", "es")).not.toThrow();
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(store.get("locale")).toBe("es");
  });
});

describe("J10 additive keys (terminal font size, harness defaults, notifications)", () => {
  it("applies J10 defaults on a fresh store", () => {
    const store = new SettingsStore(new MemoryStorage(), { namespace: "ui" });
    expect(store.get("terminalFontSize")).toBe(13);
    expect(store.get("defaultHarnessId")).toBe("");
    expect(store.get("harnessDefaults")).toEqual({});
    expect(store.get("notifyOnAgentNeedsInput")).toBe(true);
    expect(SETTINGS_DEFAULTS.terminalFontSize).toBe(13);
    expect(SETTINGS_DEFAULTS.notifyOnAgentNeedsInput).toBe(true);
  });
  it("round-trips the J10 keys through set + flush + reload", () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage, { namespace: "ui" });
    store.set("terminalFontSize", 15);
    store.set("defaultHarnessId", "pi");
    store.set("harnessDefaults", {
      pi: { model: "opus", effort: "high", permissionMode: "unattended" },
    });
    store.set("notifyOnAgentNeedsInput", false);
    store.flush();
    const reloaded = new SettingsStore(storage, { namespace: "ui" });
    expect(reloaded.get("terminalFontSize")).toBe(15);
    expect(reloaded.get("defaultHarnessId")).toBe("pi");
    expect(reloaded.get("harnessDefaults")).toEqual({
      pi: { model: "opus", effort: "high", permissionMode: "unattended" },
    });
    expect(reloaded.get("notifyOnAgentNeedsInput")).toBe(false);
  });
  it("drops malformed J10 values individually, keeping the well-typed ones", () => {
    expect(
      parsePersistedSettings(
        '{"settings":{"terminalFontSize":200,"defaultHarnessId":"pi","notifyOnAgentNeedsInput":"yes"}}',
      ),
    ).toEqual({ defaultHarnessId: "pi" });
    expect(
      parsePersistedSettings('{"settings":{"terminalFontSize":14.5}}'),
    ).toEqual({});
    expect(parsePersistedSettings('{"settings":{"terminalFontSize":14}}')).toEqual(
      { terminalFontSize: 14 },
    );
    expect(
      parsePersistedSettings('{"settings":{"defaultHarnessId":"a\\u0000b"}}'),
    ).toEqual({});
  });
  it("keeps only well-formed per-harness entries", () => {
    expect(
      parsePersistedSettings(
        '{"settings":{"harnessDefaults":{"pi":{"model":"opus","effort":"","permissionMode":"unattended"},"bogus":{"model":42},"evil\\u0000key":{"model":"x","effort":"","permissionMode":"inherit"}}}}',
      ),
    ).toEqual({
      harnessDefaults: {
        pi: { model: "opus", effort: "", permissionMode: "unattended" },
      },
    });
    expect(
      parsePersistedSettings('{"settings":{"harnessDefaults":["pi"]}}'),
    ).toEqual({});
  });
  it("keeps an explicit false notification switch across unrelated migrations", () => {
    const merged = mergeSettingLayers({
      defaults,
      persisted: { notifyOnAgentNeedsInput: false },
      migration: { locale: "es" },
    });
    expect(merged.notifyOnAgentNeedsInput).toBe(false);
    expect(merged.locale).toBe("es");
  });
});

describe("unknown-key forward compatibility on read-modify-write", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("carries forward-compat keys unmodified through set + flush", () => {
    const storage = new MemoryStorage();
    storage.seed(
      settingsStorageKey("ui"),
      '{"settings":{"theme":"dark","futureField":{"nested":true},"anotherFutureKey":42}}',
    );
    const store = new SettingsStore(storage, { namespace: "ui" });
    store.set("locale", "es");
    store.flush();
    const raw = JSON.parse(storage.peek(settingsStorageKey("ui")) as string);
    expect(raw.settings.futureField).toEqual({ nested: true });
    expect(raw.settings.anotherFutureKey).toBe(42);
    expect(raw.settings.theme).toBe("dark");
    expect(raw.settings.locale).toBe("es");
  });

  it("does not let unknown keys leak into typed get() results", () => {
    const storage = new MemoryStorage();
    storage.seed(
      settingsStorageKey("ui"),
      '{"settings":{"theme":"light","futureField":"x"}}',
    );
    const store = new SettingsStore(storage, { namespace: "ui" });
    expect(store.get("theme")).toBe("light");
    expect((store as unknown as Record<string, unknown>).futureField).toBeUndefined();
  });

  it("keeps unknown keys stable and unmodified across repeated flushes", () => {
    const storage = new MemoryStorage();
    storage.seed(
      settingsStorageKey("ui"),
      '{"settings":{"theme":"dark","futureField":"original"}}',
    );
    const store = new SettingsStore(storage, { namespace: "ui" });
    store.set("locale", "es");
    store.flush();
    store.set("locale", "fr");
    store.flush();
    const raw = JSON.parse(storage.peek(settingsStorageKey("ui")) as string);
    expect(raw.settings.futureField).toBe("original");
    expect(raw.settings.locale).toBe("fr");
  });

  it("does not fabricate unknown keys when the raw payload is malformed", () => {
    const storage = new MemoryStorage();
    storage.seed(settingsStorageKey("ui"), "not json{");
    const store = new SettingsStore(storage, { namespace: "ui" });
    store.set("locale", "es");
    store.flush();
    const raw = JSON.parse(storage.peek(settingsStorageKey("ui")) as string);
    expect(raw.settings).toEqual({
      theme: "system",
      inspectorVisible: true,
      locale: "es",
      terminalFontSize: 13,
      defaultHarnessId: "",
      harnessDefaults: {},
      notifyOnAgentNeedsInput: true,
      terminalGpuAcceleration: "auto",
    });
  });
});

describe("terminalGpuAcceleration persistence (R11-A)", () => {
  it("defaults to auto and round-trips through the store", () => {
    const storage = new MemoryStorage();
    const store = new SettingsStore(storage, { namespace: "ui" });
    expect(store.get("terminalGpuAcceleration")).toBe("auto");
    store.set("terminalGpuAcceleration", "off");
    store.flush();
    const reopened = new SettingsStore(storage, { namespace: "ui" });
    expect(reopened.get("terminalGpuAcceleration")).toBe("off");
  });
  it("drops malformed persisted values back to the default", () => {
    const storage = new MemoryStorage();
    storage.seed(
      settingsStorageKey("ui"),
      JSON.stringify({ settings: { terminalGpuAcceleration: "ALWAYS" } }),
    );
    const store = new SettingsStore(storage, { namespace: "ui" });
    expect(store.get("terminalGpuAcceleration")).toBe("auto");
  });
  it("the envelope reader falls back to auto on absent or garbage data", () => {
    const storage = new MemoryStorage();
    expect(readTerminalGpuAcceleration(storage)).toBe("auto");
    storage.seed(settingsStorageKey("ui"), "not json{");
    expect(readTerminalGpuAcceleration(storage)).toBe("auto");
  });
  it("the envelope writer preserves sibling keys, known and unknown", () => {
    const storage = new MemoryStorage();
    storage.seed(
      settingsStorageKey("ui"),
      JSON.stringify({
        settings: { theme: "dark", futureField: "keep", inspectorVisible: false },
      }),
    );
    writeTerminalGpuAcceleration(storage, "on");
    const raw = JSON.parse(storage.peek(settingsStorageKey("ui")) as string);
    expect(raw.settings).toEqual({
      theme: "dark",
      futureField: "keep",
      inspectorVisible: false,
      terminalGpuAcceleration: "on",
    });
  });
  it("a write creates a valid envelope from an empty storage", () => {
    const storage = new MemoryStorage();
    writeTerminalGpuAcceleration(storage, "off");
    const raw = JSON.parse(storage.peek(settingsStorageKey("ui")) as string);
    expect(raw.settings.terminalGpuAcceleration).toBe("off");
    expect(
      new SettingsStore(storage, { namespace: "ui" }).get(
        "terminalGpuAcceleration",
      ),
    ).toBe("off");
  });
});
