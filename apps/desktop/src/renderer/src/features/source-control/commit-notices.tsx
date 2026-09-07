// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/right-sidebar/source-control/commit/commit-notices.tsx.
// Adapter: AI recovery, pull-policy and hosted-review notices have no MVP
// backend and are not ported; plain commit/remote/PR notices keep the
// source's ids, roles and classes.
import React from "react";
import { cn } from "./panel-class-names";

export type CommitNoticeTone = "muted" | "destructive";

export function CommitNotices({
  commitError,
  remoteActionError,
  prNotice,
  prUrl,
}: {
  commitError: string | null;
  remoteActionError: string | null;
  prNotice: { message: string; tone: CommitNoticeTone } | null;
  prUrl: string | null;
}): React.JSX.Element {
  return (
    <>
      {commitError ? (
        <p
          id="commit-area-error"
          role="alert"
          aria-live="polite"
          className="mt-1 text-[11px] text-destructive"
        >
          {commitError}
        </p>
      ) : null}
      {remoteActionError ? (
        <p
          id="commit-area-remote-error"
          role="alert"
          aria-live="polite"
          className="mt-1 text-[11px] text-destructive"
        >
          {remoteActionError}
        </p>
      ) : null}
      {prNotice && (
        <div
          id="commit-area-create-pr-intent"
          role={prNotice.tone === "destructive" ? "alert" : "status"}
          aria-live="polite"
          className={cn(
            "mt-1 flex min-w-0 items-center gap-1.5 text-[11px]",
            prNotice.tone === "destructive" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {/* Why: Create Review blockers carry recovery steps; truncating hides the action the user needs in a narrow sidebar. */}
          <span className="min-w-0 flex-1 break-words leading-4 [overflow-wrap:anywhere]">
            {prNotice.message}
          </span>
        </div>
      )}
      {prUrl && (
        <div className="mt-1 text-[11px]">
          <span className="text-muted-foreground">PR: </span>
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
          >
            {prUrl}
          </a>
        </div>
      )}
    </>
  );
}
