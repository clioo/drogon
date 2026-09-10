// MIT Copyright (c) 2026 Lovecast Inc.
// Real registered-harness catalog for the Mentu inspector's Harness /
// backend selector. `window.drogon.harnesses()` is the SAME daemon-backed
// bridge call (`harness.list`, capability `harness.catalog.v1`) already
// consumed by Settings -> Agents and the workspace composer's agent
// picker (`harness-capability.ts`, `NewWorkspaceComposer.tsx`) — never a
// Mentu-local guess. `Harness.availability` is carried verbatim
// (`available` / `missing` / `unsupported_launcher`); this module invents
// nothing when the call fails or a harness is absent, and never retries
// silently into a different answer.

import { useCallback, useEffect, useState } from "react";
import type { Harness } from "../../../../shared/session-contract";

export type HarnessCatalogState = {
  harnesses: Harness[];
  loading: boolean;
  error: string | null;
  /** Wall-clock time of the last successful load, for an honest "as of"
   *  readout; null before the first successful answer. */
  loadedAt: number | null;
  refresh: () => void;
};

export function useHarnessCatalog(): HarnessCatalogState {
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.drogon?.harnesses) {
      setLoading(false);
      setError("Harness catalog is unavailable in this desktop build.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.drogon.harnesses().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setHarnesses(result.result.harnesses);
        setLoadedAt(Date.now());
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
    // `generation` is a manual refresh trigger only; bumping it re-runs
    // the exact same fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  return { harnesses, loading, error, loadedAt, refresh };
}
