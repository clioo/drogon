import type { Harness, Session } from "../../shared/session-contract";

export function sessionLabel(session: Session, harnesses: Harness[]): string {
  const matches = harnesses.filter(
    (harness) =>
      harness.availability === "available" &&
      harness.executable === session.command,
  );
  return matches.length === 1
    ? matches[0].displayName
    : session.command.split(/[\\/]/).at(-1) || "Terminal";
}
