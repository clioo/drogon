// MIT Copyright (c) 2026 Lovecast Inc.
// The work graph's status glyph, shared by the read view and the authoring
// canvas: every icon corresponds to a status the daemon actually records.
// Unknown statuses get the neutral outline circle — never a decorative
// always-green check.

import { AlertCircle, CheckCircle2, Circle, CircleDashed, CircleHelp, Loader2 } from "lucide-react";
import { workGraphStatusToneClass } from "./work-graph-status";

export function WorkGraphStatusIcon({
  status,
}: {
  status: string | undefined | null;
}): React.JSX.Element {
  const className = `size-4 shrink-0 ${workGraphStatusToneClass(status)}`;
  if (status === "running")
    return (
      <Loader2
        className={`${className} animate-spin motion-reduce:animate-none`}
        aria-hidden
      />
    );
  if (status === "succeeded") return <CheckCircle2 className={className} aria-hidden />;
  if (status === "failed") return <AlertCircle className={className} aria-hidden />;
  if (status === "blocked") return <CircleDashed className={className} aria-hidden />;
  if (status === "unverifiable") return <CircleHelp className={className} aria-hidden />;
  // No record: the node was designed but never run (or an unknown status
  // this build does not know — either way, nothing is claimed).
  return <Circle className={className} aria-hidden />;
}
