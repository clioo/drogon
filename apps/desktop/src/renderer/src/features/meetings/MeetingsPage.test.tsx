// @vitest-environment jsdom
/* MIT Copyright (c) 2026 Lovecast Inc.
   Meetings page: the honest states, the bounded list, and the read-only
   reader, driven through the real components against a fake bridge. The
   bridge is the only seam (it is the granted `window.drogon.meetings`
   namespace); the availability taxonomy, the paging arithmetic and the
   reader all run for real. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MeetingRead, MeetingsBridge } from "../../../../shared/meetings-contract";
import {
  OLDER_NOTE_ID,
  NOTE_ID,
  availability,
  bridgeFor as fixturesBridge,
  commitment,
  commitmentPage,
  page,
  transcript,
} from "./meetings-test-fixtures";
import MeetingsPage, { type MeetingsPageProps } from "./MeetingsPage";
import { TooltipProvider } from "../../components/ui/tooltip";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";

beforeEach(installRadixJsdomStubs);

/** The bridge every honest-state test drives, with per-test overrides. */
function bridgeFor(
  value: ReturnType<typeof page>,
  read: (input: { id: string }) => MeetingRead | Error = () => ({
    meeting: transcript(),
    content:
      "# Weekly sync\n**Date:** 2026-09-10 08:05\n\n## Transcript\n\n[00:00] hola desde la reunion de hoy\n",
    size: 100,
    truncated: false,
  }),
): MeetingsBridge {
  return fixturesBridge({
    list: vi.fn(async () => ({ ok: true as const, result: value })),
    read: vi.fn(async (input) => {
      const result = read(input);
      return result instanceof Error
        ? {
            ok: false as const,
            error: { code: "meeting_missing", message: result.message, retryable: false },
          }
        : { ok: true as const, result };
    }),
  });
}

afterEach(cleanup);

/**
 * Drives a Radix `Select` the way the product's other tests do: click the
 * trigger, then the option by its label.
 */
async function chooseOption(trigger: HTMLElement, option: string): Promise<void> {
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

/** App owns the single Tooltip.Provider in production; tests mount one. */
function renderPage(props: MeetingsPageProps) {
  return render(
    <TooltipProvider>
      <MeetingsPage {...props} />
    </TooltipProvider>,
  );
}

const plainRenderer = (read: MeetingRead): React.ReactNode => (
  <pre>{read.content}</pre>
);

describe("Meetings page honest states", () => {
  it("names the tool as not installed instead of showing an empty list", async () => {
    const bridge = bridgeFor(
      page({
        availability: {
          ...availability(),
          status: "unavailable",
          reason: "not-installed",
          installation: "not-installed",
        },
        meetings: [],
        total: 0,
      }),
    );
    const openSetup = vi.fn();
    renderPage({bridge: bridge, openSetupUrl: openSetup});
    expect(await screen.findByText("Write That Down is not installed")).toBeTruthy();
    // Never the "you have had no meetings" copy.
    expect(screen.queryByText("No transcript artifacts found")).toBeNull();
    expect(screen.getByText("No transcripts could be read")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /View setup/ }));
    expect(openSetup).toHaveBeenCalledWith(
      "https://github.com/clioo/write-that-down-patrick",
    );
  });

  it("names the missing notes folder", async () => {
    const bridge = bridgeFor(
      page({
        availability: {
          ...availability(),
          status: "unavailable",
          reason: "transcript-root-missing",
          transcriptRootState: "missing",
        },
        meetings: [],
        total: 0,
      }),
    );
    renderPage({bridge: bridge});
    expect(await screen.findByText("Notes folder not found")).toBeTruthy();
    // The path is named, and the folder's provenance/state with it.
    expect(screen.getAllByText(/\/home\/carlos\/Transcripts/).length).toBeGreaterThan(0);
    expect(screen.getByText(/folder missing · read-only/)).toBeTruthy();
  });

  it("says the folder is empty only when the folder really is empty", async () => {
    const bridge = bridgeFor(
      page({
        availability: { ...availability(), reason: "empty" },
        meetings: [],
        total: 0,
      }),
    );
    renderPage({bridge: bridge});
    expect(await screen.findByText("No transcript artifacts found")).toBeTruthy();
    expect(screen.getByText(/is readable and holds no Write That Down transcripts/)).toBeTruthy();
  });

  it("reports an unreadable bridge answer as a failure, never as zero meetings", async () => {
    const bridge: MeetingsBridge = fixturesBridge({
      list: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "unsupported_capability",
          message: "meetings.v1 capability is not advertised by the service",
          retryable: true,
        },
      })),
    });
    renderPage({bridge: bridge});
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("meetings.v1 capability is not advertised");
    expect(screen.queryByText("No transcript artifacts found")).toBeNull();
    // Never "0 transcripts": the folder was not read, so the header says so.
    expect(screen.getByText("Notes folder could not be read")).toBeTruthy();
  });

  it("reports a missing bridge namespace instead of an empty list", async () => {
    renderPage({bridge: null});
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("no meetings bridge");
    expect(screen.queryByText("No transcript artifacts found")).toBeNull();
  });

  it("names the file that failed to parse", async () => {
    const failed = transcript({
      id: "write-that-down:/home/carlos/Transcripts/2026-09-10/16-00_5min.md",
      title: "5min",
      fileName: "16-00_5min.md",
      relativePath: "2026-09-10/16-00_5min.md",
      status: "failed",
      durationMinutes: 5,
      failureReason: "malformed-transcript",
      excerpt: "",
    });
    renderPage({bridge: bridgeFor(page({ meetings: [failed], total: 1 }))});
    expect(await screen.findByText("Failed")).toBeTruthy();
    expect(screen.getByText(/could not be read safely \(malformed-transcript\)/)).toBeTruthy();
    expect(screen.getByText("16-00_5min.md")).toBeTruthy();
  });
});

describe("Meetings page list and reader", () => {
  it("lists the meetings newest first with date, duration and excerpt", async () => {
    const live = transcript({
      id: "write-that-down:/home/carlos/Transcripts/2026-09-10/15-30_recording_.md",
      title: "Design review",
      fileName: "15-30_recording_.md",
      relativePath: "2026-09-10/15-30_recording_.md",
      status: "recording",
      durationMinutes: null,
      excerpt: "[00:00] en vivo",
    });
    renderPage({ bridge: bridgeFor(page({ meetings: [live, transcript()], total: 2 })) });
    expect(await screen.findByText("Design review")).toBeTruthy();
    expect(screen.getByText("Recording")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("[00:00] hola desde la reunion de hoy")).toBeTruthy();
    expect(screen.getByText("2 transcripts · Write That Down")).toBeTruthy();
    expect(screen.getByText("Showing 1–2 of 2")).toBeTruthy();
  });

  it("opens a transcript and shows the note read-only, then goes back", async () => {
    const bridge = bridgeFor(page());
    renderPage({bridge: bridge, renderTranscript: plainRenderer});
    fireEvent.click(await screen.findByRole("button", { name: /Open transcript/ }));
    await waitFor(() =>
      expect(screen.getByText(/hola desde la reunion de hoy/)).toBeTruthy(),
    );
    expect(bridge.read).toHaveBeenCalledWith({
      id: "write-that-down:/home/carlos/Transcripts/2026-09-10/08-05_42min.md",
    });
    expect(screen.getByText("Read-only")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Back to meetings/ }));
    expect(await screen.findByText("Weekly sync")).toBeTruthy();
    expect(screen.queryByText("Read-only")).toBeNull();
  });

  it("keeps the row list visible and offers Retry when a read fails", async () => {
    const bridge = bridgeFor(page(), () => new Error("The transcript file is no longer there."));
    renderPage({bridge: bridge, renderTranscript: plainRenderer});
    fireEvent.click(await screen.findByRole("button", { name: /Open transcript/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The transcript file is no longer there.");
    expect(screen.queryByText("No transcript artifacts found")).toBeNull();
    // Retry re-issues the same read (the controller keeps the target id).
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(bridge.read).toHaveBeenCalledTimes(2));
  });

  it("pages the corpus one bounded page at a time and reports the scan budget", async () => {
    // 120 transcripts at 50 rows a page: the list region holds one page of
    // rows, never the whole corpus.
    const first = page({
      meetings: [transcript()],
      total: 120,
      hasMore: true,
      scanTruncated: true,
    });
    const second = page({
      meetings: [
        transcript({
          id: OLDER_NOTE_ID,
          title: "Yesterday retro",
          fileName: "09-00_12min.md",
          relativePath: "2026-09-09/09-00_12min.md",
          dateFolder: "2026-09-09",
          startedAt: "2026-09-09 09:00",
          durationMinutes: 12,
        }),
      ],
      total: 120,
      offset: 50,
      hasMore: true,
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, result: first })
      .mockResolvedValueOnce({ ok: true as const, result: second });
    renderPage({ bridge: fixturesBridge({ list }) });
    expect(await screen.findByText("Weekly sync")).toBeTruthy();
    expect(screen.getByText(/only partially indexed/)).toBeTruthy();
    expect(screen.getByText("Showing 1–1 of 120")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 1" }).getAttribute("aria-current")).toBe(
      "page",
    );

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Yesterday retro")).toBeTruthy();
    // The previous page is gone, not appended: bounded DOM, bounded reads.
    expect(screen.queryByText("Weekly sync")).toBeNull();
    expect(list).toHaveBeenLastCalledWith({ limit: 50, offset: 50 });
  });

  it("asks the daemon to search and filter instead of filtering one page", async () => {
    const list = vi.fn(async () => ({
      ok: true as const,
      result: page({
        meetings: [
          transcript({
            searched: true,
            matchCount: 2,
            matches: [
              { line: 7, text: "[00:00] we agreed to ship the budget report" },
              { line: 8, text: "[00:10] the budget slides are ready" },
            ],
          }),
        ],
        total: 1,
        searched: true,
        scanned: 327,
        filters: {
          query: "budget",
          from: "2026-09-01",
          to: null,
          minMinutes: null,
          maxMinutes: null,
        },
      }),
    }));
    renderPage({ bridge: fixturesBridge({ list }) });
    await screen.findByText("Weekly sync");

    fireEvent.change(screen.getByLabelText("Search transcripts"), {
      target: { value: "budget" },
    });
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: "budget", limit: 50 }),
      ),
    );
    // The matching transcript lines, with their numbers, are what the row
    // shows — not an excerpt the page guessed at.
    expect(
      await screen.findByText("[00:00] we agreed to ship the budget report"),
    ).toBeTruthy();
    expect(screen.getByText("line 7")).toBeTruthy();
    expect(screen.getByText("1 of the notes match · showing 1–1")).toBeTruthy();

    await chooseOption(screen.getByLabelText("Meeting duration"), "Over 60 min");
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ query: "budget", minMinutes: 61 }),
      ),
    );

    // A filter change starts the result set over rather than staying on page 4
    // of the previous result set: no offset is sent with the new filters.
    expect(list).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ offset: expect.anything() }),
    );

    // Search that matches nothing says the folder is readable and what it
    // actually read, never "no meetings".
    list.mockResolvedValue({
      ok: true as const,
      result: page({
        meetings: [],
        total: 0,
        searched: true,
        scanned: 327,
        filters: {
          query: "zzz",
          from: null,
          to: null,
          minMinutes: null,
          maxMinutes: null,
        },
      }),
    });
    fireEvent.change(screen.getByLabelText("Search transcripts"), {
      target: { value: "zzz" },
    });
    expect(await screen.findByText("No meeting matches this view")).toBeTruthy();
    expect(
      screen.getByText(/No transcript in .* matches this search\. 327 files were read/),
    ).toBeTruthy();
    expect(screen.queryByText("No transcript artifacts found")).toBeNull();
  });

  it("clears every filter back to the unfiltered corpus", async () => {
    const list = vi.fn(async () => ({ ok: true as const, result: page() }));
    renderPage({ bridge: fixturesBridge({ list }) });
    await screen.findByText("Weekly sync");
    fireEvent.change(screen.getByLabelText("Search transcripts"), {
      target: { value: "budget" },
    });
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ query: "budget" })),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Clear" }));
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ limit: 50 }),
    );
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("will not send a custom range it cannot mean", async () => {
    const list = vi.fn(async () => ({ ok: true as const, result: page() }));
    renderPage({ bridge: fixturesBridge({ list }) });
    await screen.findByText("Weekly sync");
    await chooseOption(screen.getByLabelText("Meeting date"), "Custom range…");
    fireEvent.change(await screen.findByLabelText("Meetings from date"), {
      target: { value: "2026-09-10" },
    });
    fireEvent.change(screen.getByLabelText("Meetings to date"), {
      target: { value: "2026-09-01" },
    });
    expect(
      await screen.findByText("The start date must not be after the end date."),
    ).toBeTruthy();
    // The reversed range never reaches the daemon.
    expect(list).not.toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-09-10", to: "2026-09-01" }),
    );
  });

  it("keeps the actions view honest about the service it is talking to", async () => {
    const bridge = fixturesBridge({
      list: vi.fn(async () => ({
        ok: true as const,
        result: page({
          availability: availability({
            analysis: {
              available: false,
              reason: "harness-missing",
              harness: "pi",
              provider: "dgx-spark",
              model: "qwen3.8-flash-next-nvidia-nvfp4",
              freeLocalModel: true,
            },
          }),
        }),
      })),
    });
    renderPage({ bridge });
    fireEvent.click(await screen.findByRole("button", { name: /Open transcript/ }));
    const button = await screen.findByRole("button", {
      name: /Suggest actions with the local model/,
    });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText(/Drogon could not find `pi` on this host's PATH/),
    ).toBeTruthy();
    expect(screen.getByText(/no paid provider is ever used/)).toBeTruthy();
  });

  it("shows the verified suggestions, the discarded ones, and accepts explicitly", async () => {
    const accept = vi.fn(async () => ({ ok: true as const, result: commitment() }));
    const bridge = fixturesBridge({ accept });
    renderPage({ bridge, renderTranscript: plainRenderer });
    fireEvent.click(await screen.findByRole("button", { name: /Open transcript/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Suggest actions with the local model/ }),
    );

    expect(await screen.findByText("Suggested from this transcript")).toBeTruthy();
    // Every finding carries the transcript line it came from.
    expect(screen.getByText("line 8")).toBeTruthy();
    expect(
      screen.getByText("[00:12] I will fix the flaky login test before the release."),
    ).toBeTruthy();
    // The invention is reported as discarded, with its reason, and is not in
    // the findings.
    expect(
      screen.getByText(/1 suggestion discarded because the quote was not found/),
    ).toBeTruthy();
    expect(screen.getByText(/Migrate the database — quote-not-found/)).toBeTruthy();
    // Nothing was recorded just by looking.
    expect(accept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Add to my actions/ }));
    await waitFor(() =>
      expect(accept).toHaveBeenCalledWith({
        meetingId: NOTE_ID,
        text: "Fix the flaky login test",
        quote: "[00:12] I will fix the flaky login test before the release.",
        owner: "Carlos",
        source: "suggested",
        confidence: "high",
      }),
    );
    expect(await screen.findByText(/Added to my actions: Fix the flaky login test/)).toBeTruthy();
  });

  it("reports a refused acceptance instead of showing the action as recorded", async () => {
    const accept = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "commitment_quote_not_found",
        message:
          "This commitment's quote (12 characters or more) is not in the transcript, so it was NOT recorded.",
        retryable: false,
      },
    }));
    const bridge = fixturesBridge({ accept });
    renderPage({ bridge, renderTranscript: plainRenderer });
    fireEvent.click(await screen.findByRole("button", { name: /Open transcript/ }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Suggest actions with the local model/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: /Add to my actions/ }));
    expect(await screen.findByText(/NOT recorded/)).toBeTruthy();
    expect(screen.queryByText(/Added to my actions/)).toBeNull();
  });

  it("lists accepted actions across the corpus and resolves them explicitly", async () => {
    const resolve = vi.fn(async () => ({
      ok: true as const,
      result: commitment({ status: "done", resolvedAt: "2026-09-11T11:00:00Z" }),
    }));
    const commitments = vi.fn(async () => ({
      ok: true as const,
      result: commitmentPage(),
    }));
    const bridge = fixturesBridge({ resolve, commitments });
    renderPage({ bridge });
    fireEvent.click(await screen.findByRole("tab", { name: /My actions/ }));

    expect(await screen.findByText("Fix the flaky login test")).toBeTruthy();
    // The row keeps the meeting it came from and the quote that supports it.
    expect(screen.getByText("Weekly sync")).toBeTruthy();
    expect(screen.getByText("line 8")).toBeTruthy();
    expect(
      screen.getByText("[00:12] I will fix the flaky login test before the release."),
    ).toBeTruthy();
    expect(screen.getByText(/1 action in this view · 1 still open/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Mark done/ }));
    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith({
        id: "commitment-1",
        status: "done",
      }),
    );
  });

  it("opens the transcript an action came from, for checking", async () => {
    const bridge = fixturesBridge({
      commitments: vi.fn(async () => ({
        ok: true as const,
        result: commitmentPage(),
      })),
    });
    renderPage({ bridge, renderTranscript: plainRenderer });
    fireEvent.click(await screen.findByRole("tab", { name: /My actions/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Open transcript/ }));
    await waitFor(() =>
      expect(bridge.read).toHaveBeenCalledWith({ id: NOTE_ID }),
    );
  });
});

describe("Meetings page chrome", () => {
  it("closes on Escape, unless an input owns the key", async () => {
    const onClose = vi.fn();
    renderPage({bridge: bridgeFor(page()), onClose: onClose});
    await screen.findByText("Weekly sync");
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("refreshes through the header control", async () => {
    const bridge = bridgeFor(page());
    renderPage({bridge: bridge});
    await screen.findByText("Weekly sync");
    fireEvent.click(screen.getByRole("button", { name: "Refresh meetings" }));
    await waitFor(() => expect(bridge.list).toHaveBeenCalledTimes(2));
  });
});
