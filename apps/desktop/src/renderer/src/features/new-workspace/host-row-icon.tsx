/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/host-row-icon.tsx and the local-host label from
   src/shared/execution-host.ts (getLocalExecutionHostLabel). Adapter: Drogon
   runs on the local machine only, so the only host id is "local". */
import React from "react";
import { Monitor, Server } from "lucide-react";

export const LOCAL_RUN_TARGET_HOST_ID = "local";

/** The source's getLocalExecutionHostLabel: plain-English per platform. */
export function getLocalRunTargetLabel(): string {
  if (typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")) {
    return "Local Mac";
  }
  if (typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")) {
    return "Local Windows";
  }
  return "Local computer";
}

/** The local machine isn't a server — a monitor glyph reads as "this computer". */
export function HostRowIcon({
  hostId,
  className,
}: {
  hostId: string;
  className?: string;
}): React.JSX.Element {
  const Icon = hostId === LOCAL_RUN_TARGET_HOST_ID ? Monitor : Server;
  return <Icon className={className ?? "size-3.5 shrink-0 text-muted-foreground"} />;
}
