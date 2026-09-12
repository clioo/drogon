import { z } from "zod";
import { agentSettingsResultSchema } from "./agent-settings-contract";
import { automationResultSchemas } from "./automation-contract";
import { fileResultSchemas } from "./file-validation";
import {
  meetingAnalysisSchema,
  meetingCommitmentPageSchema,
  meetingCommitmentSchema,
  meetingReadSchema,
  meetingsPageSchema,
} from "./meetings-contract";
import { workspacePortKillResultSchema } from "./usage-contract";

const id = z.string().min(1).max(128);
const workspace = z.object({
  id,
  path: z.string(),
  name: z.string(),
  kind: z.enum(["folder", "git"]),
  hostId: id,
});
const session = z.object({
  id,
  workspaceId: id,
  hostId: id,
  incarnation: id,
  command: z.string(),
  args: z.array(z.string()),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
  verdict: z.enum(["live", "unverifiable", "exited"]),
  exitCode: z.number().int().nullable(),
  createdAt: z.string(),
  // R16-I (coordinator-owned touch, see PR): the daemon always reports
  // `harnessId` (session-contract.ts) and the needs-input notification names
  // the harness from it; optional so older services still validate.
  harnessId: z.string().nullable().optional(),
  // R3-C: the daemon always reports these (session-contract.ts), but they
  // stay optional so a response from an older service without them still
  // validates; absent reads as `unknown` at the call sites.
  agentState: z.enum(["working", "idle", "needs_input", "exited", "unknown"]).optional(),
  agentStateAt: z.string().nullable().optional(),
  agentPromptPreview: z.string().max(2048).nullable().optional(),
  cacheIdleAt: z.string().nullable().optional(),
  // Sidebar lineage (#359): the daemon reports the orchestrator-spawned
  // parent when the spawn carried DROGON_SESSION_ID; optional so an older
  // service without the column still validates.
  parentSessionId: z.string().nullable().optional(),
  // Delegation attribution (monitor event id that caused the session):
  // optional so a response from an older service without the column still
  // validates; absent reads as "nobody delegated this session".
  causedByEventId: z.string().nullable().optional(),  // Session resume by identity (owner directive): the provider-native
  // conversation the harness itself reported, so a reopen names THAT one
  // (`claude --resume <id>`) instead of the most recent in the directory.
  // Additive/optional so a service without the columns still validates;
  // absent and null both read as "no recorded identity".
  agentSessionId: z.string().max(512).nullable().optional(),
  agentSessionTranscriptPath: z.string().max(4096).nullable().optional(),
  // `harness.start` replies only: how a resume request actually landed.
  agentResume: z.enum(["resumed", "continued", "fresh"]).optional(),
});
const cursor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const harness = z
  .object({
    harnessId: id,
    displayName: z.string().min(1).max(128),
    availability: z.enum(["available", "missing", "unsupported_launcher"]),
    executable: z
      .string()
      .min(1)
      .max(32768)
      .refine((value) => !value.includes("\0"))
      .nullable(),
  })
  .refine((value) =>
    value.availability === "missing"
      ? value.executable === null
      : value.executable !== null &&
        (/^\//.test(value.executable) ||
          /^[a-z]:[\\/]/i.test(value.executable) ||
          /^\\\\[^\\]/.test(value.executable)),
  );
const supportedHarnessIds = new Set([
  "claude",
  "pi",
  "opencode",
  "antigravity",
  "codex",
]);
export const resultSchemas: Record<string, z.ZodType> = {
  ...automationResultSchemas,
  ...fileResultSchemas,
  status: z.object({
    hostId: id,
    serviceInstanceId: id,
    protocol: z.literal(1),
    capabilities: z.array(z.string()),
    version: z.string(),
    // Install-resilience P4/P5 (additive): an older daemon replies without
    // either field — still a valid status, with identity simply unknown.
    featureProtocol: z.number().int().optional(),
    daemonArtifactSha256: z.string().nullable().optional(),
  }),
  "workspace.register": workspace,
  "workspace.list": z.object({ workspaces: z.array(workspace) }),
  // R16-BC (additive): Ports-panel "Stop Process" domain outcome (fork
  // WorkspacePortKillResult shape; the shared schema is the single source).
  "ports.kill": workspacePortKillResultSchema,
  "session.start": session,
  "session.list": z.object({ sessions: z.array(session) }),
  "session.read": z
    .object({
      session,
      dataBase64: z
        .string()
        .max(87384)
        .regex(
          /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        ),
      startCursor: cursor,
      nextCursor: cursor,
      truncated: z.boolean(),
    })
    .refine((value) => value.nextCursor >= value.startCursor),
  "session.write": z.object({ acceptedBytes: z.number().int().nonnegative() }),
  "session.resize": session,
  "session.stop": session,
  "session.close": session,
  "session.forget": session,
  "harness.list": z
    .object({ hostId: id, harnesses: z.array(harness) })
    .transform((value) => ({
      ...value,
      // A future host adapter must not disable known adapters in an older client.
      harnesses: value.harnesses.filter((item) =>
        supportedHarnessIds.has(item.harnessId),
      ),
    })),
  "harness.models": z.object({
    hostId: id,
    catalog: z.object({
      harness: z.enum([...supportedHarnessIds] as [string, ...string[]]),
      availability: z.enum(["available", "missing", "unsupported_launcher"]),
      executable: z.string().max(32768).nullable(),
      provenance: z
        .object({
          executable: z.string().max(32768),
          argv: z.array(z.string().max(256)),
          version: z.string().max(256).nullable(),
          probedAtEpochMs: z.number().int().nonnegative(),
          configScope: z.string().max(512),
        })
        .nullable(),
      entries: z
        .array(
          z.object({
            provider: z.string().max(256).nullable(),
            id: z.string().min(1).max(4096),
            context: z.string().max(256).nullable(),
            maxOutput: z.string().max(256).nullable(),
            thinking: z.boolean().nullable(),
            images: z.boolean().nullable(),
          }),
        )
        .max(10000),
      status: z.enum([
        "enumerated",
        "not_installed",
        "unsupported_surface",
        "unsupported_platform",
        "parse_failed",
        "timed_out",
        "probe_failed",
        "isolation_failed",
      ]),
      note: z.string().max(8192).nullable(),
      retainedRoots: z.array(z.string().max(32768)).max(100),
    }),
  }),
  "harness.start": session,
  "agent.settings": agentSettingsResultSchema,
  "agent.settings_update": agentSettingsResultSchema,
  // Meetings (additive): the read-only Write That Down index. Every daemon
  // reply passes through here before the bridge sees it, so the page's
  // honest states (named folder, named failures, read-only) are enforced on
  // the wire, not only in the renderer.
  "meeting.list": meetingsPageSchema,
  "meeting.read": meetingReadSchema,
  // The working half: the local-model answer (already verified against the
  // note by the daemon) and the commitment ledger. Adding them here is what
  // makes the honest-shape rules hold at the socket, not just in the
  // renderer: an analysis whose suggestion has no line, or a commitment that
  // is open and resolved at once, never crosses this boundary.
  "meeting.analyze": meetingAnalysisSchema,
  "meeting.commitment_list": meetingCommitmentPageSchema,
  "meeting.commitment_create": meetingCommitmentSchema,
  "meeting.commitment_update": meetingCommitmentSchema,
};
