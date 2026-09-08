/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/AgentStateDot.tsx (state vocabulary, glyphs,
   aria-labels and tooltip copy), AgentWorkingSpinner.tsx (compositor-driven
   ring with animationstart phase sync) and AgentQuestionIcon.tsx (shared
   question glyph on the --agent-question token), plus the card dot's quiet
   states from components/sidebar/StatusIndicator.tsx (adapter: Orca's ten
   transcript states collapse to this repo's five AgentState values — working
   keeps the spinner, needs_input keeps the waiting question glyph, unknown
   keeps the unverifiable amber dashed ring, idle keeps the idle grey dot and
   exited keeps the inactive grey dot; no zustand, props only; the tooltip
   wrapper mirrors StateIndicatorTooltip over this repo's ui/tooltip port). */
import { CircleDashed, MessageCircleQuestion } from "lucide-react";
import type { CSSProperties } from "react";
import type { AgentState } from "../../../../shared/session-contract";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import { agentIconKind, agentStateLabel } from "./agent-state";

const SPINNER_ANIMATION_NAME = "agent-spinner-rotate";

/** Shared tooltip delay with the source's StateIndicatorTooltip. */
const STATE_INDICATOR_TOOLTIP_DELAY_MS = 200;

// Why: anchoring the Web Animation timeline gives late mounts exact phase sync
// without recurring JS. Driven only by animationstart — a ref-time call would
// force a synchronous style recalc per mount for a phase animationstart fixes
// one frame later anyway.
function syncSpinnerPhase(el: HTMLSpanElement | null): void {
  if (el === null || typeof el.getAnimations !== "function") {
    return;
  }
  const animation = el
    .getAnimations()
    .find(
      (candidate) =>
        "animationName" in candidate &&
        candidate.animationName === SPINNER_ANIMATION_NAME,
    );
  if (animation !== undefined) {
    animation.startTime = 0;
  }
}

function handleSpinnerAnimationStart(
  event: React.AnimationEvent<HTMLSpanElement>,
): void {
  if (event.animationName === SPINNER_ANIMATION_NAME) {
    syncSpinnerPhase(event.currentTarget);
  }
}

// Why: the working-state ring animates via CSS (.agent-working-spinner in
// main.css) so rotation runs on the compositor and never touches the input
// thread. Callers size it via style (the fork passes className size-2 etc.).
function AgentWorkingSpinner({ style }: { style?: CSSProperties }) {
  return (
    <span
      onAnimationStart={handleSpinnerAnimationStart}
      data-agent-spinner=""
      style={style}
      className={
        // Why: under reduced motion the animation is disabled, so fill the top
        // border too — a frozen transparent-top ring reads as a broken
        // spinner; a complete ring reads as an intentional static marker.
        "agent-working-spinner block rounded-full border-2 border-yellow-500 border-t-transparent motion-reduce:border-t-yellow-500"
      }
    />
  );
}

// Why: "the agent is asking you something" shows up in tabs and cards. One
// icon + one token (--agent-question) so the two never drift apart.
function AgentQuestionIcon({ size }: { size: number }) {
  return (
    <MessageCircleQuestion
      size={size}
      className="text-agent-question"
      aria-hidden="true"
    />
  );
}

function AgentStateTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip delayDuration={STATE_INDICATOR_TOOLTIP_DELAY_MS}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact agent-state glyph shared by session tabs and worktree cards.
 * Working renders the compositor-driven spinner ring; needs_input the shared
 * question glyph; unknown the amber dashed ring; idle and exited quiet grey
 * dots. Callers size it with className-free `size` (icon pixels).
 */
export function AgentStateIcon({
  state,
  size = 14,
}: {
  state: AgentState;
  size?: number;
}) {
  const kind = agentIconKind(state);
  const label = agentStateLabel(state);
  // Why: the fork's md box (h-3 w-3) holds a size-2 ring/dot — two thirds of
  // the box. Icons that read as glyphs (question, dashed ring) fill the box.
  const inner = Math.max(6, Math.round((size * 2) / 3));
  const boxStyle = { width: size, height: size };
  const innerStyle = { width: inner, height: inner };

  let indicator: React.ReactElement;
  if (kind === "working") {
    indicator = (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={boxStyle}
        aria-label={label}
      >
        <AgentWorkingSpinner style={innerStyle} />
      </span>
    );
  } else if (kind === "needs-input") {
    indicator = (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={boxStyle}
        aria-label={label}
      >
        <AgentQuestionIcon size={size} />
      </span>
    );
  } else if (kind === "unknown") {
    // Why: a dashed ring reads as "incomplete information" rather than a
    // state claim, and amber carries warning weight without borrowing
    // working yellow or the question orange.
    indicator = (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={boxStyle}
        aria-label={label}
      >
        <CircleDashed
          size={size}
          className="text-amber-500"
          aria-hidden="true"
        />
      </span>
    );
  } else {
    indicator = (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={boxStyle}
        aria-label={label}
      >
        <span
          className="block rounded-full bg-neutral-500/40"
          style={innerStyle}
        />
      </span>
    );
  }

  return (
    <AgentStateTooltip label={label}>{indicator}</AgentStateTooltip>
  );
}
