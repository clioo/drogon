// MIT Copyright (c) 2026 Lovecast Inc.
// The extraction hook: one call, one run, one answer. Kept separate from the
// list controller because a model run is minutes, not milliseconds, and its
// state must survive a re-render of the list.
import { useCallback, useRef, useState } from "react";
import type {
  MeetingAnalysis,
  MeetingsBridge,
} from "../../../../shared/meetings-contract";

export type MeetingAnalysisController = {
  analysis: MeetingAnalysis | null;
  /** The meeting the current answer belongs to, so the right panel shows it. */
  analysisMeetingId: string | null;
  loading: boolean;
  error: string | null;
  run: (id: string) => void;
  dismiss: () => void;
};

export function useMeetingAnalysis({
  bridge,
}: {
  bridge: MeetingsBridge | null;
}): MeetingAnalysisController {
  const [analysis, setAnalysis] = useState<MeetingAnalysis | null>(null);
  const [analysisMeetingId, setAnalysisMeetingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const run = useCallback(
    (id: string) => {
      if (!bridge || loading) return;
      const current = ++generation.current;
      setAnalysisMeetingId(id);
      setAnalysis(null);
      setError(null);
      setLoading(true);
      void bridge
        .analyze({ id })
        .then((result) => {
          if (current !== generation.current) return;
          if (!result.ok) {
            setError(result.error.message);
            return;
          }
          setAnalysis(result.result);
        })
        .catch((failure: unknown) => {
          if (current !== generation.current) return;
          setError(
            failure instanceof Error
              ? failure.message
              : "The local model could not be run.",
          );
        })
        .finally(() => {
          if (current === generation.current) setLoading(false);
        });
    },
    [bridge, loading],
  );

  const dismiss = useCallback(() => {
    generation.current += 1;
    setAnalysis(null);
    setAnalysisMeetingId(null);
    setError(null);
    setLoading(false);
  }, []);

  return { analysis, analysisMeetingId, loading, error, run, dismiss };
}
