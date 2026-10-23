// MIT Copyright (c) 2026 Lovecast Inc.
// The commitment ledger hook: the corpus-wide view of what was accepted, and
// the only write path in Meetings. Accepting is explicit (the caller passes
// the suggestion and the quote it carried), and the daemon re-verifies the
// quote before storing anything — so a refused acceptance shows up here as an
// error and the ledger is reloaded rather than optimistically updated.
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MeetingCommitment,
  MeetingCommitmentPage,
  MeetingCommitmentStatus,
  MeetingCommitmentTracked,
  MeetingsBridge,
} from "../../../../shared/meetings-contract";
import { meetingsTrackFailureCopy } from "./meetings-page-copy";

export const MEETINGS_ACTIONS_DEBOUNCE_MS = 250;

/**
 * What the ledger says after tracking. `created: false` is a distinct answer:
 * the promise already had its ticket, and no second one was made.
 */
export function trackedNotice(tracked: MeetingCommitmentTracked): string {
  return tracked.created
    ? `Tracked as ${tracked.ticket.key} on the Drogon Work board.`
    : `${tracked.ticket.key} was already the Drogon task for this action.`;
}

export type MeetingCommitmentsController = {
  page: MeetingCommitmentPage | null;
  loading: boolean;
  error: string | null;
  status: "all" | MeetingCommitmentStatus;
  query: string;
  setStatus: (status: "all" | MeetingCommitmentStatus) => void;
  setQuery: (query: string) => void;
  busyId: string | null;
  acceptNotice: string | null;
  acceptError: string | null;
  acceptingLine: number | null;
  /** The commitment whose Work ticket is being created right now. */
  trackingId: string | null;
  /** Set after a track, naming the ticket the daemon created (or found). */
  trackNotice: string | null;
  trackError: string | null;
  accept: (input: {
    meetingId: string;
    text: string;
    quote: string;
    owner?: string;
    source: "suggested" | "owner";
    confidence?: "high" | "low";
    line: number;
  }) => void;
  resolve: (commitment: MeetingCommitment, status: MeetingCommitmentStatus) => void;
  /**
   * Turns one accepted commitment into a Drogon Work ticket. The daemon
   * re-verifies the quote first, so a refusal creates nothing and the ledger
   * is reloaded rather than optimistically marked tracked.
   */
  track: (commitment: MeetingCommitment) => void;
  refresh: () => void;
  clearNotices: () => void;
};

export function useMeetingCommitments({
  bridge,
  searchDebounceMs = MEETINGS_ACTIONS_DEBOUNCE_MS,
}: {
  bridge: MeetingsBridge | null;
  searchDebounceMs?: number;
}): MeetingCommitmentsController {
  const [page, setPage] = useState<MeetingCommitmentPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"all" | MeetingCommitmentStatus>("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [acceptNotice, setAcceptNotice] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [acceptingLine, setAcceptingLine] = useState<number | null>(null);
  const [trackingId, setTrackingId] = useState<string | null>(null);
  const [trackNotice, setTrackNotice] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    if (query === debouncedQuery) return;
    const timer = setTimeout(() => setDebouncedQuery(query), searchDebounceMs);
    return () => clearTimeout(timer);
  }, [query, debouncedQuery, searchDebounceMs]);

  const load = useCallback(() => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    const request = bridge?.commitments({
      ...(status === "all" ? {} : { status }),
      ...(debouncedQuery.trim() === "" ? {} : { query: debouncedQuery.trim() }),
      limit: 200,
    });
    if (!request) {
      setPage(null);
      setError(
        "This Drogon build has no meetings bridge, so your actions could not be read.",
      );
      setLoading(false);
      return;
    }
    void request
      .then((result) => {
        if (current !== generation.current) return;
        if (!result.ok) {
          setPage(null);
          setError(result.error.message);
          return;
        }
        setPage(result.result);
      })
      .catch((failure: unknown) => {
        if (current !== generation.current) return;
        setPage(null);
        setError(
          failure instanceof Error ? failure.message : "Your actions could not be read.",
        );
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
  }, [bridge, debouncedQuery, status]);

  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  const accept = useCallback<MeetingCommitmentsController["accept"]>(
    (input) => {
      if (!bridge || acceptingLine !== null) return;
      setAcceptingLine(input.line);
      setAcceptError(null);
      setAcceptNotice(null);
      void bridge
        .accept({
          meetingId: input.meetingId,
          text: input.text,
          quote: input.quote,
          ...(input.owner === undefined ? {} : { owner: input.owner }),
          source: input.source,
          ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
        })
        .then((result) => {
          if (!result.ok) {
            // A refused acceptance is the interesting case: the quote was not
            // found in the note, so nothing was stored.
            setAcceptError(result.error.message);
            return;
          }
          setAcceptNotice(
            `Added to my actions: ${result.result.text} — track it as a Drogon task from My actions.`,
          );
          load();
        })
        .catch((failure: unknown) => {
          setAcceptError(
            failure instanceof Error
              ? failure.message
              : "That action could not be recorded.",
          );
        })
        .finally(() => setAcceptingLine(null));
    },
    [acceptingLine, bridge, load],
  );

  const resolve = useCallback(
    (commitment: MeetingCommitment, next: MeetingCommitmentStatus) => {
      if (!bridge || busyId !== null) return;
      setBusyId(commitment.id);
      setError(null);
      void bridge
        .resolve({ id: commitment.id, status: next })
        .then((result) => {
          if (!result.ok) {
            setError(result.error.message);
            return;
          }
          load();
        })
        .catch((failure: unknown) => {
          setError(
            failure instanceof Error
              ? failure.message
              : "That action could not be updated.",
          );
        })
        .finally(() => setBusyId(null));
    },
    [bridge, busyId, load],
  );

  const track = useCallback(
    (commitment: MeetingCommitment) => {
      if (!bridge || trackingId !== null) return;
      setTrackingId(commitment.id);
      setTrackError(null);
      setTrackNotice(null);
      setAcceptError(null);
      void bridge
        .track({ id: commitment.id })
        .then((result) => {
          if (!result.ok) {
            setTrackError(meetingsTrackFailureCopy(result.error.code, result.error.message));
            return;
          }
          setTrackNotice(trackedNotice(result.result));
          load();
        })
        .catch((failure: unknown) => {
          setTrackError(
            failure instanceof Error
              ? failure.message
              : "That action could not be turned into a Drogon task.",
          );
        })
        .finally(() => setTrackingId(null));
    },
    [bridge, load, trackingId],
  );

  const clearNotices = useCallback(() => {
    setAcceptNotice(null);
    setAcceptError(null);
    setTrackNotice(null);
    setTrackError(null);
  }, []);

  return {
    page,
    loading,
    error,
    status,
    query,
    setStatus,
    setQuery,
    busyId,
    acceptNotice,
    acceptError,
    acceptingLine,
    trackingId,
    trackNotice,
    trackError,
    accept,
    resolve,
    track,
    refresh: load,
    clearNotices,
  };
}
