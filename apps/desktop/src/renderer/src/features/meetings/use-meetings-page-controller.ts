// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/renderer/src/components/meetings/
// use-meetings-page-controller.ts. Adaptations (data layer only): the fork
// loaded a snapshot that already contained every meeting and mounted a
// folder workspace to open one; this build pages through the daemon
// (`meeting.list`) and reads a single note (`meeting.read`) for the in-page
// read-only reader, so the controller owns paging and the read request too.
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MeetingRead,
  MeetingsBridge,
  MeetingsPage,
} from "../../../../shared/meetings-contract";

export type MeetingsPageControllerOptions = {
  bridge: MeetingsBridge | null;
  pageSize?: number;
};

export type MeetingsPageController = {
  page: MeetingsPage | null;
  loading: boolean;
  error: string | null;
  /** The note being read, or null while the list is showing. */
  transcript: MeetingRead | null;
  transcriptLoading: boolean;
  transcriptError: string | null;
  busyTranscriptId: string | null;
  /** The id the reader is for, kept across a failed read so Retry works. */
  transcriptTargetId: string | null;
  load: (offset?: number) => void;
  loadMore: () => void;
  openTranscript: (id: string) => void;
  closeTranscript: () => void;
};

/**
 * Loads one page of meetings. A missing bridge, a refused call or a
 * malformed answer all leave `page` null and set `error`, so the page shows
 * an explicit failure instead of an empty list that would read as "no
 * meetings".
 */
export function useMeetingsPageController({
  bridge,
  pageSize,
}: MeetingsPageControllerOptions): MeetingsPageController {
  const [page, setPage] = useState<MeetingsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<MeetingRead | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [busyTranscriptId, setBusyTranscriptId] = useState<string | null>(null);
  const [transcriptTargetId, setTranscriptTargetId] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const readGeneration = useRef(0);

  const load = useCallback(
    (offset = 0) => {
      const generation = ++loadGeneration.current;
      setLoading(true);
      setError(null);
      setTranscriptError(null);
      setTranscript(null);
      const request = bridge?.list({
        ...(pageSize === undefined ? {} : { limit: pageSize }),
        ...(offset === 0 ? {} : { offset }),
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
            failure instanceof Error
              ? failure.message
              : "The notes folder could not be read.",
          );
        })
        .finally(() => {
          if (generation === loadGeneration.current) setLoading(false);
        });
    },
    [bridge, pageSize],
  );

  useEffect(() => {
    load(0);
    return () => {
      loadGeneration.current += 1;
      readGeneration.current += 1;
    };
  }, [load]);

  const loadMore = useCallback(() => {
    if (!page || !page.hasMore || loading) return;
    const next = page.offset + page.meetings.length;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    const request = bridge?.list({
      ...(pageSize === undefined ? {} : { limit: pageSize }),
      offset: next,
    });
    if (!request) {
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
          setError(result.error.message);
          return;
        }
        setPage((current) =>
          current === null
            ? result.result
            : {
                ...result.result,
                // Keep one continuous list: the appended page's rows follow
                // the rows already shown, and the newest `availability`
                // answer wins.
                meetings: [...current.meetings, ...result.result.meetings],
                offset: current.offset,
              },
        );
      })
      .catch((failure: unknown) => {
        if (generation !== loadGeneration.current) return;
        setError(
          failure instanceof Error
            ? failure.message
            : "The notes folder could not be read.",
        );
      })
      .finally(() => {
        if (generation === loadGeneration.current) setLoading(false);
      });
  }, [bridge, loading, page, pageSize]);

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
            failure instanceof Error
              ? failure.message
              : "The transcript could not be read.",
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

  return {
    page,
    loading,
    error,
    transcript,
    transcriptLoading,
    transcriptError,
    busyTranscriptId,
    transcriptTargetId,
    load,
    loadMore,
    openTranscript,
    closeTranscript,
  };
}
