/* MIT Copyright (c) 2026 Lovecast Inc.
 * Quick open (⌘P) surface. Candidates come from the daemon's bounded
 * `files.search` (git-aware, `.gitignore`-honoring) with a fallback to
 * the `files.list` walk when an older host does not expose it; ranking,
 * dimming and recency follow the read-only reference
 * `src/renderer/src/components/quick-open-file-list.ts` and
 * `src/shared/quick-open-path-search.ts`. Enter opens the file in the
 * editor and reveals it in the Explorer through `onOpenFile`.
 */
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { Command } from "cmdk";
import type {
  FileBridge,
  FileSearchResult,
} from "../../../../shared/file-contract";
import type { Result } from "../../../../shared/session-contract";
import { collectWorkspaceFiles } from "../../components/command-palette/quick-open-matches";
import {
  applyQuickOpenRecency,
  getPreparedQuickOpenFiles,
  loadQuickOpenRecentFiles,
  QUICK_OPEN_RESULT_LIMIT,
  rankQuickOpenFiles,
  recordQuickOpenRecentFile,
  splitQuickOpenPath,
} from "./quick-open-search";

export interface QuickOpenProps {
  query: string;
  onQueryChange(query: string): void;
  onClose(): void;
  fileBridge: FileBridge;
  hostId: string | null;
  workspaceId: string;
  filesAvailable: boolean;
  onOpenFile(path: string): void;
}

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_LIMIT = 200;

function searchAvailable(
  bridge: FileBridge,
): bridge is FileBridge & {
  fileSearch: NonNullable<FileBridge["fileSearch"]>;
} {
  return typeof bridge.fileSearch === "function";
}

async function collectFallbackFiles(input: {
  bridge: FileBridge;
  hostId: string;
  workspaceId: string;
}): Promise<{ files: string[]; truncated: boolean }> {
  const result = await collectWorkspaceFiles({
    bridge: input.bridge,
    scope: { hostId: input.hostId, workspaceId: input.workspaceId },
  });
  return {
    files: result.files.map((file) => file.path),
    truncated: result.truncated,
  };
}

export function QuickOpen(props: QuickOpenProps) {
  const { query, onQueryChange, onClose, fileBridge, hostId, workspaceId, filesAvailable } =
    props;
  const [files, setFiles] = useState<string[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searchTruncated, setSearchTruncated] = useState(false);
  const generation = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // ⌘P must land in the search box even when the previously focused
  // surface (terminal, browser URL bar) reclaims focus after mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!filesAvailable || hostId === null || workspaceId === "") {
      setFiles([]);
      setSearchTruncated(false);
      setSearchError(
        filesAvailable
          ? "No workspace selected."
          : "Files unavailable: service does not advertise files.v1",
      );
      return;
    }
    const current = ++generation.current;
    setSearchError("");
    const timer = window.setTimeout(() => {
      setFiles(null);
      setSearchTruncated(false);
      const run = async (): Promise<{ files: string[]; truncated: boolean }> => {
        const live = propsRef.current;
        if (searchAvailable(live.fileBridge)) {
          const response: Result<FileSearchResult> = await live.fileBridge.fileSearch({
            hostId: live.hostId as string,
            workspaceId: live.workspaceId,
            query,
            limit: SEARCH_LIMIT,
          });
          if (!response.ok) throw new Error(response.error.message);
          return { files: response.result.files, truncated: response.result.truncated };
        }
        return collectFallbackFiles({
          bridge: live.fileBridge,
          hostId: live.hostId as string,
          workspaceId: live.workspaceId,
        });
      };
      void run().then(
        (result) => {
          if (generation.current !== current) return;
          setFiles(result.files);
          setSearchTruncated(result.truncated);
        },
        (failure: unknown) => {
          if (generation.current !== current) return;
          setFiles([]);
          setSearchError(
            failure instanceof Error ? failure.message : "Could not search files.",
          );
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [fileBridge, hostId, workspaceId, filesAvailable, query]);

  const recentPaths = useMemo(
    () =>
      workspaceId === ""
        ? []
        : loadQuickOpenRecentFiles(window.localStorage, workspaceId),
    // Re-read when the candidate set settles (an open records synchronously
    // below, so the next mount sees it; no live subscription needed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId, files],
  );

  const matches = useMemo(() => {
    if (files === null) return [];
    if (query.trim() === "") {
      // Empty query: natural filename order with recent files first.
      const ranked = rankQuickOpenFiles(
        "",
        getPreparedQuickOpenFiles(files),
        files.length,
      ).map((row) => row.path);
      return applyQuickOpenRecency(ranked, recentPaths)
        .slice(0, QUICK_OPEN_RESULT_LIMIT)
        .map((path) => ({ path, score: 0 }));
    }
    return rankQuickOpenFiles(
      query,
      getPreparedQuickOpenFiles(files),
      QUICK_OPEN_RESULT_LIMIT,
    );
  }, [files, recentPaths, query]);

  const openFile = (path: string) => {
    if (workspaceId !== "") {
      recordQuickOpenRecentFile(window.localStorage, workspaceId, path);
    }
    propsRef.current.onOpenFile(path);
    propsRef.current.onClose();
  };

  return (
    <div
      className="command-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Command
        label="Quick open"
        shouldFilter={false}
        className="command-palette quick-open"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <Command.Input
          ref={inputRef as Ref<HTMLInputElement>}
          autoFocus
          value={query}
          onValueChange={onQueryChange}
          placeholder="Type a file name…"
          className="command-palette-input"
          aria-label="Quick open"
        />
        <Command.List className="command-palette-list" aria-label="Matching files">
          {files === null ? (
            <div className="command-palette-empty" role="status">
              Searching files…
            </div>
          ) : searchError !== "" ? (
            <div className="command-palette-empty" role="alert">
              {searchError}
            </div>
          ) : matches.length === 0 ? (
            <Command.Empty className="command-palette-empty">
              {query.trim() === "" ? "No files in this workspace." : "No matching files."}
            </Command.Empty>
          ) : (
            <>
              {searchTruncated && (
                <div className="command-palette-overflow" role="status">
                  More files match — keep typing to narrow
                </div>
              )}
              {matches.map((match) => {
                const { dir, name } = splitQuickOpenPath(match.path);
                return (
                  <Command.Item
                    key={`file:${match.path}`}
                    value={`file:${match.path}`}
                    onSelect={() => openFile(match.path)}
                    className="jump-palette-item command-palette-row quick-open-row"
                  >
                    <span className="command-palette-label">{name}</span>
                    {dir !== "" && (
                      <span className="command-palette-path quick-open-dir">{dir}</span>
                    )}
                  </Command.Item>
                );
              })}
            </>
          )}
        </Command.List>
        <div className="command-palette-footer">
          <span>
            <kbd>Enter</kbd> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
          <span>
            <kbd>↑↓</kbd> Move
          </span>
        </div>
        <div aria-live="polite" className="sr-only">
          {files === null
            ? "Searching files"
            : `${matches.length} matching files${searchTruncated ? ", more available" : ""}`}
        </div>
      </Command>
    </div>
  );
}


