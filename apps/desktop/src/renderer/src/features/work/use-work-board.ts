// Loads the Work board and keeps it fresh while the page is shown: a poll
// (sessions change state on their own) plus an immediate reload after every
// mutation. Mutations return the daemon's error message for the page to show.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Result } from "../../../../shared/session-contract";
import type { WorkBoard, WorkBridge } from "../../../../shared/work-contract";

export const WORK_POLL_MS = 4000;

export type WorkBoardState = {
  board: WorkBoard | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Runs a bridge call, reloads, and resolves to its result or error text. */
  run: <T>(call: () => Promise<Result<T>>) => Promise<{ ok: true; value: T } | { ok: false; error: string }>;
};

export function useWorkBoard(bridge: WorkBridge | null, active: boolean): WorkBoardState {
  const [board, setBoard] = useState<WorkBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    if (!bridge) {
      setError("This Drogon build has no Work bridge.");
      setLoading(false);
      return;
    }
    const mine = ++generation.current;
    try {
      const result = await bridge.board();
      if (mine !== generation.current) return;
      if (result.ok) {
        setBoard(result.result);
        setError(null);
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      if (mine === generation.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    if (!active) return;
    void reload();
    const timer = setInterval(() => void reload(), WORK_POLL_MS);
    return () => clearInterval(timer);
  }, [active, reload]);

  const run = useCallback(
    async <T,>(call: () => Promise<Result<T>>) => {
      try {
        const result = await call();
        await reload();
        return result.ok
          ? ({ ok: true, value: result.result } as const)
          : ({ ok: false, error: result.error.message } as const);
      } catch (err) {
        await reload();
        return { ok: false, error: err instanceof Error ? err.message : String(err) } as const;
      }
    },
    [reload],
  );

  return { board, error, loading, reload, run };
}
