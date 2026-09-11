// MIT Copyright (c) 2026 Lovecast Inc. Split-terminal pane host for the
// "Split Terminal Right" subset of issue #129: one tab renders one or two
// side-by-side TerminalPanes with the fork's divider
// (src/renderer/src/assets/terminal.css `.pane-divider.is-vertical`) and
// the chromeless header cluster from TerminalPaneHeaderOverlay.tsx.
// Adapter: the fork lays out N pane-manager leaves with measured rects;
// Drogon lays out at most two daemon sessions in flexbox, so resize is a
// pointer drag over the host width and focus is focus-capture per pane.
import { useRef, useState } from "react";
import type { Session } from "../../../../shared/session-contract";
import type { TerminalGpuAcceleration } from "../../settings-store";
import { TerminalPane } from "./TerminalPane";
import { TerminalSplitHeaderOverlay } from "./TerminalSplitHeaderOverlay";
import {
  splitFractionFromClientX,
  splitSizesFromFirst,
  type TerminalSplit,
} from "./terminal-split";

export function TerminalSplitHost({
  rootId,
  split,
  panes,
  revision,
  fontSize,
  gpuMode,
  canSplit,
  onError,
  onSession,
  onSplitRight,
  onClosePane,
  onFocusPane,
  onResize,
}: {
  /** Tab identity (the root session id while single). */
  rootId: string;
  /** Live split state, or null while the tab holds one pane. */
  split: TerminalSplit | null;
  /** One session while single, both sessions while split. */
  panes: readonly [Session] | readonly [Session, Session];
  /** App revision nonce: pane keys ride it so a refresh never remounts. */
  revision: number;
  fontSize: number;
  gpuMode?: TerminalGpuAcceleration;
  /** False while disconnected/busy: the split entry points hide. */
  canSplit: boolean;
  onError: (message: string) => void;
  onSession: (value: Session) => void;
  onSplitRight: (paneSessionId: string) => void;
  onClosePane: (sessionId: string) => void;
  onFocusPane: (paneId: string) => void;
  onResize: (first: number) => void;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragId = useRef<number | null>(null);
  const isSplit = panes.length === 2 && split !== null;
  const activePaneId = split?.activePaneId ?? panes[0].id;
  const sizes = split?.sizes ?? ([0.5, 0.5] as [number, number]);

  const fractionFromClientX = (clientX: number): number => {
    const host = hostRef.current;
    if (!host) return 0.5;
    const rect = host.getBoundingClientRect();
    return splitFractionFromClientX(rect.left, rect.width, clientX);
  };

  const nudge = (delta: number) => {
    onResize(splitSizesFromFirst(sizes[0] + delta)[0]);
  };

  return (
    <div
      ref={hostRef}
      className="terminal-split-host"
      data-split={isSplit ? "split" : "single"}
      // Fork parity: the divider color rides the terminal surface, with the
      // fork's dark default (src/.../use-terminal-pane-projection.ts).
      style={
        {
          "--orca-terminal-divider-color": "#3f3f46",
          "--orca-terminal-divider-color-strong": "#71717a",
        } as React.CSSProperties
      }
    >
      <SplitPane
        session={panes[0]}
        grow={isSplit ? sizes[0] : 1}
        isActivePane={activePaneId === panes[0].id}
        showSplit={canSplit && !isSplit}
        showClose={isSplit}
        tabId={rootId}
        revision={revision}
        fontSize={fontSize}
        gpuMode={gpuMode}
        onError={onError}
        onSession={onSession}
        onSplitRight={() => onSplitRight(panes[0].id)}
        onClosePane={() => onClosePane(panes[0].id)}
        onFocusPane={onFocusPane}
      />
      {isSplit && panes.length === 2 ? (
        <>
          <div
            className={`pane-divider is-vertical${dragging ? " is-dragging" : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize terminal panes"
            aria-valuenow={Math.round(sizes[0] * 100)}
            aria-valuemin={20}
            aria-valuemax={80}
            tabIndex={0}
            data-testid="terminal-split-divider"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              dragId.current = event.pointerId;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
              onFocusPane(activePaneId);
            }}
            onPointerMove={(event) => {
              if (!dragging || event.pointerId !== dragId.current) return;
              onResize(fractionFromClientX(event.clientX));
            }}
            onPointerUp={(event) => {
              if (event.pointerId !== dragId.current) return;
              dragId.current = null;
              setDragging(false);
            }}
            onPointerCancel={() => {
              dragId.current = null;
              setDragging(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                nudge(-0.05);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                nudge(0.05);
              }
            }}
          />
          <SplitPane
            session={panes[1]}
            grow={sizes[1]}
            isActivePane={activePaneId === panes[1].id}
            showSplit={false}
            showClose
            tabId={rootId}
            revision={revision}
            fontSize={fontSize}
            gpuMode={gpuMode}
            onError={onError}
            onSession={onSession}
            onSplitRight={() => onSplitRight(panes[1].id)}
            onClosePane={() => onClosePane(panes[1].id)}
            onFocusPane={onFocusPane}
          />
        </>
      ) : null}
    </div>
  );
}

function SplitPane({
  session,
  grow,
  isActivePane,
  showSplit,
  showClose,
  tabId,
  revision,
  fontSize,
  gpuMode,
  onError,
  onSession,
  onSplitRight,
  onClosePane,
  onFocusPane,
}: {
  session: Session;
  grow: number;
  isActivePane: boolean;
  showSplit: boolean;
  showClose: boolean;
  tabId: string;
  revision: number;
  fontSize: number;
  gpuMode?: TerminalGpuAcceleration;
  onError: (message: string) => void;
  onSession: (value: Session) => void;
  onSplitRight: () => void;
  onClosePane: () => void;
  onFocusPane: (paneId: string) => void;
}): React.JSX.Element {
  return (
    <div
      className="terminal-split-pane"
      data-terminal-pane-id={session.id}
      style={{ flexGrow: grow, flexBasis: 0 }}
      {...(isActivePane ? { "data-active-pane": "" } : {})}
      onFocusCapture={() => onFocusPane(session.id)}
      onPointerDownCapture={() => onFocusPane(session.id)}
    >
      <TerminalPane
        key={`${session.id}:${revision}`}
        session={session}
        fontSize={fontSize}
        gpuMode={gpuMode}
        canSplit={showSplit}
        onSplitRight={onSplitRight}
        onError={onError}
        onSession={onSession}
        onFocus={() => onFocusPane(session.id)}
      />
      <TerminalSplitHeaderOverlay
        tabId={tabId}
        paneSessionId={session.id}
        isActivePane={isActivePane}
        canSplit={showSplit}
        canClose={showClose}
        onSplitRight={onSplitRight}
        onClosePane={onClosePane}
      />
    </div>
  );
}
