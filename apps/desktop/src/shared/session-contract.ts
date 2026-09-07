import type { FileBridge } from "./file-contract";
import type { BotBridge } from "./bot-contract";

export type Verdict = "live" | "unverifiable" | "exited";
export type Workspace = {
  id: string;
  path: string;
  name: string;
  kind: "folder" | "git";
  hostId: string;
};
/** A git repository or a plain folder that owns Worktrees (journey J1). */
export type Project = {
  id: string;
  hostId: string;
  path: string;
  name: string;
  kind: "git" | "folder";
  defaultBaseRef: string | null;
};
/**
 * A git worktree (or, for a folder Project, the implicit single worktree
 * that is the folder itself) that a Session attaches to as a Workspace.
 */
export type Worktree = {
  id: string;
  projectId: string;
  workspaceId: string;
  path: string;
  branch: string;
  head: string;
  baseRef: string | null;
  createdAt: string;
};
export type AgentState = "working" | "idle" | "needs_input" | "exited" | "unknown";
export type Session = {
  id: string;
  workspaceId: string;
  hostId: string;
  incarnation: string;
  command: string;
  args: string[];
  cols: number;
  rows: number;
  verdict: Verdict;
  exitCode: number | null;
  createdAt: string;
  /**
   * Always present on the wire (`session.list`/`session.read`/CLI output);
   * optional here only so this additive field never breaks an existing
   * renderer `Session` literal that predates it.
   */
  agentState?: AgentState;
  agentStateAt?: string | null;
};
export type Status = {
  hostId: string;
  serviceInstanceId: string;
  protocol: 1;
  capabilities: string[];
  version: string;
};
export type Identity = { sessionId: string; incarnation: string };
export type HarnessId = "claude" | "pi" | "opencode" | "antigravity";
export type HarnessAvailability =
  "available" | "missing" | "unsupported_launcher";
export type PermissionMode = "inherit" | "unattended";
export type Harness = {
  harnessId: HarnessId;
  displayName: string;
  availability: HarnessAvailability;
  executable: string | null;
};
export type HarnessLaunchInput = {
  workspaceId: string;
  harnessId: HarnessId;
  model?: string;
  provider?: string;
  effort?: string;
  prompt?: string;
  permissionMode: PermissionMode;
  requestId: string;
};
export type ReadResult = {
  session: Session;
  dataBase64: string;
  startCursor: number;
  nextCursor: number;
  truncated: boolean;
};
export type Result<T> =
  | { ok: true; result: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };
export interface DesktopBridge extends FileBridge, BotBridge {
  status(): Promise<Result<Status>>;
  workspaces(): Promise<Result<{ workspaces: Workspace[] }>>;
  addWorkspace(path: string): Promise<Result<Workspace>>;
  chooseFolder(): Promise<string | null>;
  sessions(workspaceId: string): Promise<Result<{ sessions: Session[] }>>;
  start(workspaceId: string): Promise<Result<Session>>;
  harnesses(): Promise<Result<{ hostId: string; harnesses: Harness[] }>>;
  startHarness(input: HarnessLaunchInput): Promise<Result<Session>>;
  read(input: Identity & { cursor: number }): Promise<Result<ReadResult>>;
  write(
    input: Identity & { text: string },
  ): Promise<Result<{ acceptedBytes: number }>>;
  resize(
    input: Identity & { cols: number; rows: number },
  ): Promise<Result<Session>>;
  stop(input: Identity): Promise<Result<Session>>;
  /** Non-secret packaged build identity (or `null` in development, or a build without it); never a token or path. */
  buildInfo(): Promise<{
    revision: string;
    builtAt: string;
    version: string;
  } | null>;
}
declare global {
  interface Window {
    drogon: DesktopBridge;
  }
}
