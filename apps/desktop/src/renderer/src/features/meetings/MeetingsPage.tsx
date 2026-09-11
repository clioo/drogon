// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/renderer/src/components/meetings/
// MeetingsPage.tsx. Structure, classes, copy, landmarks and the loading /
// empty state shapes are verbatim (main > header, scroll area, the intro
// block, the notices, `<section aria-labelledby="meeting-list-title">`, the
// row list with `role="list"`/`listitem`, `divide-y` container). It is a
// first-class page in the shell's left navigation, beside Bots / Tasks /
// Automations, exactly like the fork's.
//
// Adaptations, all data-layer or bounded-read driven:
//   * the per-row "Ask Drogon" harness input is not ported (the fork's Ask
//     mounted the notes folder as a writable workspace, which the read-only
//     boundary forbids); extraction is the local-model panel instead;
//   * the list is searched, date/duration filtered and paged through the
//     daemon, so a 327-transcript folder is never loaded to render one page;
//   * choosing a row shows the read-only reader in place of the list instead
//     of mounting a workspace;
//   * the page has a second view, "My actions", for the commitments ledger.
import { useCallback, useState } from "react";
import { Button } from "../../components/ui/button";
import { MessageSquareText, Sparkles } from "lucide-react";
import type {
  MeetingAnalysisStatus,
  MeetingRead,
  MeetingsBridge,
  MeetingsPage as MeetingsPageData,
} from "../../../../shared/meetings-contract";
import { MeetingActionsPanel } from "./MeetingActionsPanel";
import { MeetingAnalysisPanel, type AcceptInput } from "./MeetingAnalysisPanel";
import { MeetingTranscriptReader } from "./MeetingTranscriptReader";
import { MeetingTranscriptRow } from "./MeetingTranscriptRow";
import { MeetingsFilterBar } from "./MeetingsFilterBar";
import { MeetingsNotices } from "./MeetingsNotices";
import { MeetingsPageHeader } from "./MeetingsPageHeader";
import { MeetingsPagination } from "./MeetingsPagination";
import {
  WRITE_THAT_DOWN_SETUP_URL,
  meetingsAnalysisUnavailableCopy,
  meetingsEmptyCopy,
  meetingsNoResultsCopy,
  meetingsResultSummary,
} from "./meetings-page-copy";
import { isFilterApplied } from "./meetings-filters";
import { useMeetingAnalysis } from "./use-meeting-analysis";
import { useMeetingCommitments } from "./use-meeting-commitments";
import { useMeetingsPageController } from "./use-meetings-page-controller";
import { useMeetingsPageEscape } from "./use-meetings-page-escape";

export type MeetingsPageProps = {
  /** The granted `window.drogon.meetings` namespace. `null` (or absent)
   *  renders the honest "no bridge" failure, never an empty list. */
  bridge?: MeetingsBridge | null;
  onClose?: () => void;
  /** The keep-alive host element whose visibility decides Escape ownership. */
  hostSelector?: string;
  /** Test seam for the note surface (see MeetingTranscriptReader). */
  renderTranscript?: (read: MeetingRead) => React.ReactNode;
  /** Open the Write That Down setup page; injected so tests use no network. */
  openSetupUrl?: (url: string) => void;
};

type MeetingsView = "transcripts" | "actions";

function MeetingsLoadingState(): React.JSX.Element {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {[0, 1, 2].map((index) => (
        <div key={index} className="space-y-3 px-5 py-4" aria-hidden>
          <div className="h-4 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-64 max-w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-3 w-full animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      ))}
      <span className="sr-only" role="status">
        Loading meetings
      </span>
    </div>
  );
}

function MeetingsEmptyState({ page }: { page: MeetingsPageData }): React.JSX.Element {
  const copy = meetingsEmptyCopy(page);
  const filtered = page.availability.reason === "ready" && isFilterApplied(page);
  return (
    <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
      <p className="text-sm font-medium text-foreground">
        {filtered ? "No meeting matches this view" : copy.title}
      </p>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
        {filtered ? meetingsNoResultsCopy(page) : copy.description}
      </p>
    </div>
  );
}

export const MEETINGS_PAGE_HOST_TESTID = "meetings-page-host";
export const MEETINGS_PAGE_HOST_SELECTOR = `[data-testid="${MEETINGS_PAGE_HOST_TESTID}"]`;

function defaultOpenSetupUrl(url: string): void {
  const shell = (
    window as unknown as { drogon?: { shell?: { openExternal?: (value: string) => unknown } } }
  ).drogon?.shell;
  if (typeof shell?.openExternal !== "function") return;
  void shell.openExternal(url);
}

const UNAVAILABLE_ANALYSIS: MeetingAnalysisStatus = {
  available: false,
  reason: "harness-missing",
  harness: "pi",
  provider: "dgx-spark",
  model: "qwen3.8-flash-next-nvidia-nvfp4",
  freeLocalModel: true,
};

export default function MeetingsPage({
  bridge = null,
  onClose,
  hostSelector = MEETINGS_PAGE_HOST_SELECTOR,
  renderTranscript,
  openSetupUrl,
}: MeetingsPageProps = {}): React.JSX.Element {
  const controller = useMeetingsPageController({ bridge });
  const analysis = useMeetingAnalysis({ bridge });
  const commitments = useMeetingCommitments({ bridge });
  const [view, setView] = useState<MeetingsView>("transcripts");
  const page = controller.page;
  const analysisStatus = page?.availability.analysis ?? UNAVAILABLE_ANALYSIS;
  // A failed read keeps the reader on screen: dropping back to the list
  // would swallow the error and look like the click did nothing.
  const reading =
    controller.transcript !== null ||
    controller.transcriptLoading ||
    controller.transcriptError !== null;
  const openSetup = useCallback((): void => {
    if (openSetupUrl) {
      openSetupUrl(WRITE_THAT_DOWN_SETUP_URL);
      return;
    }
    defaultOpenSetupUrl(WRITE_THAT_DOWN_SETUP_URL);
  }, [openSetupUrl]);
  useMeetingsPageEscape({ onClose, hostSelector });

  const openFromLedger = useCallback(
    (meetingId: string) => {
      setView("transcripts");
      controller.openTranscript(meetingId);
    },
    [controller],
  );

  const accept = useCallback(
    (input: AcceptInput) => {
      const meetingId = analysis.analysis?.meeting.id;
      if (meetingId === undefined) return;
      commitments.accept({
        meetingId,
        text: input.suggestion.text,
        quote: input.suggestion.quote,
        ...(input.owner === null ? {} : { owner: input.owner }),
        source: "suggested",
        confidence: input.suggestion.confidence,
        line: input.suggestion.line,
      });
    },
    [analysis.analysis, commitments],
  );

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <MeetingsPageHeader
        count={
          page && page.availability.transcriptRootState === "readable"
            ? page.total
            : null
        }
        loading={controller.loading}
        filtered={page !== null && isFilterApplied(page)}
        onClose={onClose}
        onRefresh={controller.refresh}
      />
      <div className="flex-1 overflow-y-auto scrollbar-sleek">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5 sm:p-7">
          <div>
            <h2 className="text-base font-semibold">Meeting transcripts</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Search every Write That Down transcript Drogon can read, filter by date and
              length, and open one here. Drogon reads these notes only — it never edits,
              moves or deletes them.
            </p>
          </div>

          <MeetingsNotices page={page} error={controller.error} onOpenSetup={openSetup} />

          <div
            role="tablist"
            aria-label="Meetings views"
            className="flex items-center gap-1 border-b border-border/60"
          >
            {(
              [
                ["transcripts", "Transcripts"],
                ["actions", "My actions"],
              ] as Array<[MeetingsView, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`meetings-tab-${value}`}
                aria-selected={view === value}
                aria-controls="meetings-tab-panel"
                onClick={() => setView(value)}
                className={
                  view === value
                    ? "-mb-px border-b-2 border-foreground px-3 py-2 text-sm font-medium text-foreground"
                    : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                }
              >
                {label}
                {value === "actions" && commitments.page && commitments.page.open > 0
                  ? ` (${commitments.page.open})`
                  : ""}
              </button>
            ))}
          </div>

          <div id="meetings-tab-panel" role="tabpanel" aria-labelledby={`meetings-tab-${view}`}>
            {view === "actions" ? (
              <MeetingActionsPanel
                page={commitments.page}
                loading={commitments.loading}
                error={commitments.error}
                status={commitments.status}
                query={commitments.query}
                busyId={commitments.busyId}
                onStatusChange={commitments.setStatus}
                onQueryChange={commitments.setQuery}
                onRefresh={commitments.refresh}
                onOpenMeeting={openFromLedger}
                onResolve={commitments.resolve}
              />
            ) : reading ? (
              <div className="space-y-4">
                <MeetingTranscriptReader
                  transcript={controller.transcript}
                  loading={controller.transcriptLoading}
                  error={controller.transcriptError}
                  onBack={controller.closeTranscript}
                  onRetry={() => {
                    const id = controller.transcriptTargetId;
                    controller.closeTranscript();
                    if (id !== null) controller.openTranscript(id);
                  }}
                  {...(renderTranscript ? { renderTranscript } : {})}
                />
                {controller.transcript !== null &&
                controller.transcript.meeting.status !== "failed" ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={analysis.loading || !analysisStatus.available}
                        title={
                          analysisStatus.available
                            ? `Run the free local model (${analysisStatus.model}) once over this transcript`
                            : meetingsAnalysisUnavailableCopy(analysisStatus).description
                        }
                        onClick={() => analysis.run(controller.transcript!.meeting.id)}
                      >
                        <Sparkles className="size-3.5" />
                        Suggest actions with the local model
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        Read-only: suggests, never creates.
                      </span>
                    </div>
                    {analysis.analysis !== null ||
                    analysis.loading ||
                    analysis.error !== null ||
                    !analysisStatus.available ? (
                      <MeetingAnalysisPanel
                        analysis={
                          analysis.analysisMeetingId === controller.transcript.meeting.id
                            ? analysis.analysis
                            : null
                        }
                        status={analysisStatus}
                        loading={
                          analysis.loading &&
                          analysis.analysisMeetingId === controller.transcript.meeting.id
                        }
                        error={
                          analysis.analysisMeetingId === controller.transcript.meeting.id
                            ? analysis.error
                            : null
                        }
                        acceptingLine={commitments.acceptingLine}
                        acceptNotice={commitments.acceptNotice}
                        onAccept={accept}
                        onDismiss={analysis.dismiss}
                      />
                    ) : null}
                    {commitments.acceptError !== null ? (
                      <p role="alert" className="text-xs text-destructive">
                        {commitments.acceptError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <section aria-labelledby="meeting-list-title" className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 id="meeting-list-title" className="text-sm font-semibold">
                      Meetings
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Opening a meeting shows the note exactly as it was saved.
                    </p>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MessageSquareText className="size-3.5" aria-hidden />
                    {meetingsResultSummary(page)}
                  </p>
                </div>

                <MeetingsFilterBar
                  state={controller.filters}
                  loading={controller.loading}
                  onChange={controller.setFilters}
                  onClear={controller.clearFilters}
                />

                {controller.loading && page === null ? (
                  <MeetingsLoadingState />
                ) : page && page.meetings.length > 0 ? (
                  <div
                    role="list"
                    className="divide-y divide-border overflow-hidden rounded-lg border border-border"
                  >
                    {page.meetings.map((meeting) => (
                      <div role="listitem" key={meeting.id}>
                        <MeetingTranscriptRow
                          meeting={meeting}
                          busy={controller.busyTranscriptId !== null}
                          onOpen={(meeting) => controller.openTranscript(meeting.id)}
                        />
                      </div>
                    ))}
                  </div>
                ) : page ? (
                  <MeetingsEmptyState page={page} />
                ) : null}

                <MeetingsPagination
                  currentPage={controller.pageIndex}
                  totalPages={controller.totalPages}
                  loading={controller.loading}
                  onPageChange={controller.goToPage}
                />

                {page?.scanTruncated ? (
                  <p className="text-xs text-muted-foreground">
                    The notes folder was only partially indexed (the scan budget stopped the
                    walk), so this count is a lower bound.
                  </p>
                ) : null}
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
