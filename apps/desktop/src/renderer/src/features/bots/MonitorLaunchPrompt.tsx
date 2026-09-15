import { useState } from "react";
import type { Session } from "../../../../shared/session-contract";

/** Read the daemon's saved headless argv, never reconstruct from today's Bot
 *  settings. A monitor's firing and a `bot.run` chat turn are both headless
 *  launches with the prompt in argv; an interactive launch has none there. */
export function monitorLaunchPrompt(session: Session): string | null {
  const args = session.args;
  const last = args.at(-1);
  if (!last) return null;
  switch (session.harnessId) {
    case "pi":
      return args.includes("-p") ? args.find((arg) => arg.startsWith("Drogon task:\n")) ?? null : null;
    case "claude": {
      const delimiter = args.indexOf("--");
      return delimiter > 0 && args[delimiter - 1] === "-p" ? args[delimiter + 1] ?? null : null;
    }
    case "opencode":
      return args.includes("run") && args.includes("--model") ? last : null;
    case "codex":
      return args.includes("exec") ? last : null;
    case "antigravity":
      return args.at(-2) === "-p" ? last : null;
    default:
      return null;
  }
}

export function MonitorLaunchPrompt({ session }: { session: Session }) {
  const prompt = monitorLaunchPrompt(session);
  // A headless turn prints nothing until it ends, so while it works the
  // prompt IS what there is to read: open by default, closed once the
  // output is there. The viewer's own toggle wins afterwards.
  const [open, setOpen] = useState(session.verdict === "live");
  if (!session.causedByEventId && !prompt) return null;
  const systemIndex = session.args.indexOf("--append-system-prompt");
  const system = systemIndex >= 0 ? session.args[systemIndex + 1] : null;
  return (
    <details
      className="min-w-0 text-xs"
      data-testid="monitor-launch-prompt"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer rounded-sm py-1 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Launch prompt
      </summary>
      <p className="my-2 text-muted-foreground">
        {session.causedByEventId
          ? `Recorded launch argument for monitor event ${session.causedByEventId}.`
          : "Recorded launch argument of this headless turn."}{" "}
        Read-only; opening this does not run it again.
        {session.verdict === "live"
          ? " The harness prints its answer below when the turn ends."
          : ""}
      </p>
      {prompt ? (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs" data-testid="monitor-launch-prompt-text">{prompt}</pre>
      ) : (
        <p className="text-muted-foreground">The launch prompt is unavailable for this session.</p>
      )}
      {prompt && system ? <>
        <p className="my-2 font-medium">Additional system instructions</p>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">{system}</pre>
      </> : null}
    </details>
  );
}
