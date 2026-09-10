/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/new-workspace/{SmartWorkspaceNameField.tsx,
   smart-workspace-name-field-surface.tsx, smart-workspace-name-input-surface.tsx,
   smart-workspace-source-results-surface.tsx, smart-workspace-source-row-content.tsx}
   over this repo's primitivas and data bridges. Adapter: the mode list holds
   only the sources Drogon can back — Smart, GitHub (daemon `gh`), Branch
   (worktree.branch_search) and plain Name; GitLab/Linear/Jira tabs, the
   cross-repo switch dialog and emoji shortcodes are not ported because this
   repo has none of those providers, exactly like the source hides providers
   that are not connected. Copy, row shapes, icons, keyboard handling and
   ARIA follow the source surfaces. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CaseSensitive,
  ExternalLink,
  GitBranch,
  GitBranchPlus,
  GitPullRequest,
  CircleDot,
  LoaderCircle,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { Command, CommandGroup, CommandItem, CommandList } from "../../components/ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { Tooltip } from "radix-ui";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { cn } from "../../lib/utils";
import {
  buildSmartWorkspaceSourceRows,
  getSmartWorkspaceEmptyHint,
  getVisibleBranchResults,
  getVisibleHeldProviderResults,
  isSmartWorkspaceSourceQueryWithinLimit,
  type BranchSearchRow,
  type GitHubWorkItem,
  type SmartNameMode,
  type SmartWorkspaceNameSelection,
  type SmartWorkspaceSourceRow,
} from "./smart-workspace-source-rows";
import { parseGitHubIssueOrPRLink } from "./smart-workspace-github-links";
import {
  RESULT_LIMIT,
  SEARCH_DEBOUNCE_MS,
  useSmartWorkspaceSearch,
} from "./use-smart-workspace-search";
import type { Result } from "../../../../shared/session-contract";
import type { TasksBridge } from "../../../../shared/tasks-contract";

type OpenExternal = (url: string) => Promise<unknown> | unknown;

/** The app's open-external authority (R10-C): http(s) links go through the
 *  shell bridge, never window.open. */
function openExternalUrl(url: string): void {
  if (typeof window === "undefined") return;
  const shell = (window.drogon as { shell?: { openExternal?: OpenExternal } })
    .shell;
  void shell?.openExternal?.(url);
}

type ModeOption = {
  id: SmartNameMode;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const SMART_MODES: readonly ModeOption[] = [
  { id: "smart", label: "Smart", Icon: Sparkles },
  { id: "github", label: "GitHub", Icon: GithubGlyph },
  { id: "branches", label: "Branch", Icon: GitBranch },
  { id: "text", label: "Name", Icon: CaseSensitive },
];

function GithubGlyph({ className }: { className?: string }): React.JSX.Element {
  // The fork renders lucide's `Github` mark; keep the silhouette inline so
  // the surface does not depend on the icon set's exact export name.
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

const FIELD_PLACEHOLDER: Record<SmartNameMode, string> = {
  // The source keeps the full provider list in the Smart placeholder (URL
  // detection still reads those links); Drogon's copy matches it verbatim.
  smart: "Type a name, #1234, branch, GitHub, GitLab, or Jira URL",
  github: "Search GitHub PRs and issues",
  branches: "Search branches",
  text: "Workspace name",
};

export function SmartWorkspaceNameField({
  inputRef,
  value,
  onValueChange,
  onGitHubItemSelect,
  onBranchSelect,
  selectedSource,
  onClearSelectedSource,
  onPlainEnter,
  onActiveSourceModeChange,
  textOnly,
  branchesEnabled = true,
  disabled = false,
  projectId,
  repoSlug,
  tasks,
  branchSearch,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onValueChange: (value: string) => void;
  onGitHubItemSelect: (item: GitHubWorkItem) => void;
  onBranchSelect: (refName: string, localBranchName: string) => void;
  selectedSource: SmartWorkspaceNameSelection | null;
  onClearSelectedSource: () => void;
  onPlainEnter?: () => void;
  onActiveSourceModeChange?: (mode: SmartNameMode) => void;
  /** Folder projects render the plain "Workspace name" input, no tabs. */
  textOnly: boolean;
  branchesEnabled?: boolean;
  disabled?: boolean;
  projectId: string | null;
  repoSlug: { owner: string; repo: string } | null;
  tasks: Pick<TasksBridge, "tasksList" | "tasksShow"> | null;
  branchSearch:
    | ((input: {
        projectId: string;
        query?: string;
        limit?: number;
      }) => Promise<Result<{ branches: BranchSearchRow[] }>>)
    | null;
}): React.JSX.Element {
  const availableModes = useMemo(
    () =>
      SMART_MODES.filter((item) => {
        if (textOnly) return item.id === "text";
        if (item.id === "github") return true;
        if (item.id === "branches") return branchesEnabled;
        return true;
      }),
    [textOnly, branchesEnabled],
  );
  const [mode, setMode] = useState<SmartNameMode>(
    () => availableModes[0]?.id ?? "text",
  );
  const [open, setOpen] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  // The source's command value: cmdk's highlighted row, resolved per render
  // and frozen while the live input leads the debounced search.
  const [commandValue, setCommandValue] = useState("");
  const tabsListRef = useRef<HTMLDivElement | null>(null);
  // The fork's local-input focus frame: tab/pointer flows re-focus the input
  // one frame later so Radix roving focus cannot race the commit.
  const localInputFocusFrameRef = useRef<number | null>(null);

  const cancelLocalInputFocusFrame = (): void => {
    if (localInputFocusFrameRef.current !== null) {
      cancelAnimationFrame(localInputFocusFrameRef.current);
      localInputFocusFrameRef.current = null;
    }
  };
  const scheduleLocalInputFocus = (): void => {
    cancelLocalInputFocusFrame();
    localInputFocusFrameRef.current = requestAnimationFrame(() => {
      localInputFocusFrameRef.current = null;
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  // Source's field availability effect: keep the mode inside the available
  // set when the selected project's kind changes.
  useEffect(() => {
    if (availableModes.some((item) => item.id === mode)) return;
    setMode(availableModes[0]?.id ?? "text");
  }, [availableModes, mode]);

  useEffect(() => {
    onActiveSourceModeChange?.(mode);
  }, [mode, onActiveSourceModeChange]);

  // The source's 200ms search debounce.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(value), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  const search = useSmartWorkspaceSearch({
    tasks,
    branchSearch,
    projectId,
    value,
    debouncedQuery,
    mode,
    disabled,
    repoSlug,
  });

  const githubUrlIntent =
    isSmartWorkspaceSourceQueryWithinLimit(value) &&
    (mode === "smart" || mode === "github")
      ? parseGitHubIssueOrPRLink(value)
      : null;
  const visibleBranches = getVisibleBranchResults({
    branches: search.branches,
    mode,
    resultQuery: search.branchResultsSource?.query ?? null,
    selectedRepoId: projectId,
    value,
  });
  const rows = useMemo(
    () =>
      buildSmartWorkspaceSourceRows({
        branches: visibleBranches,
        githubItems: getVisibleHeldProviderResults({
          items: search.githubItems,
          value,
          debouncedQuery,
        }),
        githubUrlIntent,
        mode,
        resultLimit: RESULT_LIMIT,
        value,
      }),
    [visibleBranches, search.githubItems, debouncedQuery, githubUrlIntent, mode, value],
  );
  const isTypedTextSourceRow = (row: SmartWorkspaceSourceRow): boolean =>
    row.kind === "use-name" || row.kind === "create-branch";
  const typedTextActionRow = rows.find(isTypedTextSourceRow) ?? null;
  const searchResultRows = typedTextActionRow
    ? rows.filter((row) => row !== typedTextActionRow)
    : rows;
  const trimmedValue = isSmartWorkspaceSourceQueryWithinLimit(value)
    ? value.trim()
    : "";
  const trimmedDebouncedQuery = isSmartWorkspaceSourceQueryWithinLimit(
    debouncedQuery,
  )
    ? debouncedQuery.trim()
    : "";
  const isQueryStale =
    trimmedValue.length > 0 && trimmedDebouncedQuery !== trimmedValue;
  // Why: an unambiguous `#N`/URL highlights its source row instead of the
  // typed-text fallback (the source's sourceIntent).
  const sourceIntent = (() => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^#\d+$/.test(trimmed) || parseGitHubIssueOrPRLink(trimmed) !== null) {
      return "github" as const;
    }
    return null;
  })();
  const resolvedCommandValue = (() => {
    if (rows.length === 0) return "";
    if (isQueryStale) {
      const typedTextRow = rows.find(isTypedTextSourceRow);
      if (typedTextRow) return typedTextRow.value;
      return rows.some((row) => row.value === commandValue)
        ? commandValue
        : (rows[0]?.value ?? "");
    }
    if (sourceIntent === "github") {
      const githubRow = rows.find((row) => row.kind === "github");
      if (githubRow) return githubRow.value;
    }
    return rows.some((row) => row.value === commandValue)
      ? commandValue
      : rows[0].value;
  })();
  // Why: ignored stale cmdk changes must not reappear after the query
  // settles.
  useEffect(() => {
    if (commandValue === resolvedCommandValue) return;
    setCommandValue(resolvedCommandValue);
  }, [commandValue, resolvedCommandValue]);

  const loading = search.loading;
  const showSearchSpinner = loading && searchResultRows.length === 0;
  const ActiveInputIcon =
    mode === "text" ? CaseSensitive : showSearchSpinner ? LoaderCircle : Search;

  const handleSelect = (row: SmartWorkspaceSourceRow): void => {
    if (row.kind === "use-name" || row.kind === "create-branch") {
      onValueChange(row.name);
    } else if (row.kind === "github") {
      onGitHubItemSelect(row.item);
    } else if (row.kind === "branch") {
      onBranchSelect(row.refName, row.localBranchName);
    }
    setOpen(false);
  };

  if (selectedSource) {
    // The source's selected-source pill: focusable, Enter submits,
    // Backspace/Delete clears, Alt+Enter opens the link.
    return (
      <div
        data-workspace-source-pill="true"
        tabIndex={0}
        aria-keyshortcuts={
          selectedSource.url ? "Alt+Enter Backspace Delete" : "Backspace Delete"
        }
        onKeyDown={(event) => {
          if (event.currentTarget !== event.target) {
            return;
          }
          if (
            (event.key === "Backspace" || event.key === "Delete") &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            !event.altKey
          ) {
            event.preventDefault();
            onClearSelectedSource();
            scheduleLocalInputFocus();
            return;
          }
          if (
            event.key === "Enter" &&
            event.altKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.shiftKey &&
            selectedSource.url
          ) {
            event.preventDefault();
            if (selectedSource.url) openExternalUrl(selectedSource.url);
            return;
          }
          if (
            event.key !== "Enter" ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          onPlainEnter?.();
        }}
        className="flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30"
      >
        <SelectionIcon kind={selectedSource.kind} />
        <span className="min-w-0 flex-1 truncate font-medium leading-none text-foreground">
          {selectedSource.label}
        </span>
        {selectedSource.url ? (
          <Tooltip.Provider delayDuration={300}>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  tabIndex={-1}
                  onClick={() => {
                    if (selectedSource.url) openExternalUrl(selectedSource.url);
                  }}
                  className="size-6 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                  aria-label="Open link in browser"
                >
                  <ExternalLink className="size-3.5" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="top" sideOffset={6} className="tooltip">
                  Open in browser
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </Tooltip.Provider>
        ) : null}
        <Tooltip.Provider delayDuration={300}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                tabIndex={-1}
                onClick={onClearSelectedSource}
                className="size-6 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                aria-label="Clear selected source"
              >
                <X className="size-3.5" />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="top" sideOffset={6} className="tooltip">
                Clear
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-1.5">
      {textOnly ? null : (
        <div className="flex min-w-0 items-center gap-2 border-b border-border/40">
          <Tabs
            value={mode}
            onValueChange={(next) => {
              const nextMode = next as SmartNameMode;
              onActiveSourceModeChange?.(nextMode);
              setMode(nextMode);
              if (!disabled && nextMode !== "text" && selectedSource === null) {
                setOpen(true);
              } else {
                setOpen(false);
              }
              cancelLocalInputFocusFrame();
              localInputFocusFrameRef.current = requestAnimationFrame(() => {
                localInputFocusFrameRef.current = null;
                inputRef.current?.focus({ preventScroll: true });
              });
            }}
            className="min-w-0 flex-1 gap-0"
          >
            <TabsList
              ref={tabsListRef}
              variant="line"
              className="h-7 w-full justify-start gap-4 overflow-x-auto overflow-y-hidden px-0 scrollbar-sleek"
              onFocusCapture={(event) => {
                // Why: Radix roving focus races commits, so forward external
                // Tab focus to the input.
                const previous = event.relatedTarget as HTMLElement | null;
                const list = tabsListRef.current;
                const input = inputRef.current;
                if (!list || !input) {
                  return;
                }
                if (!previous || previous === input || list.contains(previous)) {
                  return;
                }
                event.stopPropagation();
                input.focus({ preventScroll: true });
              }}
            >
              {availableModes.map(({ id, label, Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  tabIndex={-1}
                  data-smart-name-mode={id}
                  className="flex-none gap-1.5 px-0 text-xs"
                >
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      <Popover
        open={!disabled && open && mode !== "text" && selectedSource === null}
        onOpenChange={setOpen}
      >
        <Command
          value={resolvedCommandValue}
          onValueChange={() => {
            // Why: cmdk re-emits when rows reshape; the resolved value above
            // already freezes the highlight while the debounce trails input.
          }}
          shouldFilter={false}
          className="overflow-visible bg-transparent"
        >
          <PopoverAnchor asChild>
            <div className="relative min-w-0">
              <ActiveInputIcon
                className={cn(
                  "pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground",
                  showSearchSpinner && mode !== "text" && "animate-spin",
                )}
                aria-hidden="true"
              />
              <Input
                ref={inputRef}
                data-workspace-name-input="true"
                value={value}
                onPointerDown={() => {
                  if (!disabled && mode !== "text") {
                    setOpen(true);
                  }
                }}
                onChange={(event) => {
                  onValueChange(event.target.value);
                  if (!disabled && mode !== "text") {
                    setOpen(true);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Tab" && event.shiftKey) {
                    const activeTrigger =
                      tabsListRef.current?.querySelector<HTMLElement>(
                        `[data-smart-name-mode="${mode}"]`,
                      );
                    if (activeTrigger) {
                      event.preventDefault();
                      activeTrigger.focus();
                      return;
                    }
                  }
                  if (
                    event.key === "Enter" &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.shiftKey &&
                    !event.altKey
                  ) {
                    // Why: committing an IME candidate must not select a row.
                    if (event.nativeEvent.isComposing) {
                      return;
                    }
                    if (open && rows.length > 0) {
                      const row = rows.find(
                        (entry) => entry.value === resolvedCommandValue,
                      );
                      if (row) {
                        event.preventDefault();
                        handleSelect(row);
                        return;
                      }
                    }
                    onPlainEnter?.();
                  }
                  if (event.key === "Escape" && open) {
                    event.stopPropagation();
                    setOpen(false);
                  }
                }}
                placeholder={FIELD_PLACEHOLDER[mode]}
                disabled={disabled}
                // Why: match adjacent comboboxes' solid background in light
                // mode.
                className="h-9 bg-background pl-8 text-sm"
              />
            </div>
          </PopoverAnchor>
          <SmartWorkspaceSourceResults
            open={!disabled && open && mode !== "text" && selectedSource === null}
            localInputRef={inputRef}
            tabsListRef={tabsListRef}
            mode={mode}
            typedTextActionRow={typedTextActionRow}
            searchResultRows={searchResultRows}
            loading={loading}
            onSelect={handleSelect}
            keepPopoverOpen={(event) => {
              // The input and the mode tabs read as "outside" to Radix; both
              // belong to this popover.
              return (
                event.target instanceof Node &&
                (inputRef.current?.contains(event.target) ||
                  tabsListRef.current?.contains(event.target) ||
                  false)
              );
            }}
          />
        </Command>
      </Popover>
    </div>
  );
}

function SmartWorkspaceSourceResults({
  open,
  mode,
  typedTextActionRow,
  searchResultRows,
  loading,
  onSelect,
  localInputRef,
  tabsListRef,
  keepPopoverOpen,
}: {
  open: boolean;
  mode: SmartNameMode;
  typedTextActionRow: SmartWorkspaceSourceRow | null;
  searchResultRows: SmartWorkspaceSourceRow[];
  loading: boolean;
  onSelect: (row: SmartWorkspaceSourceRow) => void;
  localInputRef: React.RefObject<HTMLInputElement | null>;
  tabsListRef: React.RefObject<HTMLDivElement | null>;
  keepPopoverOpen: (event: { target: EventTarget | null }) => boolean;
}): React.JSX.Element | null {
  if (!open) return null;
  return (
    <PopoverContent
      data-workspace-source-suggestions="true"
      align="start"
      side="bottom"
      sideOffset={4}
      avoidCollisions={false}
      className="popover-scroll-content flex w-[var(--radix-popover-trigger-width)] flex-col p-0"
      // Why: results must not cover the create-workspace dialog's submit
      // footer.
      style={{
        maxHeight: "min(var(--radix-popover-content-available-height,7rem),7rem)",
      }}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onPointerDownOutside={(event) => {
        if (
          keepPopoverOpen(event) ||
          localInputRef.current?.contains(event.target as Node) ||
          tabsListRef.current?.contains(event.target as Node)
        ) {
          event.preventDefault();
        }
      }}
      onFocusOutside={(event) => {
        if (
          localInputRef.current?.contains(event.target as Node) ||
          tabsListRef.current?.contains(event.target as Node)
        ) {
          event.preventDefault();
        }
      }}
    >
      <CommandList className="!max-h-none min-h-0 flex-1 scrollbar-sleek">
        {typedTextActionRow ? (
          <div
            className="sticky top-0 z-10 border-b border-border/40 bg-popover p-1"
            onMouseDown={(event) => event.preventDefault()}
          >
            <CommandItem
              key={typedTextActionRow.value}
              value={typedTextActionRow.value}
              onSelect={() => onSelect(typedTextActionRow)}
              className={getRowItemClassName(typedTextActionRow, {
                pinnedAction: true,
              })}
            >
              <RowIcon row={typedTextActionRow} />
              <RowLabel row={typedTextActionRow} />
            </CommandItem>
          </div>
        ) : null}
        {loading && searchResultRows.length === 0 ? (
          <div className="space-y-1 p-1">
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                className="h-8 animate-pulse rounded bg-muted/40"
              />
            ))}
          </div>
        ) : searchResultRows.length === 0 && !typedTextActionRow ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {getSmartWorkspaceEmptyHint(mode)}
          </div>
        ) : searchResultRows.length > 0 ? (
          <CommandGroup className="p-1">
            {searchResultRows.map((row) => (
              <CommandItem
                key={row.value}
                value={row.value}
                onSelect={() => onSelect(row)}
                className={getRowItemClassName(row)}
              >
                <RowIcon row={row} />
                <RowLabel row={row} />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </PopoverContent>
  );
}

const ROW_ITEM_CLASS_NAME = "gap-2 px-3 py-2 text-xs";

function isTypedTextSourceRow(row: SmartWorkspaceSourceRow): boolean {
  return row.kind === "use-name" || row.kind === "create-branch";
}

function getRowItemClassName(
  row: SmartWorkspaceSourceRow,
  options?: { pinnedAction?: boolean },
): string {
  return cn(
    ROW_ITEM_CLASS_NAME,
    options?.pinnedAction && isTypedTextSourceRow(row) && "bg-muted/35",
  );
}

function RowIcon({ row }: { row: SmartWorkspaceSourceRow }): React.JSX.Element {
  if (row.kind === "use-name") {
    return <CaseSensitive className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (row.kind === "create-branch") {
    return <GitBranchPlus className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (row.kind === "github") {
    return row.item.type === "pr" ? (
      <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />
    ) : (
      <CircleDot className="size-3.5 shrink-0 text-muted-foreground" />
    );
  }
  return <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />;
}

function SelectionIcon({
  kind,
}: {
  kind: SmartWorkspaceNameSelection["kind"];
}): React.JSX.Element {
  if (kind === "github-pr") {
    return <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  if (kind === "branch") {
    return <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />;
  }
  return <CircleDot className="size-3.5 shrink-0 text-muted-foreground" />;
}

function RowLabel({ row }: { row: SmartWorkspaceSourceRow }): React.JSX.Element {
  if (row.kind === "use-name") {
    return (
      <span className="min-w-0 truncate">
        Use <span className="font-medium text-foreground">"{row.name}"</span> as
        workspace name
      </span>
    );
  }
  if (row.kind === "create-branch") {
    return (
      <span className="min-w-0 truncate">
        Create new branch{" "}
        <span className="font-mono text-[11px] font-medium text-foreground">
          {row.name}
        </span>
      </span>
    );
  }
  if (row.kind === "github") {
    return (
      <span className="min-w-0 truncate">
        <span className="font-medium text-foreground">#{row.item.number}</span>{" "}
        {row.item.title}
      </span>
    );
  }
  return (
    <span className="min-w-0 truncate font-mono text-[11px]">{row.refName}</span>
  );
}
