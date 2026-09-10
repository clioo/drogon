// MIT Copyright (c) 2026 Lovecast Inc.
// Live per-harness model catalog for the Mentu inspector's Model field.
// `window.drogon.harnessModels({ harnessId })` is the daemon-backed
// `harness.models` RPC (capability `harness.catalog.v1`): the daemon
// probes the harness's OWN enumeration command under credential-free
// isolation and reports exactly what it saw — entries, failures, empty
// answers and all. This hook invents nothing: no entry is ever added
// client-side, a failed call surfaces its error, and an answer is kept
// until an explicit refresh (staleness is derived from the probe
// timestamp and rendered, never hidden).

import { useCallback, useEffect, useState } from "react";
import type {
  HarnessId,
  HarnessModelsCatalog,
} from "../../../../shared/session-contract";

const HARNESS_IDS: readonly HarnessId[] = [
  "claude",
  "pi",
  "opencode",
  "antigravity",
  "codex",
];

/** True when the backend string names a Drogon-registered harness the
 *  daemon can probe. Anything else (shell, a Pi providers-map binding
 *  name, a runtime-owned backend) has no host catalog by construction. */
export function isRegisteredHarness(backend: string): backend is HarnessId {
  return HARNESS_IDS.includes(backend.trim().toLowerCase() as HarnessId);
}

export type ModelCatalogState = {
  /** The last real daemon answer; null until one arrives. Never a
   *  client-fabricated stand-in. */
  catalog: HarnessModelsCatalog | null;
  loading: boolean;
  error: string | null;
  /** Wall-clock time of the last successful load, for an honest "as of"
   *  readout; null before the first successful answer. */
  loadedAt: number | null;
  /** The harness the current state was loaded for (fetches are keyed on
   *  the harness; a harness switch resets state). */
  harness: HarnessId | null;
  refresh: () => void;
};

export function useMentuModelCatalog(harness: string): ModelCatalogState {
  const registered = isRegisteredHarness(harness);
  const target = (registered ? harness.trim().toLowerCase() : null) as
    | HarnessId
    | null;
  const [catalog, setCatalog] = useState<HarnessModelsCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [loadedHarness, setLoadedHarness] = useState<HarnessId | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!target) {
      // Unregistered backends never had a catalog; reset honestly instead
      // of showing a stale answer for a different harness.
      setCatalog(null);
      setLoadedAt(null);
      setLoadedHarness(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (
      typeof window === "undefined" ||
      !window.drogon?.harnessModels
    ) {
      setLoading(false);
      setError("Model catalog is unavailable in this desktop build.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.drogon.harnessModels({ harnessId: target }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setCatalog(result.result.catalog);
        setLoadedAt(Date.now());
        setLoadedHarness(target);
      } else {
        setCatalog(null);
        setLoadedAt(null);
        setLoadedHarness(null);
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
    // `generation` is a manual refresh trigger only; bumping it re-runs
    // the exact same fetch. A harness switch re-runs it via `target`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, generation]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  return {
    catalog: target && loadedHarness === target ? catalog : null,
    loading: loading && target !== null,
    error,
    loadedAt,
    harness: loadedHarness,
    refresh,
  };
}
