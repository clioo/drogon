/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/app-shell/TitlebarLeftControls.tsx (adapter: props
   instead of the zustand store; tooltips become title attributes since this
   repo has no titlebar tooltip primitive; the Windows/Linux app-menu cluster
   is out of scope while the window keeps its native frame).
   The titlebar's left cluster: traffic-light padding, app name, sidebar
   toggle, and the back/forward history pair. */
import { ArrowLeft, ArrowRight, PanelLeft } from "lucide-react";

function isMac(): boolean {
  return (
    typeof navigator !== "undefined" && navigator.userAgent.includes("Mac")
  );
}

export function TitlebarLeftControls({
  canGoBack,
  canGoForward,
  backShortcutLabel,
  forwardShortcutLabel,
  toggleShortcutLabel,
  onToggleSidebar,
  onGoBack,
  onGoForward,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  backShortcutLabel: string;
  forwardShortcutLabel: string;
  toggleShortcutLabel: string;
  onToggleSidebar: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full w-full shrink-0 items-center">
      <div className="flex h-full items-center">
        {isMac() ? (
          <div className="titlebar-traffic-light-pad" />
        ) : (
          <div className="pl-2" />
        )}
        <div className="titlebar-app-name" aria-label="Drogon">
          <span className="titlebar-app-name-main">Drogon</span>
        </div>
        <button
          className="sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          title={`Toggle sidebar (${toggleShortcutLabel})`}
        >
          <PanelLeft size={16} />
        </button>
      </div>
      {/* Back/forward span workspace + view history. */}
      <div className="ml-auto mr-3 flex items-center pl-2">
        <button
          className="sidebar-toggle sidebar-toggle-compact"
          onClick={onGoBack}
          disabled={!canGoBack}
          aria-label="Go back"
          title={`Go back (${backShortcutLabel})`}
        >
          <ArrowLeft size={12} />
        </button>
        <button
          className="sidebar-toggle sidebar-toggle-compact"
          onClick={onGoForward}
          disabled={!canGoForward}
          aria-label="Go forward"
          title={`Go forward (${forwardShortcutLabel})`}
        >
          <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}
