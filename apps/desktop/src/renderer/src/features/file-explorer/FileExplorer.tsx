/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/right-sidebar/FileExplorer.tsx (composition:
   toolbar, name-filter strip, tree pane, background menu),
   useFileExplorerManualRefresh.ts (spinner-delay refresh state),
   useFileExplorerAutoReveal.ts (active-file reveal) and
   useFileExplorerKeys.ts (key ownership: explorer-scoped arrows/Enter/F2/
   Delete, editable-target opt-out). Adapted: no zustand store (props and
   local state), no search/Contents view (names filter only), no virtualizer
   (plain list — MVP workspaces are small), no drag/drop, import, undo/redo
   or watchers (poll on manual refresh only). */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Result } from "../../../../shared/session-contract";
import { FileExplorerToolbar } from "./FileExplorerToolbar";
import { FileExplorerNameFilter, FileExplorerQueryStrip } from "./FileExplorerNameFilter";
import { FileExplorerTreeStatus } from "./FileExplorerTreeStatus";
import { FileExplorerTreePane } from "./FileExplorerTreePane";
import { DeleteConfirmDialog, FileExplorerBackgroundMenu, FileExplorerRowMenu } from "./FileExplorerMenus";
import type { InlineInput } from "./InlineInputRow";
import {
  ancestorPaths,
  buildVisibleRows,
  formatPathsForClipboard,
  projectNameFilter,
  type ExplorerNode,
} from "./tree-model";
import { applyNavigation, type SelectionMode } from "./keyboard-navigation";
import {
  deleteConfirmationFor,
  validateInlineName,
  type ExplorerCapabilities,
  type RowMenuItemId,
} from "./explorer-policy";

/** Lazy backend surface the explorer touches — injected, never imported. */
export interface FileExplorerDataSource {
  listDir(path: string, includeHidden: boolean): Promise<Result<ExplorerNode[]>>;
  create?(
    parentDir: string,
    name: string,
    kind: "file" | "directory",
  ): Promise<Result<null>>;
  rename?(from: string, to: string): Promise<Result<null>>;
  remove?(paths: string[]): Promise<Result<null>>;
}

export interface FileExplorerProps {
  workspaceId: string;
  workspaceName: string;
  /** Filesystem root for absolute Copy Path items. */
  workspaceRoot?: string;
  source: FileExplorerDataSource | null;
  /** Open editor file: auto-revealed and highlighted on change. */
  activePath: string | null;
  onSelect?(node: ExplorerNode): void;
  /** Host opens a terminal rooted at the given workspace-relative dir. */
  onOpenTerminal?(cwd: string): void;
  /** Host closes editors whose files just disappeared. */
  onDeleted?(paths: string[]): void;
}

type BgMenu = { kind: "bg"; point: { x: number; y: number } };
type RowMenu = {
  kind: "row";
  point: { x: number; y: number };
  paths: string[];
};
type MenuState = BgMenu | RowMenu | null;

const REFRESH_SPINNER_DELAY_MS = 200;

function parentDirOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-ignore-file-explorer-keys="true"]')) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (target as HTMLElement).isContentEditable;
}

export function FileExplorer({
  workspaceId,
  workspaceName,
  workspaceRoot,
  source,
  activePath,
  onSelect,
  onOpenTerminal,
  onDeleted,
}: FileExplorerProps) {
  const [children, setChildren] = useState<Readonly<Record<string, readonly ExplorerNode[]>>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pendingDirs, setPendingDirs] = useState<ReadonlySet<string>>(new Set());
  const [rootError, setRootError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set());
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [fullCache, setFullCache] = useState<readonly ExplorerNode[] | null>(null);
  const [showDotfiles, setShowDotfiles] = useState(true);
  const [inline, setInline] = useState<{ input: InlineInput; error: string | null } | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [confirmDelete, setConfirmDelete] = useState<readonly ExplorerNode[] | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showRefreshSpinner, setShowRefreshSpinner] = useState(false);
  const [revealTick, setRevealTick] = useState(0);
  const [filterReloadTick, setFilterReloadTick] = useState(0);

  const generation = useRef(0);
  const filterGeneration = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const spinnerTimer = useRef<number | null>(null);
  const isRefreshingRef = useRef(false);
  const lastRevealed = useRef<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sourceRef = useRef(source);
  sourceRef.current = source;
  // Render-mirrors so callbacks can read the latest cache without taking
  // it as a dependency (and without side effects inside state updaters).
  const childrenRef = useRef(children);
  childrenRef.current = children;
  const inlineRef = useRef(inline);
  inlineRef.current = inline;
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const showDotfilesRef = useRef(showDotfiles);
  showDotfilesRef.current = showDotfiles;

  const hasFilter = filter.trim() !== "";
  const caps: ExplorerCapabilities = useMemo(
    () => ({
      // Optimistic by design: mutation UI stays interactive and a daemon
      // without files.create/rename/delete dispatch fails closed with an
      // explicit error surfaced inline (or in the delete dialog) — the
      // shape never depends on method-sniffing.
      canMutate: true,
      // No shell bridge exists in this repo: the item stays visible but
      // disabled with its reason, never a dead click.
      canReveal: false,
      canOpenTerminal: !!onOpenTerminal,
    }),
    [onOpenTerminal],
  );

  const settleRefresh = useCallback(() => {
    if (spinnerTimer.current) window.clearTimeout(spinnerTimer.current);
    spinnerTimer.current = null;
    isRefreshingRef.current = false;
    setShowRefreshSpinner(false);
    setIsRefreshing(false);
  }, []);

  const loadDir = useCallback(
    (dir: string, gen: number, includeHidden: boolean, onRootSettled?: () => void) => {
      const live = sourceRef.current;
      if (!live) return;
      setPendingDirs((prev) => new Set(prev).add(dir));
      void live.listDir(dir, includeHidden).then(
        (result) => {
          if (generation.current !== gen) return;
          setPendingDirs((prev) => {
            const next = new Set(prev);
            next.delete(dir);
            return next;
          });
          if (dir === "") onRootSettled?.();
          if (!result.ok) {
            if (dir === "") setRootError(result.error.message);
            else setActionError(result.error.message);
            return;
          }
          if (dir === "") setRootError(null);
          setChildren((prev) => ({ ...prev, [dir]: result.result }));
        },
        (failure: unknown) => {
          if (generation.current !== gen) return;
          setPendingDirs((prev) => {
            const next = new Set(prev);
            next.delete(dir);
            return next;
          });
          if (dir === "") onRootSettled?.();
          const message =
            failure instanceof Error ? failure.message : "The directory listing could not be read.";
          if (dir === "") setRootError(message);
          else setActionError(message);
        },
      );
    },
    [],
  );

  const reloadExpanded = useCallback(
    (gen: number, includeHidden: boolean, onRootSettled?: () => void) => {
      loadDir("", gen, includeHidden, onRootSettled);
      for (const dir of expandedRef.current) loadDir(dir, gen, includeHidden);
    },
    [loadDir],
  );

  const refreshAll = useCallback(() => {
    if (!sourceRef.current || isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    if (spinnerTimer.current) window.clearTimeout(spinnerTimer.current);
    // Local refreshes are usually instant: delay the spinner so fast
    // refreshes do not flicker (source: useFileExplorerManualRefresh).
    spinnerTimer.current = window.setTimeout(
      () => setShowRefreshSpinner(true),
      REFRESH_SPINNER_DELAY_MS,
    );
    const gen = ++generation.current;
    setChildren({});
    setFilterError(null);
    setRootError(null);
    // A live filter re-runs against the fresh tree through filterReloadTick.
    setFilterReloadTick((tick) => tick + 1);
    reloadExpanded(gen, showDotfilesRef.current, settleRefresh);
  }, [reloadExpanded, settleRefresh]);

  // Workspace/source switch: drop every cached scope (children, expansion,
  // selection, filter) so another workspace's listing can never leak in.
  useEffect(() => {
    generation.current += 1;
    const gen = generation.current;
    setChildren({});
    setExpanded(new Set());
    setPendingDirs(new Set());
    setRootError(null);
    setActionError(null);
    setSelectedPaths(new Set());
    setAnchorPath(null);
    setFilter("");
    setFullCache(null);
    setFilterError(null);
    setInline(null);
    setMenu(null);
    setConfirmDelete(null);
    lastRevealed.current = null;
    if (!workspaceId || !source) return;
    loadDir("", gen, true);
    return () => {
      generation.current += 1;
    };
  }, [workspaceId, source, loadDir]);

  // Dotfile toggle re-lists from the root (the daemon owns the filter).
  const toggleDotfiles = useCallback(() => {
    const next = !showDotfilesRef.current;
    setShowDotfiles(next);
    const gen = ++generation.current;
    setChildren({});
    setFilterReloadTick((tick) => tick + 1);
    reloadExpanded(gen, next);
  }, [reloadExpanded]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      if (expandedRef.current.has(dirPath)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
        return;
      }
      setExpanded((prev) => new Set(prev).add(dirPath));
      if (!childrenRef.current[dirPath]) {
        loadDir(dirPath, generation.current, showDotfilesRef.current);
      }
    },
    [loadDir],
  );

  const collapseAll = useCallback(() => setExpanded(new Set()), []);

  // Filtered projection loads the whole tree once per query (bounded):
  // MVP workspaces are small and the daemon pages each dir at 1000. It
  // runs on its own generation so typing never cancels lazy tree loads
  // (and vice versa); refresh and dotfile toggles re-run it via
  // filterReloadTick.
  useEffect(() => {
    if (!hasFilter || !source) {
      setFullCache(null);
      setFilterLoading(false);
      setFilterError(null);
      return;
    }
    setFilterLoading(true);
    setFilterError(null);
    const gen = ++filterGeneration.current;
    const live = source;
    let cancelled = false;
    void (async () => {
      try {
        const all: ExplorerNode[] = [];
        const queue = [""];
        while (queue.length > 0) {
          if (cancelled || filterGeneration.current !== gen) return;
          const dir = queue.shift() as string;
          const result = await live.listDir(dir, true);
          if (cancelled || filterGeneration.current !== gen) return;
          if (!result.ok) throw new Error(result.error.message);
          for (const node of result.result) {
            all.push(node);
            if (all.length > 5000) throw new Error("Too many files to filter; refine the workspace instead.");
            if (node.isDirectory) queue.push(node.path);
          }
        }
        if (cancelled || filterGeneration.current !== gen) return;
        setFullCache(all);
        setFilterLoading(false);
      } catch (failure) {
        if (cancelled || filterGeneration.current !== gen) return;
        setFilterError(failure instanceof Error ? failure.message : "The file filter could not run.");
        setFilterLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasFilter, filter, filterReloadTick, source, workspaceId]);

  const visibleRows = useMemo(
    () => buildVisibleRows(children, expanded),
    [children, expanded],
  );
  const rows: readonly ExplorerNode[] = useMemo(() => {
    if (!hasFilter) return visibleRows;
    if (!fullCache) return [];
    return projectNameFilter(fullCache, filter, { showDotfiles });
  }, [hasFilter, visibleRows, fullCache, filter, showDotfiles]);
  const rowsByPath = useMemo(() => new Map(rows.map((row) => [row.path, row])), [rows]);

  const scrollToPath = useCallback((path: string) => {
    const el = containerRef.current?.querySelector(
      `[data-path="${CSS.escape(path)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
    (el as HTMLElement | null)?.focus?.({ preventScroll: true });
  }, []);

  // Cancelling an edit returns focus to the row being renamed (a new-file
  // cancel has no row yet, so focus stays where the user left it).
  const cancelInline = useCallback(() => {
    const existing = inlineRef.current?.input.existingPath ?? null;
    setInline(null);
    if (existing) requestAnimationFrame(() => scrollToPath(existing));
  }, [scrollToPath]);

  // Auto-reveal: when the open editor file changes, expand its ancestors
  // (loading what is missing), select it and bring it into view — the
  // source's explorer.autoReveal behavior without the flash animation.
  useEffect(() => {
    if (!activePath) return;
    lastRevealed.current = activePath;
    const ancestors = ancestorPaths(activePath);
    const missing = ancestors.filter((dir) => !expandedRef.current.has(dir));
    if (missing.length > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const dir of missing) next.add(dir);
        return next;
      });
    }
    const gen = generation.current;
    for (const dir of ["", ...ancestors]) {
      if (!childrenRef.current[dir]) loadDir(dir, gen, showDotfilesRef.current);
    }
    setSelectedPaths(new Set([activePath]));
    setAnchorPath(activePath);
    requestAnimationFrame(() => scrollToPath(activePath));
  }, [activePath, revealTick, loadDir, scrollToPath]);
  // Finish a pending reveal once its ancestor listings land.
  useEffect(() => {
    const target = lastRevealed.current;
    if (target) scrollToPath(target);
  }, [children, scrollToPath]);

  const selectReplace = useCallback((path: string) => {
    setSelectedPaths(new Set([path]));
    setAnchorPath(path);
  }, []);

  const moveSelection = useCallback(
    (targetPath: string, mode: SelectionMode) => {
      if (mode === "toggle") {
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          if (next.has(targetPath)) next.delete(targetPath);
          else next.add(targetPath);
          return next;
        });
        setAnchorPath(targetPath);
        return;
      }
      if (mode === "range" || mode === "additive-range") {
        const ordered = rows.map((row) => row.path);
        const anchorIndex = anchorPath ? ordered.indexOf(anchorPath) : -1;
        const targetIndex = ordered.indexOf(targetPath);
        if (anchorIndex === -1 || targetIndex === -1) {
          selectReplace(targetPath);
          return;
        }
        const [from, to] =
          anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        setSelectedPaths((prev) => {
          const next = mode === "range" ? new Set<string>() : new Set(prev);
          for (let index = from; index <= to; index += 1) next.add(ordered[index]);
          return next;
        });
        return;
      }
      selectReplace(targetPath);
    },
    [rows, anchorPath, selectReplace],
  );

  const openNode = useCallback(
    (node: ExplorerNode) => {
      if (node.isDirectory) toggleDir(node.path);
      else onSelectRef.current?.(node);
    },
    [toggleDir],
  );

  const startNew = useCallback(
    (type: "file" | "folder", parentDir: string, depth: number) => {
      setMenu(null);
      if (parentDir !== "" && !expandedRef.current.has(parentDir)) {
        setExpanded((prev) => new Set(prev).add(parentDir));
      }
      if (parentDir !== "" && !childrenRef.current[parentDir]) {
        loadDir(parentDir, generation.current, showDotfilesRef.current);
      }
      setInline({ input: { parentPath: parentDir, type, depth }, error: null });
    },
    [loadDir],
  );

  const startRename = useCallback((node: ExplorerNode) => {
    setMenu(null);
    setInline({
      input: {
        parentPath: parentDirOf(node.path),
        type: "rename",
        depth: node.depth,
        existingName: node.name,
        existingPath: node.path,
      },
      error: null,
    });
  }, []);

  const siblingNames = useCallback(
    (parentDir: string, exclude?: string): Set<string> => {
      const names = new Set<string>();
      for (const child of children[parentDir] ?? []) {
        if (child.path !== exclude) names.add(child.name);
      }
      return names;
    },
    [children],
  );

  const submitInline = useCallback(
    (value: string): boolean => {
      const current = inline;
      if (!current || !source) return false;
      const { input } = current;
      const validation = validateInlineName(
        value,
        input.type,
        siblingNames(input.parentPath, input.existingPath),
        input.existingName,
      );
      if (!validation.ok) {
        setInline({ input, error: validation.error });
        return false;
      }
      if (validation.unchanged) {
        setInline(null);
        return true;
      }
      const name = value.trim();
      const gen = generation.current;
      setInline(null);
      if (input.type === "rename" && input.existingPath) {
        const from = input.existingPath;
        const to = input.parentPath === "" ? name : `${input.parentPath}/${name}`;
        if (!source.rename) {
          setActionError("Renaming needs a newer daemon with files.rename support.");
          return true;
        }
        void source.rename(from, to).then(
          (result) => {
            if (generation.current !== gen) return;
            if (!result.ok) {
              setActionError(result.error.message);
              return;
            }
            loadDir(input.parentPath, gen, showDotfiles);
            const renamed: ExplorerNode = {
              name,
              path: to,
              isDirectory: rowsByPath.get(from)?.isDirectory ?? false,
              depth: rowsByPath.get(from)?.depth ?? input.depth,
            };
            selectReplace(to);
            onSelectRef.current?.(renamed);
          },
          (failure: unknown) => {
            if (generation.current !== gen) return;
            setActionError(failure instanceof Error ? failure.message : "The rename could not be completed.");
          },
        );
        return true;
      }
      if (!source.create) {
        setActionError("Creating files needs a newer daemon with files.create support.");
        return true;
      }
      void source.create(input.parentPath, name, input.type === "folder" ? "directory" : "file").then(
        (result) => {
          if (generation.current !== gen) return;
          if (!result.ok) {
            setActionError(result.error.message);
            return;
          }
          setExpanded((prev) =>
            input.parentPath === "" || prev.has(input.parentPath)
              ? prev
              : new Set(prev).add(input.parentPath),
          );
          loadDir(input.parentPath, gen, showDotfiles);
          const createdPath = input.parentPath === "" ? name : `${input.parentPath}/${name}`;
          selectReplace(createdPath);
          if (input.type === "file") {
            onSelectRef.current?.({
              name,
              path: createdPath,
              isDirectory: false,
              depth: input.depth,
            });
          }
        },
        (failure: unknown) => {
          if (generation.current !== gen) return;
          setActionError(failure instanceof Error ? failure.message : "The file could not be created.");
        },
      );
      return true;
    },
    [inline, source, siblingNames, loadDir, showDotfiles, rowsByPath, selectReplace],
  );

  const requestDelete = useCallback(
    (nodes: ExplorerNode[]) => {
      if (nodes.length === 0) return;
      setMenu(null);
      setDeleteError(null);
      setConfirmDelete(nodes);
    },
    [],
  );

  const confirmDeleteNow = useCallback(() => {
    const nodes = confirmDelete;
    if (!nodes || !source?.remove) return;
    setDeletePending(true);
    setDeleteError(null);
    const gen = generation.current;
    const paths = nodes.map((node) => node.path);
    const parents = [...new Set(paths.map(parentDirOf))];
    void source.remove(paths).then(
      (result) => {
        if (generation.current !== gen) return;
        setDeletePending(false);
        if (!result.ok) {
          setDeleteError(result.error.message);
          return;
        }
        setConfirmDelete(null);
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          for (const path of paths) next.delete(path);
          return next;
        });
        for (const parent of parents) loadDir(parent, gen, showDotfiles);
        onDeleted?.(paths);
      },
      (failure: unknown) => {
        if (generation.current !== gen) return;
        setDeletePending(false);
        setDeleteError(failure instanceof Error ? failure.message : "The delete could not be completed.");
      },
    );
  }, [confirmDelete, source, loadDir, showDotfiles, onDeleted]);

  const copyPaths = useCallback(
    (nodes: ExplorerNode[], kind: "absolute" | "relative") => {
      try {
        const text = formatPathsForClipboard(nodes, kind, workspaceRoot);
        void navigator.clipboard.writeText(text).catch((failure: unknown) => {
          setActionError(failure instanceof Error ? failure.message : "Copy failed.");
        });
      } catch (failure) {
        setActionError(failure instanceof Error ? failure.message : "Copy failed.");
      }
    },
    [workspaceRoot],
  );

  const nodesForPaths = useCallback(
    (paths: readonly string[]): ExplorerNode[] =>
      paths.map((path) => rowsByPath.get(path)).filter((node) => node !== undefined),
    [rowsByPath],
  );

  const handleRowAction = useCallback(
    (id: RowMenuItemId, node: ExplorerNode, paths: readonly string[]) => {
      const targets = nodesForPaths(paths);
      const primary = rowsByPath.get(node.path) ?? node;
      switch (id) {
        case "new-file":
        case "new-folder": {
          const parent = primary.isDirectory ? primary.path : parentDirOf(primary.path);
          const depth = primary.isDirectory ? primary.depth + 1 : primary.depth;
          startNew(id === "new-file" ? "file" : "folder", parent, depth);
          break;
        }
        case "copy-path":
          copyPaths(targets.length > 0 ? targets : [primary], "absolute");
          break;
        case "copy-relative-path":
          copyPaths(targets.length > 0 ? targets : [primary], "relative");
          break;
        case "open-in-terminal":
          if (onOpenTerminal) {
            onOpenTerminal(primary.isDirectory ? primary.path : parentDirOf(primary.path));
          }
          break;
        case "reveal-in-finder":
          setActionError("Reveal in Finder needs the shell bridge, which is not wired in this build.");
          break;
        case "rename":
          startRename(primary);
          break;
        case "delete":
          requestDelete(targets.length > 0 ? targets : [primary]);
          break;
      }
    },
    [nodesForPaths, rowsByPath, startNew, copyPaths, onOpenTerminal, startRename, requestDelete],
  );

  const findFocusedIndex = useCallback((): number | null => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || !containerRef.current?.contains(el)) return null;
    const wrapper = el.closest<HTMLElement>("[data-row-index]");
    if (!wrapper) return null;
    const index = Number(wrapper.dataset.rowIndex);
    if (!Number.isInteger(index) || !rows[index]) return null;
    return index;
  }, [rows]);

  const focusRowAtIndex = useCallback((index: number) => {
    // The row button itself carries data-row-index (no virtualizer
    // wrapper), so focus lands on the match directly.
    const row = containerRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${index}"]`,
    );
    (row as HTMLElement | null)?.focus?.();
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    containerRef.current
      ?.querySelector(`[data-row-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  const indexOfSelected = useCallback((): number | null => {
    if (selectedPaths.size !== 1) return null;
    const only = [...selectedPaths][0];
    const index = rows.findIndex((row) => row.path === only);
    return index === -1 ? null : index;
  }, [rows, selectedPaths]);

  const onTreeKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (inline || menu || confirmDelete) return;
      if (isEditableTarget(event.target)) return;
      const native = event.nativeEvent;
      const isMac =
        typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
      const mod = isMac ? event.metaKey : event.ctrlKey;

      // Delete chord mirrors the source defaults: Delete everywhere, plus
      // ⌘⌫ on macOS (where bare Backspace must keep editing text).
      const wantsDelete =
        (!mod && event.key === "Delete") ||
        (isMac && event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Backspace");
      if (wantsDelete) {
        const focused = findFocusedIndex();
        const node =
          (focused !== null ? rows[focused] : null) ??
          (selectedPaths.size === 1 ? (rowsByPath.get([...selectedPaths][0]) ?? null) : null);
        const targets =
          selectedPaths.size > 1 ? nodesForPaths([...selectedPaths]) : node ? [node] : [];
        if (targets.length > 0) {
          event.preventDefault();
          requestDelete(targets);
        }
        return;
      }

      if (!mod && (event.key === "Enter" || event.key === "F2")) {
        const focused = findFocusedIndex();
        const node =
          (focused !== null ? rows[focused] : null) ??
          (selectedPaths.size === 1 ? (rowsByPath.get([...selectedPaths][0]) ?? null) : null);
        if (node) {
          event.preventDefault();
          startRename(node);
        }
        return;
      }

      if (!mod && event.key === " ") {
        const focused = findFocusedIndex();
        const node =
          (focused !== null ? rows[focused] : null) ??
          (selectedPaths.size === 1 ? (rowsByPath.get([...selectedPaths][0]) ?? null) : null);
        if (node) {
          event.preventDefault();
          selectReplace(node.path);
          openNode(node);
        }
        return;
      }

      if (mod && event.code === "KeyC" && event.altKey) {
        const targets =
          selectedPaths.size > 0
            ? nodesForPaths([...selectedPaths])
            : (() => {
                const focused = findFocusedIndex();
                const node = focused !== null ? rows[focused] : null;
                return node ? [node] : [];
              })();
        if (targets.length > 0) {
          event.preventDefault();
          copyPaths(targets, event.shiftKey ? "relative" : "absolute");
        }
        return;
      }

      applyNavigation(
        {
          rowProjection: {
            getVisibleCount: () => rows.length,
            getRowAtIndex: (index) => rows[index] ?? null,
            getParentIndex: (index) => {
              const current = rows[index];
              if (!current || current.depth <= 0) return null;
              for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
                if (rows[cursor].depth < current.depth) return cursor;
              }
              return null;
            },
            getFirstChildIndex: (index) => {
              const current = rows[index];
              const next = rows[index + 1];
              if (!current?.isDirectory) return null;
              return next && next.depth === current.depth + 1 ? index + 1 : null;
            },
          },
          selectedPath: selectedPaths.size === 1 ? [...selectedPaths][0] : null,
          isExpanded: (path) => expanded.has(path),
          findFocusedIndex,
          indexOfSelected,
          handlers: {
            moveSelection,
            toggleDir,
            scrollToIndex,
            focusRowAtIndex,
          },
        },
        native,
      );
    },
    [
      inline,
      menu,
      confirmDelete,
      rows,
      rowsByPath,
      selectedPaths,
      nodesForPaths,
      requestDelete,
      startRename,
      selectReplace,
      openNode,
      copyPaths,
      findFocusedIndex,
      indexOfSelected,
      expanded,
      moveSelection,
      toggleDir,
      scrollToIndex,
      focusRowAtIndex,
    ],
  );

  const rootLoaded = children[""] !== undefined;
  const showStatus = !rootLoaded && !hasFilter;
  const rowMenuNode =
    menu?.kind === "row" ? (rowsByPath.get(menu.paths[0]) ?? null) : null;

  return (
    <div
      ref={containerRef}
      data-orca-explorer-shell=""
      data-selected-folder-relative-path={
        rowMenuNode?.isDirectory ? rowMenuNode.path : undefined
      }
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={onTreeKeyDown}
    >
      <FileExplorerToolbar
        repoName={workspaceName}
        canCreate={caps.canMutate}
        createDisabledReason={caps.mutateDisabledReason}
        onNewFile={() => startNew("file", "", 0)}
        onNewFolder={() => startNew("folder", "", 0)}
        canRefresh={!!source}
        isRefreshing={isRefreshing}
        showRefreshSpinner={showRefreshSpinner}
        onRefresh={refreshAll}
        canCollapseAll={!hasFilter && expanded.size > 0}
        onCollapseAll={collapseAll}
        canRevealActive={!!activePath}
        onRevealActive={() => setRevealTick((tick) => tick + 1)}
        showDotfiles={showDotfiles}
        onToggleDotfiles={toggleDotfiles}
      />
      <FileExplorerQueryStrip>
        <FileExplorerNameFilter
          query={filter}
          loading={filterLoading}
          onQueryChange={(value) => {
            setFilter(value);
            setMenu(null);
          }}
          onClear={() => setFilter("")}
        />
      </FileExplorerQueryStrip>
      {actionError && (
        <div className="border-b border-border px-2 py-1.5" role="alert">
          <p className="text-[11px] text-destructive">{actionError}</p>
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline"
            onClick={() => setActionError(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {showStatus ? (
          <FileExplorerTreeStatus
            isLoading={!rootError}
            error={rootError}
            isEmpty={false}
          />
        ) : (
          <FileExplorerTreePane
            rows={rows}
            expanded={expanded}
            pendingDirs={pendingDirs}
            selectedPaths={selectedPaths}
            inline={inline}
            hasFilter={hasFilter}
            filterLoading={filterLoading}
            filterError={filterError}
            onSelectRow={openNode}
            onToggleDir={toggleDir}
            onMoveSelection={moveSelection}
            onSelectReplace={selectReplace}
            onStartRename={startRename}
            onRowMenu={(node, paths, point) =>
              setMenu({ kind: "row", point, paths: paths.includes(node.path) ? paths : [node.path] })
            }
            onBackgroundMenu={(point) => setMenu({ kind: "bg", point })}
            onBackgroundDoubleClick={() => {
              if (!inline) startNew("file", "", 0);
            }}
            onSubmitInline={submitInline}
            onCancelInline={cancelInline}
          />
        )}
      </div>
      {menu?.kind === "row" && rowMenuNode && (
        <FileExplorerRowMenu
          node={rowMenuNode}
          selectionSize={menu.paths.length}
          caps={caps}
          point={menu.point}
          onAction={(id) => handleRowAction(id, rowMenuNode, menu.paths)}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === "bg" && (
        <FileExplorerBackgroundMenu
          caps={caps}
          point={menu.point}
          onAction={(id) => {
            if (id === "new-file" || id === "new-folder") {
              startNew(id === "new-file" ? "file" : "folder", "", 0);
            }
          }}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmDelete && (
        <DeleteConfirmDialog
          {...deleteConfirmationFor(confirmDelete)}
          pending={deletePending}
          error={deleteError}
          onConfirm={confirmDeleteNow}
          onCancel={() => {
            if (!deletePending) {
              setConfirmDelete(null);
              setDeleteError(null);
            }
          }}
        />
      )}
    </div>
  );
}
