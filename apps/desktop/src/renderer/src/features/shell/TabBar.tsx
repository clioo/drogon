/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/tab-bar/SortableTab.tsx tab recipe and the
   agent-state badge vocabulary of components/AgentStateDot.tsx (adapter:
   no drag reorder — tabs keep App's roving-tabindex keyboard order;
   state comes from this repo's session.agentState). */
import { RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import type {
  Harness,
  Session,
} from "../../../../shared/session-contract";
import { sessionLabel } from "../../session-label";
import {
  recoveryActionFor,
  recoveryTabLabel,
} from "../../session-recovery";
import { agentStateOf } from "./agent-state";
import { AgentStateIcon } from "./AgentStateIcon";
import { ShellIconButton } from "./ShellIconButton";

/**
 * Session tab strip: one tab per session with its agent-state icon and
 * label, plus App's existing launcher (harness menu or plain "+") in
 * the trailing slot. Tab order, ids, roles and keyboard handling match
 * the strip this replaces.
 */
export function TabBar({
  sessions,
  activeId,
  harnesses,
  closeDisabled,
  retryDisabled,
  onSelect,
  onClose,
  onRetry,
  launcher,
}: {
  sessions: Session[];
  activeId: string;
  harnesses: Harness[];
  closeDisabled: boolean;
  retryDisabled: boolean;
  onSelect: (id: string) => void;
  onClose: (session: Session) => void;
  onRetry: () => void;
  /** App's existing "+" launcher element, rendered unchanged. */
  launcher: ReactNode;
}) {
  return (
    <div className="terminal-tabs" role="tablist" aria-label="Sessions">
      {sessions.map((item) => (
        <div
          className="terminal-tab"
          data-current={item.id === activeId}
          key={item.id}
        >
          <button
            role="tab"
            id={`session-tab-${item.id}`}
            aria-selected={item.id === activeId}
            aria-controls="active-session-panel"
            tabIndex={item.id === activeId ? 0 : -1}
            onKeyDown={(event) => {
              const index = sessions.findIndex(
                (value) => value.id === item.id,
              );
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % sessions.length
                  : event.key === "ArrowLeft"
                    ? (index - 1 + sessions.length) % sessions.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? sessions.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              onSelect(sessions[next].id);
              document
                .getElementById(`session-tab-${sessions[next].id}`)
                ?.focus();
            }}
            onClick={() => onSelect(item.id)}
          >
            <AgentStateIcon state={agentStateOf(item)} size={13} />
            <span>
              {recoveryTabLabel({
                label: sessionLabel(item, harnesses),
                verdict: item.verdict,
                id: item.id,
                incarnation: item.incarnation,
              })}
            </span>
            <span className="session-verdict">{item.verdict}</span>
          </button>
          {recoveryActionFor(item.verdict, {
            // A confirmed close removes the tab, so a still-listed
            // exited session is one the user did not request.
            exitExpected: false,
          }).kind === "retry-connection" && (
            <ShellIconButton
              label="Retry connection"
              disabled={retryDisabled}
              onClick={onRetry}
            >
              <RefreshCw />
            </ShellIconButton>
          )}
          <ShellIconButton
            label={`Close ${sessionLabel(item, harnesses)} session`}
            disabled={closeDisabled}
            onClick={() => onClose(item)}
          >
            <X />
          </ShellIconButton>
        </div>
      ))}
      {launcher}
    </div>
  );
}
