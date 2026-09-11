// MIT Copyright (c) 2026 Lovecast Inc.
// The read view for one meeting note. The fork had no in-page reader (it
// mounted a folder workspace and opened an editor tab); this is the
// data-layer adaptation described in MeetingTranscriptSurface. Header copy,
// controls and tokens follow the Meetings page's own row vocabulary
// (Button/Tooltip/ARIA from orca-drogon's meetings components).
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { MeetingRead } from "../../../../shared/meetings-contract";
import { MeetingTranscriptSurface } from "./MeetingTranscriptSurface";
import { meetingDurationLabel, meetingStatusLabel, meetingStatusVariant } from "./meetings-page-copy";

export function MeetingTranscriptReader({
  transcript,
  loading,
  error,
  onBack,
  onRetry,
  renderTranscript,
}: {
  transcript: MeetingRead | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  /** Test seam: replaces how the note is drawn, never whether it is drawn.
   *  The product path renders the real read-only editor surface. */
  renderTranscript?: (read: MeetingRead) => React.ReactNode;
}): React.JSX.Element {
  if (loading && !transcript) {
    return (
      <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Reading the transcript…
      </div>
    );
  }
  if (!transcript) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-3.5" />
            Back to meetings
          </Button>
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <p>{error}</p>
            <Button className="mt-2" size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw className="size-3.5" />
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  const meeting = transcript.meeting;
  return (
    <section aria-label={`Transcript ${meeting.title}`} className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-3.5" />
          Back to meetings
        </Button>
        <span className="truncate text-xs text-muted-foreground">{meeting.relativePath}</span>
        <Badge variant="secondary">Read-only</Badge>
      </div>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{meeting.title}</h3>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{meeting.startedAt ?? meeting.dateFolder}</span>
            <span aria-hidden>·</span>
            <span>{meetingDurationLabel(meeting.status, meeting.durationMinutes)}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{meeting.filePath}</span>
          </p>
        </div>
        <Badge variant={meetingStatusVariant(meeting.status)}>
          {meetingStatusLabel(meeting.status)}
        </Badge>
      </div>
      {transcript.truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the first {transcript.content.length} of {transcript.size} bytes.
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border">
        {renderTranscript ? (
          renderTranscript(transcript)
        ) : (
          <MeetingTranscriptSurface
            filePath={meeting.filePath}
            fileName={meeting.fileName}
            content={transcript.content}
          />
        )}
      </div>
    </section>
  );
}
