// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/renderer/src/components/meetings/
// MeetingsNotices.tsx. The notice box, the setup button and the error alert
// are the fork's; the folder line is additive so the resolved notes folder,
// where that answer came from and its state are always visible, even while
// the headline reason is something else.
import { AppWindow, ExternalLink, FolderOpen } from "lucide-react";
import { Button } from "../../components/ui/button";
import type { MeetingsPage } from "../../../../shared/meetings-contract";
import {
  WRITE_THAT_DOWN_SETUP_URL,
  meetingsAvailabilityCopy,
  meetingsFolderLine,
} from "./meetings-page-copy";

function Notice({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

export function MeetingsNotices({
  page,
  error,
  toolError,
  onOpenSetup,
  onOpenTool,
  onRevealNotes,
}: {
  page: MeetingsPage | null;
  error: string | null;
  /** A failed "open the tool" / "reveal the folder" attempt, said out loud. */
  toolError: string | null;
  onOpenSetup: () => void;
  onOpenTool: () => void;
  onRevealNotes: () => void;
}): React.JSX.Element {
  const availability = page ? meetingsAvailabilityCopy(page) : null;
  return (
    <div className="space-y-3">
      {page ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            className="min-w-0 truncate text-xs text-muted-foreground"
            title={meetingsFolderLine(page)}
          >
            {meetingsFolderLine(page)}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {page.availability.installationPath !== null ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                title="Write That Down opens in the menu bar; start the recording there. Drogon only reads the notes it writes."
                onClick={onOpenTool}
              >
                <AppWindow className="size-3.5" />
                Open Write That Down
              </Button>
            ) : null}
            {page.availability.transcriptRootState === "readable" ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                title="Show the resolved notes folder in Finder (Drogon never edits it)"
                onClick={onRevealNotes}
              >
                <FolderOpen className="size-3.5" />
                Reveal notes folder
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {toolError !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {toolError}
        </p>
      ) : null}
      {availability ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">{availability.title}</p>
              <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
                {availability.description}
              </p>
              {page &&
              (page.availability.reason === "transcript-root-missing" ||
                page.availability.reason === "transcript-root-unreadable") ? (
                <p className="mt-1 max-w-3xl break-all text-sm leading-5 text-foreground">
                  {page.availability.transcriptRoot}
                </p>
              ) : null}
            </div>
            {page?.availability.reason === "not-installed" ? (
              <Button size="sm" variant="outline" onClick={onOpenSetup}>
                <ExternalLink className="size-3.5" />
                View setup
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
