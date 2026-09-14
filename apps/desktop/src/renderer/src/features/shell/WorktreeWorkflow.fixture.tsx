// Render the product cards with explicit snapshot fixtures, not simulated graph execution.
import React from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "../../components/ui/tooltip";
import { WorktreeCard } from "./WorktreeCard";
import { DEFAULT_GRAPH_POLICY, type GraphBridge, type OrchestratorRun } from "../../../../shared/graph-contract";
import type { Session } from "../../../../shared/session-contract";

const initial: OrchestratorRun = {
  id: "fixture-workflow-1", workspaceId: "project-workspace", policy: DEFAULT_GRAPH_POLICY,
  main: { id: "main", title: "Fixture graph main", prompt: "Fixture task", harness: "pi", model: "fixture/model", dependsOn: [], enabled: true },
  status: "running", phase: "main", iteration: 1,
  steps: [{ nodeId: "main-1", phase: "main", iteration: 1, status: "running", runId: "session:main-session:fixture-main-session", isFallback: false,
    runtime: { harness: "pi", model: "fixture/model" }, attempts: [] }],
  startedAt: "2026-09-13T03:00:00Z", updatedAt: "2026-09-13T03:00:00Z",
};
let current = initial;
let unavailable = false;
let revision = 0;
const calls = { polls: 0, starts: 0, stops: 0, selectedSession: "" };
const bridge = {
  async graphOrchestratorStatus({ workspaceId }: { workspaceId: string }) {
    if (workspaceId !== initial.workspaceId) return { ok: true, result: { run: null } };
    calls.polls += 1;
    if (unavailable) throw new Error("Fixture transport unavailable");
    return { ok: true, result: { run: current } };
  },
  async graphOrchestratorStart() { calls.starts += 1; throw new Error("Read-only fixture must not start work"); },
  async graphOrchestratorStop() { calls.stops += 1; throw new Error("Read-only fixture must not stop work"); },
} as unknown as GraphBridge;
function session(id: string, workspaceId = initial.workspaceId): Session {
  return { id, workspaceId, hostId: "fixture-host", incarnation: `fixture-${id}`, command: "fixture-pi", harnessId: "pi", args: [],
    cols: 80, rows: 24, verdict: "live", agentState: "working", exitCode: null, createdAt: initial.startedAt };
}
const sessions: Session[] = [
  { ...session("bot-dispatcher", "bot-home"), verdict: "exited", agentState: "exited", exitCode: 0 },
  session("main-session"),
  { ...session("worker-deck"), parentSessionId: "main-session" },
  { ...session("worker-page"), parentSessionId: "main-session" },
];
function Card({ workspaceId, title }: { workspaceId: string; title: string }) {
  return <WorktreeCard
    worktree={{ id: workspaceId, projectId: workspaceId, workspaceId, path: `/fixture/${title}`, branch: title, head: "", baseRef: null, createdAt: initial.startedAt }}
    workspaces={[]} sessions={sessions} selected={false} disabled={false}
    projectKind="folder" implicitFolderWorktree onSelect={() => {}}
    onSelectSession={(id) => { calls.selectedSession = id; }}
    onRemove={null} onRename={null} graphBridge={bridge}
  />;
}
const root = createRoot(document.getElementById("root")!);
document.documentElement.classList.add("dark");
root.render(<TooltipProvider><section style={{ width: 370, padding: 20 }}>
  <Card workspaceId="bot-home" title="Bot home" />
  <Card workspaceId={initial.workspaceId} title="Delegated project" />
</section></TooltipProvider>);
Object.assign(window, { delegationSidebarFixture: {
  calls,
  disconnect(value: boolean) { unavailable = value; },
  nextRun() {
    revision += 1;
    current = { ...initial, id: `fixture-workflow-${revision + 1}`, updatedAt: new Date(Date.UTC(2026, 8, 13, 3, revision)).toISOString() };
  },
  unmount() { root.unmount(); },
} });
