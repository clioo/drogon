// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/renderer/src/components/meetings/
// MeetingTranscriptRow.tsx. Row structure, classes, icons and copy are
// verbatim (title, date · duration · file name, status badge, two-line
// excerpt, the named failure line, the Open action). Adaptations: the
// fork's per-row "Ask Drogon" harness Q&A is not ported here — this task
// scopes Meetings to browse and read, and the fork's Ask mounts the notes
// root as a writable workspace, which the read-only boundary forbids — and
// the excerpt is rendered exactly as the daemon returned it instead of the
// fork's client-side slice, and a row a search produced also shows the
// transcript line the match came from (additive: the fork had no search).
import { FileText } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import type { MeetingTranscript } from "../../../../shared/meetings-contract";
import {
  meetingDurationLabel,
  meetingStatusLabel,
  meetingStatusVariant,
} from "./meetings-page-copy";

export function MeetingTranscriptRow({
  meeting,
  busy,
  onOpen,
}: {
  meeting: MeetingTranscript;
  busy: boolean;
  onOpen: (meeting: MeetingTranscript) => void;
}): React.JSX.Element {
  return (
    <article className="px-4 py-4 sm:px-5" aria-busy={busy || undefined}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-foreground">{meeting.title}</h3>
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{meeting.dateFolder}</span>
            <span aria-hidden>·</span>
            <span>{meetingDurationLabel(meeting.status, meeting.durationMinutes)}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{meeting.fileName}</span>
          </p>
        </div>
        <Badge variant={meetingStatusVariant(meeting.status)}>
          {meetingStatusLabel(meeting.status)}
        </Badge>
      </div>
      {meeting.searched && meeting.matches.length > 0 ? (
        <ul className="mt-3 space-y-1" aria-label="Matching transcript lines">
          {meeting.matches.map((hit) => (
            <li
              key={`${hit.line}-${hit.text}`}
              className="border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground"
            >
              <span className="mr-1.5 font-mono text-[11px]">line {hit.line}</span>
              {hit.text}
            </li>
          ))}
          {meeting.matchCount > meeting.matches.length ? (
            <li className="pl-3 text-xs text-muted-foreground">
              {meeting.matchCount} matches in this note
            </li>
          ) : null}
        </ul>
      ) : (
        <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">
          {meeting.excerpt || "No transcript text was saved yet."}
        </p>
      )}
      {meeting.status === "failed" ? (
        <p className="mt-2 text-xs text-destructive">
          This transcript could not be read safely
          {meeting.failureReason ? ` (${meeting.failureReason}).` : "."}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpen(meeting)}
          disabled={busy}
          aria-label={`Open transcript ${meeting.title}`}
        >
          <FileText className="size-3.5" />
          Open transcript
        </Button>
        <span className="text-xs text-muted-foreground">{meeting.relativePath}</span>
      </div>
    </article>
  );
}
