// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/renderer/src/components/meetings/
// MeetingsPage.tsx. Structure, classes, copy, landmarks and the loading /
// empty state shapes are verbatim (main > header, scroll area, the intro
// block, the notices, `<section aria-labelledby="meeting-list-title">`, the
// row list with `role="list"`/`listitem`, `divide-y` container).
// Adaptations, all data-layer or bounded-read driven: the per-row "Ask
// Drogon" harness input is not ported (see MeetingTranscriptRow), the list
// is paged with an explicit "Load more" row so a huge notes folder is never
// loaded at once, a scan-budget line reports when the index itself stopped
// early, and selecting a row shows the read-only reader in place of the
// list instead of mounting a workspace.
import { useCallback } from "react";
import { Button } from "../../components/ui/button";
import type {
  MeetingRead,
  MeetingsBridge,
  MeetingsPage as MeetingsPageData,
} from "../../../../shared/meetings-contract";
import { MeetingTranscriptReader } from "./MeetingTranscriptReader";
import { MeetingTranscriptRow } from "./MeetingTranscriptRow";
import { MeetingsNotices } from "./MeetingsNotices";
import { MeetingsPageHeader } from "./MeetingsPageHeader";
import { WRITE_THAT_DOWN_SETUP_URL, meetingsEmptyCopy } from "./meetings-page-copy";
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
  return (
    <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center">
      <p className="text-sm font-medium text-foreground">{copy.title}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
        {copy.description}
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

export default function MeetingsPage({
  bridge = null,
  onClose,
  hostSelector = MEETINGS_PAGE_HOST_SELECTOR,
  renderTranscript,
  openSetupUrl,
}: MeetingsPageProps = {}): React.JSX.Element {
  const controller = useMeetingsPageController({ bridge });
  const page = controller.page;
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

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <MeetingsPageHeader
        count={
          page && page.availability.transcriptRootState === "readable"
            ? page.total
            : null
        }
        loading={controller.loading}
        onClose={onClose}
        onRefresh={() => controller.load(0)}
      />
      <div className="flex-1 overflow-y-auto scrollbar-sleek">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-5 sm:p-7">
          <div>
            <h2 className="text-base font-semibold">Meeting transcripts</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Browse Write That Down&apos;s existing Markdown transcripts, newest first, and open
              one here. Drogon reads these notes only — it never edits, moves or deletes them.
            </p>
          </div>

          <MeetingsNotices
            page={page}
            error={controller.error}
            onOpenSetup={openSetup}
          />

          {reading ? (
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
          ) : (
            <section aria-labelledby="meeting-list-title" className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 id="meeting-list-title" className="text-sm font-semibold">
                    Meetings
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Newest first. Opening a meeting shows the note exactly as it was saved.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {page
                    ? `Showing ${page.meetings.length} of ${page.total}`
                    : "Notes folder not read"}
                </p>
              </div>

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

              {page?.hasMore ? (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={controller.loading}
                    onClick={controller.loadMore}
                  >
                    Load more meetings
                  </Button>
                </div>
              ) : null}
              {page?.scanTruncated ? (
                <p className="text-xs text-muted-foreground">
                  The notes folder was only partially indexed (the scan budget stopped the walk),
                  so this count is a lower bound.
                </p>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
