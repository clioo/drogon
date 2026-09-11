// MIT Copyright (c) 2026 Lovecast Inc.
// The commitments ledger: what the owner accepted out of a meeting, across
// the WHOLE corpus. This is the answer a large archive makes possible ("what
// did I promise and never close?") and it is a different question from "list
// my transcripts", so it lives behind its own view in the page.
//
// Every row keeps the meeting it came from, the verbatim quote and the line
// number, so any entry can be checked against the note it came from. Closing
// one is explicit, and `done` and `dismissed` are different answers on
// purpose.
import { Check, FileText, LoaderCircle, X } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import type {
  MeetingCommitment,
  MeetingCommitmentPage,
  MeetingCommitmentStatus,
} from "../../../../shared/meetings-contract";
import { meetingCommitmentStatusLabel } from "./meetings-page-copy";

export type CommitmentStatusFilter = "all" | MeetingCommitmentStatus;
export const MEETINGS_ACTIONS_SEARCH_ID = "meetings-actions-search";

function CommitmentRow({
  commitment,
  busy,
  onOpenMeeting,
  onResolve,
}: {
  commitment: MeetingCommitment;
  busy: boolean;
  onOpenMeeting: (meetingId: string) => void;
  onResolve: (status: MeetingCommitmentStatus) => void;
}): React.JSX.Element {
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-foreground">{commitment.text}</p>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {commitment.owner ? <Badge variant="outline">{commitment.owner}</Badge> : null}
          <Badge
            variant={
              commitment.status === "open"
                ? "default"
                : commitment.status === "done"
                  ? "secondary"
                  : "outline"
            }
          >
            {meetingCommitmentStatusLabel(commitment.status)}
          </Badge>
        </div>
      </div>
      <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span>{commitment.meetingDate}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{commitment.meetingTitle}</span>
        <span aria-hidden>·</span>
        <span>
          {commitment.source === "suggested" ? "from a suggestion" : "written by you"}
        </span>
      </p>
      <p className="border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
        <span className="mr-1.5 font-mono text-[11px]">line {commitment.line}</span>
        {commitment.quote}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onOpenMeeting(commitment.meetingId)}
        >
          <FileText className="size-3.5" />
          Open transcript
        </Button>
        {commitment.status !== "done" ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            disabled={busy}
            onClick={() => onResolve("done")}
          >
            {busy ? (
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Check className="size-3.5" />
            )}
            Mark done
          </Button>
        ) : null}
        {commitment.status !== "dismissed" ? (
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            disabled={busy}
            onClick={() => onResolve("dismissed")}
          >
            <X className="size-3.5" />
            Dismiss
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function MeetingActionsPanel({
  page,
  loading,
  error,
  status,
  query,
  busyId,
  onStatusChange,
  onQueryChange,
  onRefresh,
  onOpenMeeting,
  onResolve,
}: {
  page: MeetingCommitmentPage | null;
  loading: boolean;
  error: string | null;
  status: CommitmentStatusFilter;
  query: string;
  busyId: string | null;
  onStatusChange: (status: CommitmentStatusFilter) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onOpenMeeting: (meetingId: string) => void;
  onResolve: (commitment: MeetingCommitment, status: MeetingCommitmentStatus) => void;
}): React.JSX.Element {
  return (
    <section aria-labelledby="meeting-actions-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="meeting-actions-title" className="text-sm font-semibold">
            My actions
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Commitments you accepted, with the line each one came from. Kept in Drogon&apos;s
            own file — the notes themselves are never changed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor={MEETINGS_ACTIONS_SEARCH_ID}
            className="sr-only"
          >
            Search actions
          </label>
          <Input
            id={MEETINGS_ACTIONS_SEARCH_ID}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search actions"
            className="h-8 w-[180px] rounded-md border-border/50 bg-muted/50 text-xs"
          />
          <Select
            value={status}
            onValueChange={(value) => onStatusChange(value as CommitmentStatusFilter)}
          >
            <SelectTrigger
              size="sm"
              aria-label="Action status"
              className="h-8 w-[140px] rounded-md border-border/50 bg-muted/50 text-xs font-medium shadow-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="done">Done</SelectItem>
              <SelectItem value="dismissed">Dismissed</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={loading} onClick={onRefresh}>
            Refresh
          </Button>
        </div>
      </div>

      {error !== null ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {loading && page === null ? (
        <div className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          Reading your actions…
        </div>
      ) : page && page.commitments.length > 0 ? (
        <ul
          role="list"
          className="divide-y divide-border overflow-hidden rounded-lg border border-border"
        >
          {page.commitments.map((commitment) => (
            <CommitmentRow
              key={commitment.id}
              commitment={commitment}
              busy={busyId === commitment.id}
              onOpenMeeting={onOpenMeeting}
              onResolve={(next) => onResolve(commitment, next)}
            />
          ))}
        </ul>
      ) : page ? (
        <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            {query.trim() !== "" || status !== "all"
              ? "No action matches this view"
              : "No actions accepted yet"}
          </p>
          <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
            Open a transcript and ask Drogon to suggest actions from it; whatever you accept
            lands here, with the line it came from.
          </p>
        </div>
      ) : null}

      {page !== null && page.commitments.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {page.total} action{page.total === 1 ? "" : "s"} in this view · {page.open} still
          open
          {page.hasMore
            ? ` · showing the first ${page.commitments.length}; narrow the search to see the rest`
            : ""}
        </p>
      ) : null}
    </section>
  );
}
