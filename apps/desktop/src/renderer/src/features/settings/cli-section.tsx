// MIT Copyright (c) 2026 Lovecast Inc.
// Ported structure from the Orca reference (read-only):
//   src/renderer/src/components/settings/CliSection.tsx
//     (section[data-settings-section="cli"], h2 text-sm "Orca CLI" +
//      description, rounded-xl border card with the "Shell command" row:
//      Label + detail line, refresh affordance, command-path row)
// Adapted: read-only status for the bundled drogon-cli (J3 shims in
// <data-dir>/bin) through window.drogon.settings.cliStatus. The Orca-only
// machinery is omitted (reasons in the PR): the install/remove Switch +
// CliRegistrationDialog (no installer IPC in Drogon), the agent-skills
// panel (needs a setup terminal + CLI prerequisite), WSL registration.
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { CliStatusResult } from "../../../../shared/settings-contract";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { windowSettingsBridge } from "./settings-bridge";
import {
  AgentSkillSetupPanel,
  SkillsLoadingRow,
  loadSkillsOverview,
  type AgentSkillTopic,
  type SkillsOverviewState,
} from "./agent-skill-setup-panel";

type ProbeState =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; value: CliStatusResult };

export function CliSection(): React.JSX.Element {
  const [probe, setProbe] = useState<ProbeState>({ status: "loading" });
  const [skills, setSkills] = useState<SkillsOverviewState>({ status: "loading" });

  const refreshSkills = useCallback(() => {
    setSkills({ status: "loading" });
    void loadSkillsOverview().then(setSkills);
  }, []);

  const refresh = useCallback(() => {
    const bridge = windowSettingsBridge();
    if (!bridge || typeof bridge.cliStatus !== "function") {
      setProbe({
        status: "unavailable",
        reason: "settings bridge is missing",
      });
      return;
    }
    setProbe({ status: "loading" });
    void bridge
      .cliStatus()
      .then((result) => {
        if (!result.ok) {
          setProbe({ status: "unavailable", reason: result.error.message });
          return;
        }
        setProbe({ status: "ready", value: result.result });
      })
      .catch(() =>
        setProbe({ status: "unavailable", reason: "CLI probe failed" }),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    refreshSkills();
  }, [refreshSkills]);

  const loading = probe.status === "loading";
  const detail =
    probe.status === "loading"
      ? "Checking CLI registration…"
      : probe.status === "unavailable"
        ? `Not available: ${probe.reason}`
        : probe.value.detail;
  const statusBadge =
    probe.status === "ready" ? (
      <span className="settings-value">
        {probe.value.available ? "Installed" : "Not found"}
      </span>
    ) : probe.status === "unavailable" ? (
      <span className="settings-unavailable">Unavailable</span>
    ) : null;

  return (
    <section className="space-y-4" data-settings-section="cli">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Drogon CLI</h2>
        <p className="text-xs text-muted-foreground">
          Use Drogon from your terminal to open the app, manage worktrees,
          and interact with Drogon terminals.
        </p>
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-card/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>Shell command</Label>
            <p
              role="status"
              className={
                probe.status === "unavailable"
                  ? "text-xs text-amber-600 dark:text-amber-400"
                  : "text-xs text-muted-foreground"
              }
            >
              {detail}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={refresh}
              disabled={loading}
              aria-label="Refresh CLI status"
              title="Refresh"
            >
              <RefreshCw className="size-3.5" />
            </Button>
            {statusBadge}
          </div>
        </div>

        {probe.status === "ready" && probe.value.commandPath ? (
          <p className="text-xs text-muted-foreground">
            Command path:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              {probe.value.commandPath}
            </code>
          </p>
        ) : null}
        {probe.status === "ready" && probe.value.version ? (
          <p className="text-xs text-muted-foreground">
            Version:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              {probe.value.version}
            </code>
          </p>
        ) : null}
      </div>

      <div className="space-y-3 rounded-xl border border-border/60 bg-card/50 p-4">
        <div className="space-y-0.5">
          <Label>Agent skills</Label>
          <p className="text-xs text-muted-foreground">
            Give agents Drogon-aware workspace, terminal, and progress
            workflows.
          </p>
        </div>
        {skills.status === "loading" ? <SkillsLoadingRow /> : null}
        {skills.status === "unavailable" ? (
          <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
            Not available: {skills.reason}
          </p>
        ) : null}
        {skills.status === "ready"
          ? skills.topics.map((topic: AgentSkillTopic) => (
              <AgentSkillSetupPanel
                key={topic.name}
                topic={topic}
                title={topicTitle(topic.name)}
                description={topicDescription(topic.name, topic.description)}
                installed={topic.installed}
                loading={false}
                error={null}
                onRecheck={refreshSkills}
              />
            ))
          : null}
      </div>
    </section>
  );
}

/** Reference CliSection panel titles, Orca→Drogon. */
function topicTitle(name: string): string {
  return name === "orchestration" ? "Orchestration skill" : "CLI skill";
}

/** Reference CliSection panel copy for the CLI skill, generalized per topic
 *  with the topic's own bundled description as the fallback detail. */
function topicDescription(name: string, description: string): string {
  if (name === "orchestration") {
    return "Enables agents to use Drogon supervised multi-agent coordination.";
  }
  if (name === "drogon-cli") {
    return "Enables agents to use Drogon workspace, terminal, and progress commands.";
  }
  return description;
}
