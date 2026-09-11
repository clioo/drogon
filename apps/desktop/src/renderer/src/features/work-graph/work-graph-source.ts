// MIT Copyright (c) 2026 Lovecast Inc.
// The work graph's ONLY data seam: reading `<workspace>/.drogon/graph.json`
// through the workspace files bridge (`files.v1`). Phase 1 is READ-ONLY —
// this module exposes no write of any kind, and the pane's tests pin that
// (the bridge fake fails the test if `fileWrite` is ever called, and a
// source scan asserts no write call exists in features/work-graph).
//
// When the backend worker's graph RPC lands, THIS is the one module that
// swaps to it; the pane and tests above it stay stable.
//
// Live updates: the daemon mirrors run progress into the state half as it
// happens (the run mirror cadence landed in PR #441), so the pane polls —
// every second while any node the daemon marks `running`, every ten
// seconds otherwise, plus on window focus and on the explicit refresh
// button. A poll never renders a half answer: the previous graph stays up
// until the next read parses whole.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileBridge } from "../../../../shared/file-contract";
import {
  parseWorkGraphDocument,
  WORK_GRAPH_RELATIVE_PATH,
  type WorkGraphDocument,
} from "../../../../shared/work-graph-contract";

/** files.v1's hard per-read cap (`MAX_FILE_BYTES` in drogon-protocol). The
 *  graph store must keep the file under it — evidence belongs there as
 *  references and heads, not full streams. */
const MAX_GRAPH_BYTES = 65_536;

const ACTIVE_POLL_MS = 1_000;
const IDLE_POLL_MS = 10_000;

export type WorkGraphSource =
  | { kind: "loading" }
  | { kind: "missing"; message: string }
  | { kind: "read_error"; message: string }
  | { kind: "invalid"; message: string; detail?: string }
  | {
      kind: "loaded";
      document: WorkGraphDocument;
      /** Wall-clock time of the read that produced this document. */
      readAt: number;
      fileUpdatedAt: string | null;
    };

export type WorkGraphSourceOptions = {
  fileBridge: FileBridge | null;
  hostId: string | null;
  workspaceId: string;
  /** Set true while the pane is mounted AND visible. */
  enabled?: boolean;
};

function anyNodeRunning(document: WorkGraphDocument): boolean {
  return document.state.nodes.some((node) => node.status === "running");
}

/**
 * Reads the work graph and keeps it fresh. Returns the current source plus
 * `refresh` (manual reload) and `refreshing` (a read is in flight).
 */
export function useWorkGraphSource({
  fileBridge,
  hostId,
  workspaceId,
  enabled = true,
}: WorkGraphSourceOptions): {
  source: WorkGraphSource;
  refresh: () => void;
  refreshing: boolean;
} {
  const [source, setSource] = useState<WorkGraphSource>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const generation = useRef(0);

  const read = useCallback(async (): Promise<void> => {
    if (!fileBridge || !hostId || inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    const currentGeneration = ++generation.current;
    try {
      const result = await fileBridge.fileRead({
        hostId,
        workspaceId,
        path: WORK_GRAPH_RELATIVE_PATH,
        maxBytes: MAX_GRAPH_BYTES,
      });
      if (generation.current !== currentGeneration) return;
      if (!result.ok) {
        const code = result.error.code;
        const message = result.error.message;
        // A workspace with no work graph yet is a normal state, not an
        // error: the file appears when the daemon first observes work.
        if (code === "not_found" || /no such file|not found/i.test(message)) {
          setSource({
            kind: "missing",
            message: `No work graph at ${WORK_GRAPH_RELATIVE_PATH} yet.`,
          });
        } else {
          setSource({ kind: "read_error", message });
        }
        return;
      }
      const parsed = parseWorkGraphDocument(result.result.content);
      if (!parsed.ok) {
        setSource(
          parsed.failure.kind === "not_json"
            ? {
                kind: "invalid",
                message: `${WORK_GRAPH_RELATIVE_PATH} is not valid JSON.`,
                detail: parsed.failure.message,
              }
            : { kind: "invalid", message: parsed.failure.message },
        );
        return;
      }
      setSource({
        kind: "loaded",
        document: parsed.document,
        readAt: Date.now(),
        fileUpdatedAt: parsed.document.state.updatedAt,
      });
    } catch (error) {
      if (generation.current === currentGeneration) {
        setSource({
          kind: "read_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      inFlight.current = false;
      if (generation.current === currentGeneration) setRefreshing(false);
    }
  }, [fileBridge, hostId, workspaceId]);

  // Initial read + re-read when the bridge or workspace changes.
  useEffect(() => {
    if (!enabled) return;
    void read();
  }, [enabled, read]);

  // Live cadence: fast while the daemon reports a live process, slow
  // otherwise. Paused entirely when the pane is hidden or disabled.
  const running = source.kind === "loaded" && anyNodeRunning(source.document);
  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(
      () => void read(),
      running ? ACTIVE_POLL_MS : IDLE_POLL_MS,
    );
    return () => window.clearInterval(interval);
  }, [enabled, read, running]);

  // Focus refresh: switching back to the window shows the graph as of now.
  useEffect(() => {
    if (!enabled) return;
    const onFocus = (): void => {
      void read();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, read]);

  const refresh = useCallback((): void => {
    void read();
  }, [read]);

  return { source, refresh, refreshing };
}
