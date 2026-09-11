// MIT Copyright (c) 2026 Lovecast Inc.
// The extraction panel. There is no equivalent in the reference fork: the
// fork's per-row "Ask Drogon" mounted the notes folder as a writable
// workspace, which this build's read-only boundary forbids, so Meetings grew
// its own local-model analysis instead.
//
// What the panel is careful about, because the model's answer is not evidence
// on its own:
//   * every finding shows the transcript line it came from, with that line's
//     number, exactly as the note holds it;
//   * anything verification refused is listed separately, with its reason, and
//     never appears as a finding;
//   * nothing is created here. Each action has to be accepted explicitly, and
//     the accepted commitment keeps the same quote.
import { useState } from "react";
import { Check, FileWarning, LoaderCircle, Sparkles } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type {
  MeetingAnalysis,
  MeetingAnalysisStatus,
  MeetingSuggestion,
} from "../../../../shared/meetings-contract";
import { meetingsAnalysisUnavailableCopy } from "./meetings-page-copy";

export type AcceptInput = {
  suggestion: MeetingSuggestion;
  owner: string | null;
};

function SuggestionList({
  title,
  emptyCopy,
  suggestions,
  acceptingLine,
  onAccept,
}: {
  title: string;
  emptyCopy: string;
  suggestions: MeetingSuggestion[];
  acceptingLine: number | null;
  onAccept: ((input: AcceptInput) => void) | null;
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {suggestions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyCopy}</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {suggestions.map((suggestion) => (
            <Suggestion
              key={`${suggestion.line}-${suggestion.text}`}
              suggestion={suggestion}
              accepting={acceptingLine === suggestion.line}
              onAccept={onAccept}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Suggestion({
  suggestion,
  accepting,
  onAccept,
}: {
  suggestion: MeetingSuggestion;
  accepting: boolean;
  onAccept: ((input: AcceptInput) => void) | null;
}): React.JSX.Element {
  const [owner, setOwner] = useState(suggestion.owner ?? "");
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-foreground">{suggestion.text}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {suggestion.due ? (
            <Badge variant="outline">due {suggestion.due}</Badge>
          ) : null}
          {suggestion.confidence === "low" ? (
            <Badge variant="outline" title="The model inferred this; the transcript does not state it directly.">
              uncertain
            </Badge>
          ) : null}
        </div>
      </div>
      <p className="border-l-2 border-border pl-3 text-xs leading-5 text-muted-foreground">
        <span className="mr-1.5 font-mono text-[11px]">line {suggestion.line}</span>
        {suggestion.quote}
      </p>
      {onAccept ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            placeholder="Owner (optional)"
            aria-label={`Owner for: ${suggestion.text}`}
            className="h-7 w-[180px] rounded-md border-border/50 bg-muted/40 text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={accepting}
            onClick={() =>
              onAccept({
                suggestion,
                owner: owner.trim() === "" ? null : owner.trim(),
              })
            }
          >
            {accepting ? (
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Check className="size-3.5" />
            )}
            Add to my actions
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function MeetingAnalysisPanel({
  analysis,
  status,
  loading,
  error,
  acceptingLine,
  acceptNotice,
  onAccept,
  onDismiss,
}: {
  analysis: MeetingAnalysis | null;
  status: MeetingAnalysisStatus;
  loading: boolean;
  error: string | null;
  acceptingLine: number | null;
  /** Set after an accept, so the confirmation is visible where it happened. */
  acceptNotice: string | null;
  onAccept: (input: AcceptInput) => void;
  onDismiss: () => void;
}): React.JSX.Element {
  if (!status.available) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="text-sm font-medium text-foreground">
          {meetingsAnalysisUnavailableCopy(status).title}
        </p>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-muted-foreground">
          {meetingsAnalysisUnavailableCopy(status).description}
        </p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
        Running the local model ({status.model}) once over this transcript…
      </div>
    );
  }
  if (error !== null) {
    return (
      <div
        role="alert"
        className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <p className="flex items-center gap-2 font-medium">
          <FileWarning className="size-4" />
          Nothing was extracted
        </p>
        <p className="leading-5">{error}</p>
      </div>
    );
  }
  if (analysis === null) return <></>;

  return (
    <section
      aria-label="Suggested actions"
      className="space-y-4 rounded-lg border border-border bg-card/40 px-4 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Sparkles className="size-3.5" aria-hidden />
            Suggested from this transcript
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {analysis.provider}/{analysis.model} · {analysis.durationMs} ms ·{" "}
            {analysis.transcriptChars} characters read
            {analysis.transcriptTruncated
              ? " (only the first part of the note was analysed)"
              : ""}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Nothing was created and the note was not changed. Every quote below was found
            verbatim in the transcript; a suggestion without one was discarded.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-xs" onClick={onDismiss}>
          Hide suggestions
        </Button>
      </div>

      {analysis.summary !== "" ? (
        <p className="text-sm leading-6 text-foreground">{analysis.summary}</p>
      ) : null}

      {acceptNotice !== null ? (
        <p role="status" className="text-xs text-muted-foreground">
          {acceptNotice}
        </p>
      ) : null}

      <SuggestionList
        title="Decisions"
        emptyCopy="The model found no decision the transcript says was made."
        suggestions={analysis.decisions}
        acceptingLine={null}
        onAccept={null}
      />
      <SuggestionList
        title="Actions"
        emptyCopy="The model found no commitment in this transcript."
        suggestions={analysis.actions}
        acceptingLine={acceptingLine}
        onAccept={onAccept}
      />
      <SuggestionList
        title="Open questions"
        emptyCopy="No open question was found."
        suggestions={analysis.openQuestions}
        acceptingLine={null}
        onAccept={null}
      />

      {analysis.discardedCount > 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-3">
          <p className="text-xs font-medium text-foreground">
            {analysis.discardedCount} suggestion
            {analysis.discardedCount === 1 ? "" : "s"} discarded because the quote was not
            found in the note.
          </p>
          <ul className="mt-1 space-y-0.5">
            {analysis.discarded.map((item) => (
              <li key={`${item.reason}-${item.text}`} className="text-xs text-muted-foreground">
                {item.text === "" ? "(no text)" : item.text} — {item.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
