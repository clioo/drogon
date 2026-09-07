import { createElement } from "react";
import type { ReactNode } from "react";
import { BotsPanel } from "./BotsPanel";
import type { BotsPanelProps } from "./bots-panel-contracts";

// PanelDescriptor factory for the Bots panel (V4-B4), adapted to the shared
// route/panel contract at
// c5fea1d:apps/desktop/src/renderer/src/route-panel-contract.ts (branch
// codex/vertical-integration, V2-002). That module is not importable at this
// branch's HEAD and is deliberately NOT copied into this package: the factory
// builds a structurally compatible descriptor from caller-supplied inputs
// only and mirrors exactly one contract invariant here (a route id is
// non-empty, as routeId() enforces). Everything the contract leaves to
// ROOT/V2 stays an explicit parameter — the concrete id string, the title,
// the optional capability gate, the optional default restore state and the
// optional focus/cleanup hooks are never guessed or defaulted here, and the
// capability gate is validated at registration by the registry, not by this
// factory.
//
// The host's shared PanelProps (routeId/session/workspace/status/
// restoreState/focusTarget) flow through V2's mount; this component slice
// names only what it may observe. The nullable host session is deliberately
// unconsumed: a bridge session is never a liveness source (V4-B3), so the
// panel renders liveness exclusively from the caller-supplied
// observedLivenessByBotId map carried in `panel`.
//
// Mounts and registers NOTHING: no registerRoute call, no registry, no App
// edits — V2 stays the single mount point.

export type BotsPanelDescriptorInput = {
  /** Minted by V2/ROOT through the shared contract's routeId(); the factory
   *  only enforces the non-empty invariant and threads it verbatim. */
  routeId: string;
  /** Panel title rendered by the shell; threaded verbatim. */
  title: string;
  /** Caller-supplied panel data: list/history snapshot, optional dispatch
   *  callback, optional caller-observed liveness map. No store is invented. */
  panel: BotsPanelProps;
  /** Optional service-capability gate (Status.capabilities); admission is
   *  validated by the registry at registration time, never here. */
  capability?: string;
  /** Optional declared default persisted state for first/invalid mounts. */
  restoreState?: unknown;
  /** Optional post-focus hook; invoked by V2 with the route id. */
  onFocus?: (routeId: string) => void;
  /** Optional post-unmount cleanup hook; invoked by V2 with the route id. */
  onCleanup?: (routeId: string) => void;
};

export type BotsPanelDescriptor = {
  id: string;
  title: string;
  /** Accepts the shared mount props structurally; only `session` is named,
   *  and only to document that it is read as nullable and never consumed as
   *  a liveness verdict. */
  component: (hostProps: { session: unknown }) => ReactNode;
  capability?: string;
  restoreState?: unknown;
  onFocus?: (routeId: string) => void;
  onCleanup?: (routeId: string) => void;
};

export function createBotsPanelDescriptor(
  input: BotsPanelDescriptorInput,
): BotsPanelDescriptor {
  if (!input.routeId || !input.routeId.trim()) {
    throw new Error("route id must be non-empty");
  }
  const component = (_hostProps: { session: unknown }): ReactNode =>
    createElement(BotsPanel, input.panel);

  const descriptor: BotsPanelDescriptor = {
    id: input.routeId,
    title: input.title,
    component,
  };
  if (input.capability !== undefined) descriptor.capability = input.capability;
  if (input.restoreState !== undefined)
    descriptor.restoreState = input.restoreState;
  if (input.onFocus !== undefined) descriptor.onFocus = input.onFocus;
  if (input.onCleanup !== undefined) descriptor.onCleanup = input.onCleanup;
  return descriptor;
}
