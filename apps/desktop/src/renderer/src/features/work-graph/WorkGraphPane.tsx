// MIT Copyright (c) 2026 Lovecast Inc.
// Work Graph has one surface: the daemon-owned orchestrator.
import { useState } from "react";
import type { FileBridge } from "../../../../shared/file-contract";
import type { GraphBridge } from "../../../../shared/graph-contract";
import type { Session } from "../../../../shared/session-contract";
import { Button } from "../../components/ui/button";
import { OrchestratorCanvas } from "../work-graph-workflows/OrchestratorCanvas";
import { SubagentPolicyPanel } from "../work-graph-workflows/SubagentPolicyPanel";
import { useOrchestratorRun } from "../work-graph-workflows/use-orchestrator-run";
import { useSubagentPolicy } from "../work-graph-workflows/use-subagent-policy";
import { useWorkGraphSource } from "./work-graph-source";

export function WorkGraphPane({
  fileBridge,
  graphBridge = null,
  hostId,
  workspaceId,
  mainSession = null,
  onStopMainSession,
  stoppingMainSession,
  adversarialLoopPollMs,
}: {
  fileBridge: FileBridge | null;
  graphBridge?: GraphBridge | null;
  hostId: string | null;
  workspaceId: string;
  mainSession?: Session | null;
  onStopMainSession?: () => void;
  stoppingMainSession?: boolean;
  adversarialLoopPollMs?: number;
}): React.JSX.Element {
  const { source, refresh } = useWorkGraphSource({
    fileBridge,
    graphBridge,
    hostId,
    workspaceId,
  });
  const document = source.kind === "loaded" ? source.document : null;
  const readable = document !== null || source.kind === "missing";
  const subagentPolicy = useSubagentPolicy({
    graphBridge,
    workspaceId,
    document,
    allowEmptyStart: source.kind === "missing",
    onSaved: refresh,
  });
  const durableOrchestrator = useOrchestratorRun(
    graphBridge,
    workspaceId,
    adversarialLoopPollMs,
  );
  const [mainDraft, setMainDraft] = useState<{
    workspaceId: string;
    task: { harness: string; model: string; prompt: string };
  } | null>(null);
  const savedMain = document?.intent.nodes.find(
    (node) => node.id === "orchestrator-main",
  );
  const configuredMain = (mainDraft?.workspaceId === workspaceId
    ? mainDraft.task
    : savedMain) ?? {
    harness: mainSession?.harnessId ?? "pi",
    model: "",
    prompt: "",
  };
  const mainNode = {
    ...configuredMain,
    id: "orchestrator-main",
    title: "Main agent",
    enabled: true,
    dependsOn: [],
  };
  const updateMainTask = (task: typeof configuredMain) => {
    setMainDraft({ workspaceId, task });
    subagentPolicy.save(subagentPolicy.policy, { ...mainNode, ...task });
  };
  const start = () => {
    void (async () => {
      if (!(await subagentPolicy.flush())) return;
      await durableOrchestrator.start(mainNode);
    })();
  };
  const runDisabledReason = !readable
    ? "Wait for the saved Work Graph to load before running."
    : !subagentPolicy.interactive
      ? "Saving Work Graph is unavailable in this build."
      : !configuredMain.prompt.trim()
        ? "Describe the main task first."
        : ["opencode", "pi"].includes(configuredMain.harness) &&
            !configuredMain.model.trim()
          ? "Choose a model for the main task."
          : durableOrchestrator.run?.status === "unverifiable"
            ? "Investigate the existing run: contact was lost and its processes may still be running."
            : subagentPolicy.saveStatus === "error"
              ? "Resolve the policy save error before running."
              : durableOrchestrator.busy ||
                  ["running", "stopping"].includes(
                    durableOrchestrator.run?.status ?? "",
                  )
                ? "A workflow is already running."
                : !graphBridge?.graphOrchestratorStart
                  ? "Running a workflow is unavailable in this build."
                  : null;

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-testid="work-graph-pane"
    >
      {!readable && source.kind !== "loading" ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b border-border p-3 text-sm"
        >
          <span>
            Could not read Work Graph. Your saved configuration has not been
            changed.
          </span>
          <Button variant="outline" size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto lg:flex-row">
        <OrchestratorCanvas
          policy={subagentPolicy.policy}
          mainSession={mainSession}
          loopLedger={null}
          onRunWorkflow={start}
          configuredMain={configuredMain}
          durableRun={durableOrchestrator.run}
          runError={durableOrchestrator.error}
          onStopRun={() => void durableOrchestrator.stop()}
          onResumeRun={() => void durableOrchestrator.resume()}
          canRun={runDisabledReason === null}
          runDisabledReason={runDisabledReason}
          saveStatus={subagentPolicy.saveStatus}
          saveError={subagentPolicy.saveError}
          workspaceId={workspaceId}
          onStopMainSession={onStopMainSession}
          stoppingMainSession={stoppingMainSession}
        />
        <SubagentPolicyPanel
          policy={subagentPolicy.policy}
          onChange={(policy) => subagentPolicy.save(policy, mainNode)}
          interactive={subagentPolicy.interactive}
          mainTask={configuredMain}
          onMainTaskChange={updateMainTask}
        />
      </div>
    </div>
  );
}
