// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/renderer/src/components/meetings/
// use-meetings-page-controller.ts. Data-layer adaptations only: the fork
// loaded a snapshot that already contained every meeting and mounted a folder
// workspace to open one; this build pages and searches through the daemon
// (`meeting.list`, `meeting.read`), so the controller owns the filter state,
// the page cursor and the read request too.
//
// Two things are deliberate:
//   * A filter change resets the page cursor to 0. Filtering page 4 of the old
//     result set is meaningless, and a `total` that shrank under the cursor
//     would show an empty page for a corpus full of matches.
//   * A failed list request leaves `page` null and sets `error`, so the page
//     shows an explicit failure instead of "no meetings".
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MeetingFilters,
  MeetingRead,
  MeetingsBridge,
  MeetingsPage,
} from "../../../../shared/meetings-contract";
import {
  EMPTY_MEETINGS_FILTERS,
  type MeetingsFilterState,
  toListInput,
} from "./meetings-filters";

/** How long the search box waits before it asks the daemon. */
export const MEETINGS_SEARCH_DEBOUNCE_MS = 250;
export const MEETINGS_PAGE_SIZE = 50;

export type MeetingsPageControllerOptions = {
  bridge: MeetingsBridge | null;
  pageSize?: number;
  /** Injected so a test can drive "today" instead of the wall clock. */
  now?: () => Date;
  searchDebounceMs?: number;
};

export type MeetingsPageController = {
  page: MeetingsPage | null;
  loading: boolean;
  error: string | null;
  filters: MeetingsFilterState;
  /** The filters the request will carry, for the request-level assertions. */
  requestFilters: MeetingFilters;
  pageIndex: number;
  totalPages: number;
  setFilters: (next: Partial<MeetingsFilterState>) => void;
  clearFilters: () => void;
  goToPage: (page: number) => void;
  refresh: () => void;
  transcript: MeetingRead | null;
  transcriptLoading: boolean;
  transcriptError: string | null;
  busyTranscriptId: string | null;
  transcriptTargetId: string | null;
  openTranscript: (id: string) => void;
  closeTranscript: () => void;
};

export function useMeetingsPageController({
  bridge,
  pageSize = MEETINGS_PAGE_SIZE,
  now,
  searchDebounceMs = MEETINGS_SEARCH_DEBOUNCE_MS,
}: MeetingsPageControllerOptions): MeetingsPageController {
  const [page, setPage] = useState<MeetingsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<MeetingsFilterState>(EMPTY_MEETINGS_FILTERS);
  const [pageIndex, setPageIndex] = useState(0);
  const [transcript, setTranscript] = useState<MeetingRead | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [busyTranscriptId, setBusyTranscriptId] = useState<string | null>(null);
  const [transcriptTargetId, setTranscriptTargetId] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const readGeneration = useRef(0);
  const today = useMemo(() => (now ?? (() => new Date()))(), [now]);

  // The query is debounced on its own so typing does not ask the daemon for
  // every keystroke; the other filters apply immediately.
  const [debouncedQuery, setDebouncedQuery] = useState(filters.query);
  useEffect(() => {
    if (filters.query === debouncedQuery) return;
    const timer = setTimeout(() => setDebouncedQuery(filters.query), searchDebounceMs);
    return () => clearTimeout(timer);
  }, [filters.query, debouncedQuery, searchDebounceMs]);

  const requestFilters = useMemo<MeetingFilters>(
    () => toListInput({ ...filters, query: debouncedQuery }, today),
    [filters, debouncedQuery, today],
  );

  const load = useCallback(
    (index: number) => {
      const generation = ++loadGeneration.current;
      setLoading(true);
      setError(null);
      setTranscriptError(null);
      setTranscript(null);
      const request = bridge?.list({
        ...requestFilters,
        limit: pageSize,
        ...(index === 0 ? {} : { offset: index * pageSize }),
      });
      if (!request) {
        setPage(null);
        setError(
          "This Drogon build has no meetings bridge, so the notes folder could not be read.",
        );
        setLoading(false);
        return;
      }
      void request
        .then((result) => {
          if (generation !== loadGeneration.current) return;
          if (!result.ok) {
            setPage(null);
            setError(result.error.message);
            return;
          }
          setPage(result.result);
        })
        .catch((failure: unknown) => {
          if (generation !== loadGeneration.current) return;
          setPage(null);
          setError(
            failure instanceof Error ? failure.message : "The notes folder could not be read.",
          );
        })
        .finally(() => {
          if (generation === loadGeneration.current) setLoading(false);
        });
    },
    [bridge, pageSize, requestFilters],
  );

  useEffect(() => {
    load(pageIndex);
    return () => {
      loadGeneration.current += 1;
      readGeneration.current += 1;
    };
  }, [load, pageIndex]);

  const setFilters = useCallback((next: Partial<MeetingsFilterState>) => {
    setFiltersState((current) => ({ ...current, ...next }));
    // A filter change starts the result set over: see the module header.
    setPageIndex(0);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState(EMPTY_MEETINGS_FILTERS);
    setDebouncedQuery("");
    setPageIndex(0);
  }, []);

  const goToPage = useCallback((index: number) => {
    setPageIndex(Math.max(0, index));
  }, []);

  const refresh = useCallback(() => load(pageIndex), [load, pageIndex]);

  const openTranscript = useCallback(
    (id: string) => {
      if (!bridge || busyTranscriptId !== null) return;
      const generation = ++readGeneration.current;
      setTranscriptTargetId(id);
      setBusyTranscriptId(id);
      setTranscriptError(null);
      setTranscriptLoading(true);
      void bridge
        .read({ id })
        .then((result) => {
          if (generation !== readGeneration.current) return;
          if (!result.ok) {
            setTranscriptError(result.error.message);
            return;
          }
          setTranscript(result.result);
        })
        .catch((failure: unknown) => {
          if (generation !== readGeneration.current) return;
          setTranscriptError(
            failure instanceof Error ? failure.message : "The transcript could not be read.",
          );
        })
        .finally(() => {
          if (generation === readGeneration.current) {
            setTranscriptLoading(false);
            setBusyTranscriptId(null);
          }
        });
    },
    [bridge, busyTranscriptId],
  );

  const closeTranscript = useCallback(() => {
    readGeneration.current += 1;
    setTranscript(null);
    setTranscriptError(null);
    setTranscriptLoading(false);
    setBusyTranscriptId(null);
    setTranscriptTargetId(null);
  }, []);

  const totalPages =
    page === null ? 1 : Math.max(1, Math.ceil(page.total / pageSize));

  return {
    page,
    loading,
    error,
    filters,
    requestFilters,
    pageIndex,
    totalPages,
    setFilters,
    clearFilters,
    goToPage,
    refresh,
    transcript,
    transcriptLoading,
    transcriptError,
    busyTranscriptId,
    transcriptTargetId,
    openTranscript,
    closeTranscript,
  };
}
