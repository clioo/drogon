// The Work board contract (`work.*`, capability work.v1): Drogon tickets on
// configurable columns, each column able to type a prompt into the sessions
// linked to its tickets (on enter, on a schedule, when the ticket's PR
// changes, or on demand). The daemon owns the data; this module is the
// renderer/main view of it and the zod shapes both sides validate.
import { z } from "zod";
import type { Result } from "./session-contract";

export const WORK_CAPABILITY = "work.v1";

export const WORK_COLUMN_ICONS = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "qa",
  "done",
  "blocked",
] as const;
export type WorkColumnIcon = (typeof WORK_COLUMN_ICONS)[number];

export const WORK_HARNESSES = ["claude", "codex", "opencode", "pi", "antigravity"] as const;

export type WorkRecipients = "all" | "primary";

export type WorkColumn = {
  id: string;
  name: string;
  icon: string;
  position: number;
  sendOnEnter: boolean;
  cron: string | null;
  prWatch: boolean;
  message: string;
  recipients: WorkRecipients;
  harnessId: string | null;
  nextRunAt: number | null;
  ticketCount: number;
  lastSentAt: number | null;
  lastSentCount: number;
};

/** A linked session as `session.list` reports it, or `{ id, missing }`. */
export type WorkSession = {
  id: string;
  missing?: boolean;
  workspaceId?: string;
  incarnation?: string;
  harnessId?: string | null;
  verdict?: string;
  agentState?: string | null;
  command?: string;
  [key: string]: unknown;
};

export type WorkDeliveryResult = {
  sessionId: string | null;
  action: "sent" | "resumed" | "started" | "skipped" | "failed";
  newSessionId?: string | null;
  error?: string;
  [key: string]: unknown;
};

export type WorkDelivery = {
  ticketId: string;
  ticketKey: string;
  columnId: string;
  trigger: string;
  message: string;
  results: WorkDeliveryResult[];
  at: number;
};

export type WorkSend = {
  id: number;
  columnId: string | null;
  ticketId: string;
  ticketKey: string | null;
  trigger: string;
  message: string;
  results: WorkDeliveryResult[];
  at: number;
};

export type WorkTicket = {
  id: string;
  key: string;
  title: string;
  description: string;
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  columnId: string;
  position: number;
  prUrl: string | null;
  prNumber: number | null;
  sourceUrl: string | null;
  nextStep: string;
  createdAt: number;
  updatedAt: number;
  sessions: WorkSession[];
  delivery?: WorkDelivery | null;
  sends?: WorkSend[];
};

export type WorkBoard = {
  columns: WorkColumn[];
  tickets: WorkTicket[];
  projects: { id: string; name: string }[];
};

export type WorkPreview = {
  columnId: string;
  previews: {
    ticketId: string;
    ticketKey: string;
    message: string;
    recipients: { sessionId: string | null; action: string; harnessId?: string | null }[];
  }[];
};

export type WorkSessionOpen = {
  action: "open" | "resumed" | "started";
  session: WorkSession;
};

export type WorkColumnUpdate = {
  columnId: string;
  name?: string;
  icon?: string;
  index?: number;
  sendOnEnter?: boolean;
  cron?: string | null;
  prWatch?: boolean;
  message?: string;
  recipients?: WorkRecipients;
  harnessId?: string | null;
};

export type WorkTicketCreate = {
  title: string;
  description?: string;
  projectId?: string;
  workspaceId?: string;
  columnId?: string;
  prUrl?: string;
  sourceUrl?: string;
  nextStep?: string;
  sessionIds?: string[];
};

export type WorkTicketUpdate = {
  ticketId: string;
  title?: string;
  description?: string;
  projectId?: string | null;
  workspaceId?: string | null;
  prUrl?: string | null;
  sourceUrl?: string | null;
  nextStep?: string;
};

export interface WorkBridge {
  board(input?: { projectId?: string }): Promise<Result<WorkBoard>>;
  ticketShow(input: { ticketId: string }): Promise<Result<WorkTicket>>;
  sends(input: { columnId?: string; ticketId?: string; limit?: number }): Promise<Result<{ sends: WorkSend[] }>>;
  preview(input: { columnId: string; ticketId?: string; message?: string }): Promise<Result<WorkPreview>>;
  columnCreate(input: { name: string; icon?: string; index?: number }): Promise<Result<WorkColumn>>;
  columnUpdate(input: WorkColumnUpdate): Promise<Result<WorkColumn>>;
  columnDelete(input: { columnId: string; moveTicketsTo?: string }): Promise<Result<{ deleted: string; movedTickets: number }>>;
  columnSend(input: { columnId: string; ticketId?: string; message?: string }): Promise<Result<{ columnId: string; sends: WorkDelivery[] }>>;
  ticketCreate(input: WorkTicketCreate): Promise<Result<WorkTicket>>;
  ticketUpdate(input: WorkTicketUpdate): Promise<Result<WorkTicket>>;
  ticketMove(input: { ticketId: string; columnId: string; index?: number }): Promise<Result<WorkTicket>>;
  ticketDelete(input: { ticketId: string }): Promise<Result<{ deleted: string; key: string }>>;
  linkSession(input: { ticketId: string; sessionId: string }): Promise<Result<WorkTicket>>;
  unlinkSession(input: { ticketId: string; sessionId: string }): Promise<Result<WorkTicket>>;
  sessionOpen(input: { ticketId: string; sessionId: string }): Promise<Result<WorkSessionOpen>>;
}

declare module "./session-contract" {
  interface DesktopBridge {
    /** Optional: an older bridge has no namespace and the page says so. */
    work?: WorkBridge;
  }
}

// ------------------------------------------------------------- schemas --

const sessionSchema = z.looseObject({ id: z.string() });
const resultSchema = z.looseObject({
  sessionId: z.string().nullable(),
  action: z.enum(["sent", "resumed", "started", "skipped", "failed"]),
});
const deliverySchema = z.looseObject({
  ticketId: z.string(),
  ticketKey: z.string(),
  columnId: z.string(),
  trigger: z.string(),
  message: z.string(),
  results: z.array(resultSchema),
  at: z.number(),
});
const sendSchema = z.looseObject({
  id: z.number(),
  columnId: z.string().nullable(),
  ticketId: z.string(),
  ticketKey: z.string().nullable(),
  trigger: z.string(),
  message: z.string(),
  results: z.array(resultSchema),
  at: z.number(),
});
export const workColumnSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  position: z.number(),
  sendOnEnter: z.boolean(),
  cron: z.string().nullable(),
  prWatch: z.boolean(),
  message: z.string(),
  recipients: z.enum(["all", "primary"]),
  harnessId: z.string().nullable(),
  nextRunAt: z.number().nullable(),
  ticketCount: z.number(),
  lastSentAt: z.number().nullable(),
  lastSentCount: z.number(),
});
export const workTicketSchema = z.looseObject({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  workspaceId: z.string().nullable(),
  columnId: z.string(),
  position: z.number(),
  prUrl: z.string().nullable(),
  prNumber: z.number().nullable(),
  sourceUrl: z.string().nullable(),
  nextStep: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  sessions: z.array(sessionSchema),
  delivery: deliverySchema.nullable().optional(),
  sends: z.array(sendSchema).optional(),
});
export const workBoardSchema = z.looseObject({
  columns: z.array(workColumnSchema),
  tickets: z.array(workTicketSchema),
  projects: z.array(z.looseObject({ id: z.string(), name: z.string() })),
});
export const workSendsSchema = z.looseObject({ sends: z.array(sendSchema) });
export const workPreviewSchema = z.looseObject({
  columnId: z.string(),
  previews: z.array(
    z.looseObject({
      ticketId: z.string(),
      ticketKey: z.string(),
      message: z.string(),
      recipients: z.array(z.looseObject({ sessionId: z.string().nullable(), action: z.string() })),
    }),
  ),
});
export const workColumnDeleteSchema = z.looseObject({ deleted: z.string(), movedTickets: z.number() });
export const workColumnSendSchema = z.looseObject({ columnId: z.string(), sends: z.array(deliverySchema) });
export const workTicketDeleteSchema = z.looseObject({ deleted: z.string(), key: z.string() });
export const workSessionOpenSchema = z.looseObject({
  action: z.enum(["open", "resumed", "started"]),
  session: sessionSchema,
});

/** One renderer request: an op the main bridge maps onto one daemon method. */
export const WORK_OPS = {
  board: { method: "work.board", schema: workBoardSchema },
  ticketShow: { method: "work.ticket_show", schema: workTicketSchema },
  sends: { method: "work.sends", schema: workSendsSchema },
  preview: { method: "work.column_preview", schema: workPreviewSchema },
  columnCreate: { method: "work.column_create", schema: workColumnSchema },
  columnUpdate: { method: "work.column_update", schema: workColumnSchema },
  columnDelete: { method: "work.column_delete", schema: workColumnDeleteSchema },
  columnSend: { method: "work.column_send", schema: workColumnSendSchema },
  ticketCreate: { method: "work.ticket_create", schema: workTicketSchema },
  ticketUpdate: { method: "work.ticket_update", schema: workTicketSchema },
  ticketMove: { method: "work.ticket_move", schema: workTicketSchema },
  ticketDelete: { method: "work.ticket_delete", schema: workTicketDeleteSchema },
  linkSession: { method: "work.ticket_link_session", schema: workTicketSchema },
  unlinkSession: { method: "work.ticket_unlink_session", schema: workTicketSchema },
  sessionOpen: { method: "work.session_open", schema: workSessionOpenSchema },
} as const;

export type WorkOp = keyof typeof WORK_OPS;

export const workRequestSchema = z.object({
  op: z.enum(Object.keys(WORK_OPS) as [WorkOp, ...WorkOp[]]),
  params: z.record(z.string(), z.unknown()).optional(),
});
