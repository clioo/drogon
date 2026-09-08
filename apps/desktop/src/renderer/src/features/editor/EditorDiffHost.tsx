// MIT Copyright (c) 2026 Lovecast Inc. The editor-tab diff surface for
// #294 (fork: an `openDiff` OpenFile with mode 'diff' renders through
// EditorDiffFileSurface under the EditorPanelHeader diff controls).
// Header ports the source's isDiffSurface subset verbatim — side-by-side
// toggle ("Switch to inline diff" / "Switch to side-by-side diff"),
// Previous/Next change (ArrowUp/ArrowDown, disabled with no changes),
// and the More-actions menu's Word Wrap / Show Whitespace checkboxes —
// over this build's .editor-pane-header. The source's Open-file button,
// AI notes and markdown export stay unported (no counterpart backend).
// Data layer: the diff loads through the same `gitDiff` RPC the Changes
// panel used (`staged` per the tab's diff source) and is reconstructed
// into read-only original/modified panes (no read-file-at-ref RPC in
// this repo, so both panes are read-only — see DiffViewer's header).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns2, Rows2, RefreshCw, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";
import type { EditorScheme } from "./editor-theme";
import { useEditorScheme } from "./editor-theme";
import { EditorPanelHeaderPath } from "./EditorPanelHeaderPath";
import { EditorPanelMarkdownActionsMenu } from "./EditorPanelMarkdownActionsMenu";
import {
  DiffNavigationProvider,
  useDiffNavigation,
} from "../source-control/diff/diff-navigation-context";
import { reconstructDiffContent } from "../source-control/diff/diff-hunk-reconstruction";
import { windowGitBridge } from "../../changes-mount";
import type { EditorScope } from "./EditorPane";
import type { EditorTabDiffArea } from "../shell/editor-tab";

// Why lazy: `@monaco-editor/react` assumes browser globals (see
// EditorPane.tsx's note); plain-Node renderToString specs never load it.
const DiffViewer = lazy(() =>
  import("../source-control/diff/DiffViewer").then((mod) => ({
    default: mod.DiffViewer,
  })),
);

type DiffPhase =
  | { kind: "loading" }
  | { kind: "ready"; diff: string; truncated: boolean }
  | { kind: "error"; message: string };

export interface EditorDiffHostProps {
  scope: EditorScope;
  /** Workspace-relative path of the changed file. */
  path: string;
  /** Which uncommitted side the tab shows. */
  area: EditorTabDiffArea;
  /** Wired to the active tab's close. */
  onClose?: () => void;
}

/** Fork EditorFileLoadErrorView: the tab's load failure card with retry. */
function DiffLoadErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center bg-editor-surface p-6 text-sm text-muted-foreground">
      <div className="flex max-w-xl items-start gap-3 rounded-md border border-border bg-background p-4">
        <div className="min-w-0">
          <div className="font-medium text-foreground">Unable to load file</div>
          <div className="mt-1 break-words">{message}</div>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      </div>
    </div>
  );
}

export function EditorDiffHost({
  scope,
  path,
  area,
  onClose,
}: EditorDiffHostProps) {
  const stableScope = useScopeMemo(scope);
  const [reloadTick, setReloadTick] = useState(0);
  const [phase, setPhase] = useState<DiffPhase>({ kind: "loading" });
  // Fork settings defaults: diffWordWrap off, diffShowWhitespace off,
  // side-by-side on.
  const [sideBySide, setSideBySide] = useState(true);
  const [wordWrap, setWordWrap] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const generation = useRef(0);
  const scheme: EditorScheme = useEditorScheme();

  useEffect(() => {
    const current = ++generation.current;
    setPhase({ kind: "loading" });
    // Why no untracked special case: the daemon synthesizes an all-added
    // `--no-index` diff for untracked paths, so every area loads the same
    // way (the Changes panel's old effect behaved identically).
    void windowGitBridge()
      .gitDiff({ hostId: stableScope.hostId, workspaceId: stableScope.workspaceId, path, staged: area === "staged" })
      .then(
        (result) => {
          if (generation.current !== current) return;
          if (!result.ok) {
            setPhase({
              kind: "error",
              message:
                result.error.message ||
                `Request failed (${result.error.code}).`,
            });
            return;
          }
          setPhase({
            kind: "ready",
            diff: result.result.diff,
            truncated: result.result.truncated,
          });
        },
        (failure: unknown) => {
          if (generation.current !== current) return;
          setPhase({
            kind: "error",
            message:
              failure instanceof Error
                ? failure.message
                : "The diff could not be loaded.",
          });
        },
      );
    return () => {
      generation.current += 1;
    };
  }, [stableScope.hostId, stableScope.workspaceId, path, area, reloadTick]);

  const reload = useCallback(() => setReloadTick((tick) => tick + 1), []);

  const reconstructed =
    phase.kind === "ready"
      ? reconstructDiffContent(phase.diff)
      : { original: "", modified: "", hasContent: false, truncated: false };
  const pathLabel = path.split("/").pop() || path;
  const hasDom = typeof document !== "undefined";

  return (
    <section className="editor-pane" aria-label={`Diff: ${path}`}>
      {/* Why one provider around header and body: the prev/next buttons and
          the DiffViewer must share the registration context (the fork's
          EditorPanelHeader reads the same context the surface registers
          into). */}
      <DiffNavigationProvider>
        <header className="editor-pane-header">
        <EditorPanelHeaderPath
          pathLabel={pathLabel}
          pathTitle={path}
          copyText={path}
          copyToastLabel="File path copied"
        />
        {phase.kind === "ready" && (
          <span
            className="tabular-nums text-[10px] uppercase text-muted-foreground"
            aria-label={`Diff source: ${area}`}
          >
            {area}
          </span>
        )}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                onClick={() => setSideBySide((value) => !value)}
                aria-label={
                  sideBySide
                    ? "Switch to inline diff"
                    : "Switch to side-by-side diff"
                }
              >
                {sideBySide ? <Rows2 size={14} /> : <Columns2 size={14} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {sideBySide
                ? "Switch to inline diff"
                : "Switch to side-by-side diff"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <DiffNavButtons />
        <EditorPanelMarkdownActionsMenu
          isMarkdown={false}
          isDiffSurface
          wordWrapChecked={wordWrap}
          showWhitespace={showWhitespace}
          onToggleWordWrap={() => setWordWrap((value) => !value)}
          onToggleWhitespace={() => setShowWhitespace((value) => !value)}
        />
        {onClose && (
          <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
            <X aria-hidden />
          </Button>
        )}
        </header>
        <div className="editor-pane-surface" aria-label={`Diff contents of ${path}`}>
          {phase.kind === "loading" ? (
            <div
              className="flex items-center justify-center h-full text-muted-foreground text-sm"
              role="status"
            >
              Loading diff…
            </div>
          ) : phase.kind === "error" ? (
            <DiffLoadErrorView message={phase.message} onRetry={reload} />
          ) : !reconstructed.hasContent ? (
            <div
              className="flex items-center justify-center h-full text-muted-foreground text-sm"
              role="status"
            >
              No diff for this file.
            </div>
          ) : !hasDom ? (
            <div className="editor-pane-loading">Loading editor…</div>
          ) : (
            <Suspense fallback={<div className="editor-pane-loading">Loading editor…</div>}>
              <DiffViewer
                // Why a key: forces a remount per file+area so `onMount`
                // re-registers with diff-navigation-context under the new
                // file (same rule as the old strip viewer).
                key={`${area}:${path}`}
                path={path}
                original={reconstructed.original}
                modified={reconstructed.modified}
                scheme={scheme}
                sideBySide={sideBySide}
                wordWrap={wordWrap}
                showWhitespace={showWhitespace}
              />
            </Suspense>
          )}
        </div>
      </DiffNavigationProvider>
      {phase.kind === "ready" && (phase.truncated || reconstructed.truncated) && (
        <p role="status" className="px-3 py-1 shrink-0 text-muted-foreground text-xs">
          Diff truncated to the display budget.
        </p>
      )}
    </section>
  );
}

function useScopeMemo(scope: EditorScope): EditorScope {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ ...scope }), [scope.hostId, scope.workspaceId]);
}

/** Previous/Next change: the fork's EditorPanelHeader diff-nav buttons
 *  (ArrowUp/ArrowDown, disabled while the diff has no changes), reading
 *  the shared diff-navigation context like the source. */
function DiffNavButtons() {
  const { goToPreviousDiff, goToNextDiff, changeCount } = useDiffNavigation();
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            onClick={goToPreviousDiff}
            aria-label="Previous change"
            disabled={changeCount === 0}
          >
            <ArrowUp size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          Previous change
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            onClick={goToNextDiff}
            aria-label="Next change"
            disabled={changeCount === 0}
          >
            <ArrowDown size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          Next change
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
