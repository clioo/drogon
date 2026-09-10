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
  /** Project Settings → Setup script; absent on older daemon payloads. */
  setupScript?: string | null;
  /** Daemon-owned Quick Session scratch project marker. */
  quickSession?: boolean;
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
  /**
   * Display title set by `worktree.rename` (Orca's inline rename renames
   * the card title only — never the branch, never the directory).
   * Nullish when never renamed; optional here only so this additive field
   * never breaks an existing renderer `Worktree` literal that predates it.
   */
  title?: string | null;
  /** Composer Advanced → Note. */
  note?: string | null;
  /** Composer Advanced → Parent worktree nesting edge. */
  parentWorktreeId?: string | null;
  createdAt: string;
  /**
   * Workspace Options metadata (Group by/Sort by/Pin/Archive/PR-link);
   * see `crates/drogon-protocol/src/worktree.rs`'s `Worktree` for the wire
   * contract each of these mirrors.
   */
  workspaceStatus?: string | null;
  isPinned?: boolean;
  isArchived?: boolean;
  sortOrder?: number;
  manualOrder?: number | null;
  lastActivityAt?: string | null;
  linkedPr?: number | null;
  creator?: "cli" | "automation" | null;
};
export type AgentState =
  "working" | "idle" | "needs_input" | "exited" | "unknown";
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
  /** Bounded first-known prompt preview, in memory only; used for stable tab names. */
  agentPromptPreview?: string | null;
  /** Claude Stop hook timestamp; never inferred from loss of contact. */
  cacheIdleAt?: string | null;
  /**
   * Additive (R12-E terminal restart): which harness launched this session
   * (`harness.start`), so the exit overlay's Restart can re-launch the same
   * harness. `null`/absent for plain `session.start` shells, whose restart
   * re-uses `command`/`args` verbatim instead.
   */
  harnessId?: HarnessId | null;
  /**
   * Additive (#359, subagent nesting): the session whose PTY spawned this
   * one (a `drogon-cli` invoked inside a terminal reports its inherited
   * `DROGON_SESSION_ID` — the fork's env-inheritance lineage). The sidebar
   * nests the row under the parent session's row when both attach to the
   * same worktree, like the fork's `orchestration.parentPaneKey` tree.
   * `null`/absent for parentless (UI-spawned) sessions; a parent outside
   * the row set renders flat (the fork's unreachable-row normalization).
   */
  parentSessionId?: string | null;
};
export type Status = {
  hostId: string;
  serviceInstanceId: string;
  protocol: 1;
  capabilities: string[];
  version: string;
};
export type Identity = { sessionId: string; incarnation: string };
export type HarnessId = "claude" | "pi" | "opencode" | "antigravity" | "codex";
export type HarnessAvailability =
  "available" | "missing" | "unsupported_launcher";
export type PermissionMode = "inherit" | "unattended";
export type Harness = {
  harnessId: HarnessId;
  displayName: string;
  availability: HarnessAvailability;
  executable: string | null;
};
/** One host-enumerated model, verbatim as the harness's own surface
 *  reported it (capability facts stay raw strings, never interpreted). */
export type HarnessModelEntry = {
  provider: string | null;
  id: string;
  context: string | null;
  maxOutput: string | null;
  thinking: boolean | null;
  images: boolean | null;
};
/** How the catalog was produced — source, version, and probe scope the UI
 *  renders instead of an unearned "confirmed". */
export type HarnessModelsProvenance = {
  executable: string;
  argv: string[];
  version: string | null;
  /** Wall-clock epoch ms of the probe; the UI derives honest age. */
  probedAtEpochMs: number;
  configScope: string;
};
/** How the enumeration attempt ended. Each variant renders distinctly;
 *  none of them invents model rows. */
export type HarnessModelsStatus =
  | "enumerated"
  | "not_installed"
  | "unsupported_surface"
  | "unsupported_platform"
  | "parse_failed"
  | "timed_out"
  | "probe_failed"
  | "isolation_failed";
/** One harness's host-scoped model catalog as probed by the daemon
 *  (`harness.models`). C01 honesty contract: installed vs discovered vs
 *  unavailable vs unknown is carried explicitly, with source, version and
 *  freshness — never a bare confident list. */
export type HarnessModelsCatalog = {
  harness: HarnessId;
  availability: HarnessAvailability;
  executable: string | null;
  provenance: HarnessModelsProvenance | null;
  entries: HarnessModelEntry[];
  status: HarnessModelsStatus;
  note: string | null;
  /** Probe isolation roots retained on disk (unverifiable cleanup);
 *  normally empty, non-empty is disclosed evidence. */
  retainedRoots: string[];
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
/**
 * Additive (R12-E terminal restart): explicit launch argv for
 * `start`, letting a restart re-launch the exact prior session command
 * instead of the default shell.
 */
export type SessionLaunchReuse = {
  command?: string;
  args?: string[];
  /**
   * Additive (R16-BC, #275): explicit spawn directory for the new session
   * (the explorer's "Open in Terminal" passes the row directory). The
   * daemon honours it only inside the workspace root.
   */
  cwd?: string;
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
  /** Omitting `workspaceId` returns every session on this host (Bot-session
   *  persistence: the sidebar's Chats section and the resume check need to
   *  see a Bot's session regardless of the currently selected workspace). */
  sessions(workspaceId?: string): Promise<Result<{ sessions: Session[] }>>;
  /**
   * `launch` is additive (R12-E restart reuse): pass the prior session's
   * recorded argv to re-launch it, or omit for the default shell.
   */
  start(
    workspaceId: string,
    launch?: SessionLaunchReuse,
  ): Promise<Result<Session>>;
  harnesses(): Promise<Result<{ hostId: string; harnesses: Harness[] }>>;
  /** Live per-harness model catalog (`harness.models`), probed by the
   *  daemon from the harness's own enumeration command under
   *  credential-free isolation. Never model inference. */
  harnessModels(input: {
    harnessId: HarnessId;
  }): Promise<Result<{ hostId: string; catalog: HarnessModelsCatalog }>>;
  startHarness(input: HarnessLaunchInput): Promise<Result<Session>>;
  read(input: Identity & { cursor: number }): Promise<Result<ReadResult>>;
  write(
    input: Identity & { text: string },
  ): Promise<Result<{ acceptedBytes: number }>>;
  resize(
    input: Identity & { cols: number; rows: number },
  ): Promise<Result<Session>>;
  stop(input: Identity): Promise<Result<Session>>;
  /**
   * Additive (R16-AL2, issue #228): the user-initiated close. Stops a live
   * PTY when this service instance owns it and forgets the durable record,
   * so exited rows AND post-restart `unverifiable` stubs alike release
   * their tab (a stub can never be resolved to `exited` — loss of contact
   * is not exit — so an explicit close is the honest dismissal). The
   * returned verdict is observed truth only: a forgotten stub still reads
   * `unverifiable`.
   */
  close(input: Identity): Promise<Result<Session>>;
  /**
   * Additive (R16-AL2, issue #228): forgets a record this service
   * instance holds no live handle for (a stub or an exited row). Refuses
   * a live session — `close` is the route that stops first.
   */
  forget(input: Identity): Promise<Result<Session>>;
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
