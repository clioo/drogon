/* MIT Copyright (c) 2026 Lovecast Inc.
 * Jump palette surface ported from the read-only reference
 * `worktree-jump-palette-surface.tsx`, `worktree-jump-palette-entry.tsx`,
 * `worktree-jump-palette-workspace-tab-row.tsx`,
 * `worktree-jump-palette-worktree-row.tsx` and
 * `worktree-jump-palette-project-action-rows.tsx`: dialog shape, section
 * order, row layout (status dot, title, badges, dimmed branch/url),
 * footer keys, empty-state and result-count ARIA. Data comes from this
 * repo's bridges (no Orca stores); icons are lucide like the source.
 */
import { useEffect, useMemo, useRef, type Ref } from "react";
import { Command } from "cmdk";
import {
  FolderPlus,
  Globe,
  Plus,
  Settings,
  SquareTerminal,
} from "lucide-react";
import { projectJumpSections } from "./jump-palette-sections";
import {
  JUMP_LABELS,
  jumpAgentStatusLabel,
  jumpItemId,
  type JumpBrowserTab,
  type JumpItem,
  type JumpQuickAction,
  type JumpQuickActionId,
  type JumpSection,
  type JumpTab,
  type JumpWorktree,
} from "./jump-palette-model";
import type { AgentState } from "../../../../shared/session-contract";

export interface JumpPaletteProps {
  query: string;
  onQueryChange(query: string): void;
  onClose(): void;
  tabs: JumpTab[];
  worktrees: JumpWorktree[];
  browserTabs: JumpBrowserTab[];
  quickActions: JumpQuickAction[];
  canCreateWorktree: boolean;
  onSelectSession(id: string): void;
  onSelectWorkspace(id: string): void;
  onSelectBrowserTab(tabId: string): void;
  onQuickAction(id: JumpQuickActionId): void;
  onCreateWorktree(name: string): void;
}

/**
 * Pure selection dispatch behind every palette row: maps a picked item to
 * the App callback that owns it. Unit-tested directly (cmdk's own
 * item-select event bridge does not attach under jsdom, so synthetic
 * clicks/Enter cannot reach `onSelect` there); the real key path is
 * verified over CDP against the running app.
 */
export type JumpSelection =
  | { type: "select-session"; id: string }
  | { type: "select-workspace"; id: string }
  | { type: "select-browser-tab"; tabId: string }
  | { type: "quick-action"; id: JumpQuickActionId }
  | { type: "create-worktree"; name: string };

export function describeJumpSelection(item: JumpItem): JumpSelection {
  switch (item.kind) {
    case "tab":
      return { type: "select-session", id: item.tab.id };
    case "worktree":
      return { type: "select-workspace", id: item.worktree.workspaceId };
    case "browser-tab":
      return { type: "select-browser-tab", tabId: item.tab.tabId };
    case "quick-action":
      return { type: "quick-action", id: item.action.id };
    case "create-worktree":
      return { type: "create-worktree", name: item.name };
  }
}

export function JumpPalette(props: JumpPaletteProps) {
  const { query, onQueryChange, onClose } = props;
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ⌘J must land in the search box even when the previously focused
  // surface (terminal, browser URL bar) reclaims focus after mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const projection = useMemo(
    () =>
      projectJumpSections({
        tabs: props.tabs,
        worktrees: props.worktrees,
        browserTabs: props.browserTabs,
        quickActions: props.quickActions,
        query,
        canCreateWorktree: props.canCreateWorktree,
      }),
    [
      props.tabs,
      props.worktrees,
      props.browserTabs,
      props.quickActions,
      query,
      props.canCreateWorktree,
    ],
  );
  const hasQuery = query.trim() !== "";
  const empty = projection.sections.length === 0 && projection.createWorktreeName === null;

  const select = (item: JumpItem) => {
    const selection = describeJumpSelection(item);
    switch (selection.type) {
      case "select-session":
        props.onSelectSession(selection.id);
        break;
      case "select-workspace":
        props.onSelectWorkspace(selection.id);
        break;
      case "select-browser-tab":
        props.onSelectBrowserTab(selection.tabId);
        break;
      case "quick-action":
        props.onQuickAction(selection.id);
        break;
      case "create-worktree":
        props.onCreateWorktree(selection.name);
        break;
    }
    onClose();
  };

  return (
    <div
      className="command-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Command
        label={JUMP_LABELS.paletteTitle}
        shouldFilter={false}
        className="command-palette jump-palette"
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
          placeholder={JUMP_LABELS.inputPlaceholder}
          className="command-palette-input"
          aria-label={JUMP_LABELS.paletteTitle}
        />
        <Command.List className="command-palette-list" aria-label={JUMP_LABELS.paletteDescription}>
          {empty ? (
            <Command.Empty className="jump-palette-empty-wrap">
              <div className="jump-palette-empty">
                <p className="jump-palette-empty-title">
                  {hasQuery ? JUMP_LABELS.emptyNoResultsTitle : JUMP_LABELS.emptyNothingTitle}
                </p>
                <p className="jump-palette-empty-subtitle">
                  {hasQuery
                    ? JUMP_LABELS.emptyNoResultsSubtitle
                    : JUMP_LABELS.emptyNothingSubtitle}
                </p>
              </div>
            </Command.Empty>
          ) : (
            <>
              {projection.sections.map((section) => (
                <JumpSectionRows key={section.id} section={section} onSelect={select} />
              ))}
              {projection.createWorktreeName !== null && (
                <Command.Item
                  value="create-worktree"
                  onSelect={() =>
                    select({
                      kind: "create-worktree",
                      name: projection.createWorktreeName as string,
                    })
                  }
                  className="jump-palette-item command-palette-row"
                >
                  <span className="jump-palette-create-icon" aria-hidden="true">
                    <Plus className="size-3.5" />
                  </span>
                  <span className="command-palette-label">
                    {JUMP_LABELS.createWorktreePrefix} &ldquo;
                    {projection.createWorktreeName}&rdquo;
                  </span>
                </Command.Item>
              )}
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
          {hasQuery
            ? `${projection.resultCount} results found${projection.createWorktreeName ? ", create worktree action available" : ""}`
            : `${projection.resultCount} items available`}
        </div>
      </Command>
    </div>
  );
}

function JumpSectionRows({
  section,
  onSelect,
}: {
  section: JumpSection;
  onSelect(item: JumpItem): void;
}) {
  return (
    <Command.Group
      heading={section.label}
      className="command-palette-section jump-palette-section"
    >
      {section.items.map((item) => (
        <JumpRow key={jumpItemId(item)} item={item} onSelect={onSelect} />
      ))}
    </Command.Group>
  );
}

function JumpRow({
  item,
  onSelect,
}: {
  item: JumpItem;
  onSelect(item: JumpItem): void;
}) {
  if (item.kind === "tab") return <JumpTabRow tab={item.tab} onSelect={() => onSelect(item)} />;
  if (item.kind === "worktree")
    return <JumpWorktreeRow worktree={item.worktree} onSelect={() => onSelect(item)} />;
  if (item.kind === "browser-tab")
    return <JumpBrowserTabRow tab={item.tab} onSelect={() => onSelect(item)} />;
  if (item.kind === "quick-action")
    return (
      <JumpQuickActionRow action={item.action} onSelect={() => onSelect(item)} />
    );
  return null;
}

function AgentDot({ state }: { state: AgentState | null }) {
  if (state === null) return null;
  return (
    <span
      role="img"
      aria-label={jumpAgentStatusLabel(state)}
      data-state={state}
      className="jump-palette-dot"
    />
  );
}

function JumpTabRow({ tab, onSelect }: { tab: JumpTab; onSelect(): void }) {
  return (
    <Command.Item
      value={`tab:${tab.id}`}
      onSelect={onSelect}
      className="jump-palette-item command-palette-row"
    >
      <AgentDot state={tab.agentState} />
      <span className="jump-palette-leading" aria-hidden="true">
        <SquareTerminal className="size-3.5" />
      </span>
      <span className="command-palette-label">{tab.title}</span>
      {tab.isActive && <span className="jump-palette-badge">Current Tab</span>}
    </Command.Item>
  );
}

function JumpWorktreeRow({
  worktree,
  onSelect,
}: {
  worktree: JumpWorktree;
  onSelect(): void;
}) {
  return (
    <Command.Item
      value={`worktree:${worktree.id}`}
      onSelect={onSelect}
      className="jump-palette-item command-palette-row"
    >
      <AgentDot state={worktree.agentState} />
      <span className="command-palette-label">{worktree.name}</span>
      {worktree.isCurrent && <span className="jump-palette-badge">Current</span>}
      {worktree.branch.trim() !== "" && worktree.name !== worktree.branch && (
        <span className="command-palette-path">{worktree.branch}</span>
      )}
      <span className="jump-palette-project">{worktree.projectName}</span>
    </Command.Item>
  );
}

function JumpBrowserTabRow({
  tab,
  onSelect,
}: {
  tab: JumpBrowserTab;
  onSelect(): void;
}) {
  return (
    <Command.Item
      value={`browser-tab:${tab.tabId}`}
      onSelect={onSelect}
      className="jump-palette-item command-palette-row"
    >
      <span className="jump-palette-leading" aria-hidden="true">
        <Globe className="size-3.5" />
      </span>
      <span className="command-palette-label">{tab.title}</span>
      {tab.isActive && <span className="jump-palette-badge">Current Tab</span>}
      <span className="command-palette-path">{tab.url}</span>
    </Command.Item>
  );
}

const QUICK_ACTION_ICONS = {
  "worktree.new": Plus,
  "terminal.new": SquareTerminal,
  "browser.new": Globe,
  "project.add": FolderPlus,
  "settings.open": Settings,
} as const;

function JumpQuickActionRow({
  action,
  onSelect,
}: {
  action: JumpQuickAction;
  onSelect(): void;
}) {
  const Icon = QUICK_ACTION_ICONS[action.id];
  return (
    <Command.Item
      value={`action:${action.id}`}
      onSelect={onSelect}
      className="jump-palette-item command-palette-row"
    >
      <span className="jump-palette-leading" aria-hidden="true">
        <Icon className="size-3.5" />
      </span>
      <span className="command-palette-label">{action.title}</span>
      <span className="jump-palette-badge">Action</span>
      <span className="command-palette-path">{action.description}</span>
    </Command.Item>
  );
}
