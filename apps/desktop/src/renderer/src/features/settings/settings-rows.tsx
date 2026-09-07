// Compat re-exports: the canonical settings grammar now lives in the
// ported SettingsSection / SettingsFormControls modules (see those files
// for the Orca source citations); existing section imports keep working.
export { SettingsSection } from "./SettingsSection";
export {
  SettingsFieldError,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitch,
  SettingsSwitchRow,
} from "./SettingsFormControls";
export type { SettingsSegmentedOption } from "./SettingsFormControls";
