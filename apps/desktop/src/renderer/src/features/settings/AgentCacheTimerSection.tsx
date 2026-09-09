// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from components/settings/AgentCacheTimerSection.tsx.
import { Timer } from "lucide-react";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  SettingsSubsectionHeader,
  SettingsSwitch,
} from "./SettingsFormControls";
import type {
  AgentSettings,
  AgentSettingsUpdate,
} from "../../../../shared/agent-settings-contract";
export function AgentCacheTimerSection({
  settings,
  updateSettings,
}: {
  settings: AgentSettings;
  updateSettings: (updates: AgentSettingsUpdate) => void;
}) {
  return (
    <section className="space-y-4">
      <SettingsSubsectionHeader
        title="Prompt Cache Timer"
        description="Claude caches your conversation to reduce costs. When idle too long the cache expires and the next message resends full context at higher cost. This shows a countdown so you know when to resume."
      />
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <Timer className="size-4 text-muted-foreground" />
            <Label>Cache Timer</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Show a countdown in the sidebar after a Claude agent becomes idle.
          </p>
        </div>
        <SettingsSwitch
          ariaLabel="Cache Timer"
          checked={settings.promptCacheTimerEnabled}
          onChange={() =>
            updateSettings({
              promptCacheTimerEnabled: !settings.promptCacheTimerEnabled,
            })
          }
        />
      </div>
      {settings.promptCacheTimerEnabled && (
        <div className="flex items-center justify-between gap-4 py-2 pl-7">
          <div className="min-w-0 flex-1 space-y-0.5">
            <Label>Timer Duration</Label>
            <p className="text-xs text-muted-foreground">
              Match this to your provider's cache TTL. The default is 5 minutes.
            </p>
          </div>
          <Select
            value={String(settings.promptCacheTtlMs)}
            onValueChange={(value) =>
              updateSettings({
                promptCacheTtlMs: Number(value) as 300000 | 3600000,
              })
            }
          >
            <SelectTrigger
              aria-label="Timer Duration"
              size="sm"
              className="h-7 text-xs w-[120px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="300000">5 minutes</SelectItem>
              <SelectItem value="3600000">1 hour</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </section>
  );
}
