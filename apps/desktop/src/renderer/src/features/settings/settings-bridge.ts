// Typed access to the granted `window.drogon.settings.*` namespace.
// DesktopBridge (coordinator-owned) gains the field through the module
// augmentation in shared/settings-contract.ts; the cast here only narrows
// for call sites that must also run where the preload bridge is absent
// (tests, older builds), where every probe honestly reports unavailable.
import type {
  SettingsProbeBridge,
} from "../../../../shared/settings-contract";

export function windowSettingsBridge(): SettingsProbeBridge | null {
  try {
    const bridge = (
      window as unknown as { drogon?: { settings?: SettingsProbeBridge } }
    ).drogon?.settings;
    return bridge ?? null;
  } catch {
    return null;
  }
}
