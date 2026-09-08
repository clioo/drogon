// MIT Copyright (c) 2026 Lovecast Inc. Ported from
// src/renderer/src/components/terminal-pane/TerminalPaneHeaderOverlay.tsx
// (the chromeless pane-title-bar cluster: split trigger with the fork's
// "Split Terminal Right" copy plus the Close Pane button that only exists
// past one pane). Adapter: the fork positions one overlay layer over N
// pane-manager leaves with measured rects; Drogon renders one overlay per
// TerminalSplitHost pane, so no rects, titles, drag handles, chat toggles
// or renames travel — only the split/close cluster and its classes.
import { SquareSplitVertical, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";

export const SPLIT_TERMINAL_RIGHT_LABEL = "Split Terminal Right";
export const CLOSE_PANE_LABEL = "Close Pane";

export function TerminalSplitHeaderOverlay({
  tabId,
  paneSessionId,
  isActivePane,
  canSplit,
  canClose,
  onSplitRight,
  onClosePane,
}: {
  tabId: string;
  paneSessionId: string;
  isActivePane: boolean;
  /** False once the tab already holds two panes (the fork caps splits). */
  canSplit: boolean;
  /** True only past one pane, like the fork's header close button. */
  canClose: boolean;
  onSplitRight: () => void;
  onClosePane: () => void;
}): React.JSX.Element {
  return (
    <div
      className="pane-title-overlay-layer"
      data-pane-title-surface="dark"
    >
      <div
        className="pane-title-bar"
        data-chromeless
        data-terminal-tab-id={tabId}
        data-terminal-pane-id={paneSessionId}
        data-pane-prevent-terminal-focus=""
        {...(isActivePane ? { "data-active-pane": "" } : {})}
      >
        <div className="pane-title-actions ml-auto flex shrink-0 items-center gap-0">
          {canSplit ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="pane-title-split-trigger"
                  data-testid="terminal-split-right"
                  aria-label={SPLIT_TERMINAL_RIGHT_LABEL}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSplitRight();
                  }}
                >
                  <SquareSplitVertical className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {SPLIT_TERMINAL_RIGHT_LABEL}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {canClose ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="pane-title-close"
                  data-testid="terminal-split-close-pane"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClosePane();
                  }}
                  aria-label={CLOSE_PANE_LABEL}
                >
                  <X className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                {CLOSE_PANE_LABEL}
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}
