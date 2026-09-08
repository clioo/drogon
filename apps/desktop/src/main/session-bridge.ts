// Per-record `session.list` isolation (R16-AL, issue #222): one malformed
// record must never fail the whole list. The daemon keeps an exited
// session's last agent-state timestamp as history, and older rows can carry
// combinations a strict whole-list parse would reject — so each record is
// validated on its own against the session schema, valid records are kept,
// and every rejected record produces exactly one honest warning naming it.
import { resultSchemas } from "../shared/result-validation";
import type { Session } from "../shared/session-contract";

export type IsolatedSessionList = {
  sessions: Session[];
  warnings: string[];
};

const sessionSchema = resultSchemas["session.start"];

function recordId(entry: unknown, index: number): string {
  if (typeof entry === "object" && entry !== null && "id" in entry) {
    const id = (entry as { id: unknown }).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return `#${index}`;
}

export function isolateSessionList(result: unknown): IsolatedSessionList {
  if (
    typeof result !== "object" ||
    result === null ||
    !("sessions" in result) ||
    !Array.isArray((result as { sessions: unknown }).sessions)
  )
    return {
      sessions: [],
      warnings: ["session.list result has no sessions array"],
    };
  const entries = (result as { sessions: unknown[] }).sessions;
  const sessions: Session[] = [];
  const warnings: string[] = [];
  entries.forEach((entry, index) => {
    const parsed = sessionSchema.safeParse(entry);
    if (parsed.success) {
      sessions.push(parsed.data as Session);
      return;
    }
    const first = parsed.error.issues[0];
    warnings.push(
      `session ${recordId(entry, index)}: rejected (${first?.message ?? "invalid record"})`,
    );
  });
  return { sessions, warnings };
}
