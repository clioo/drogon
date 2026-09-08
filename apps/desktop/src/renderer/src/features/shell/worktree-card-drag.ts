/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/sidebar/project-header-drag.ts (the pointer
   session machine: threshold promote, pointer capture, Escape/blur
   cancel, click swallow, autoscroll loop) combined with the worktree row
   path of src/renderer/src/components/sidebar/worktree-list/drag/
   (use-pointer-drag.ts: floating clone preview on promote;
   worktree-sidebar-drag-geometry.ts: grab-projected hit test with a held
   drop anchor). Adapter: one project group per session, single-card
   drags, no kanban board or status targets. The "Why" comments below are
   the source's. */

import { useCallback, useEffect, useRef, useState } from "react";
import { getSidebarDragAutoscroll } from "./sidebar-project-drop";
import { commitWorktreeCardDragDrop } from "./worktree-card-drag-commit";
import {
  createWorktreeCardPreview,
  INITIAL_WORKTREE_CARD_DRAG_STATE,
  isWorktreeCardDragBlocked,
  removeWorktreeCardPreview,
  setWorktreeCardDragDocumentStyles,
  updateWorktreeCardPreviewPosition,
  WORKTREE_CARD_DRAG_THRESHOLD_PX,
  type UseWorktreeCardDragArgs,
  type WorktreeCardDragController,
  type WorktreeCardDragSession,
  type WorktreeCardDragState,
} from "./worktree-card-drag-contract";
import {
  computeWorktreeCardDropSlot,
  getWorktreeCardDragGrab,
  getWorktreeCardDragReferenceY,
  indicatorYForHeldDropIndex,
  measureWorktreeCardDragRects,
  resolveWorktreeCardDropAnchorIndex,
  shouldReevaluateWorktreeCardDropAnchor,
  type WorktreeCardDragGrab,
  type WorktreeCardDropAnchor,
} from "./worktree-card-drag-drop";

export function useWorktreeCardDrag({
  visibleCardIdsByProject,
  fullCardIdsByProject,
  onCommitWorktreeOrder,
  getScrollContainer,
}: UseWorktreeCardDragArgs): WorktreeCardDragController {
  const [state, setState] = useState<WorktreeCardDragState>(
    INITIAL_WORKTREE_CARD_DRAG_STATE,
  );
  const [sessionArmed, setSessionArmed] = useState(false);
  const latestDropIndexRef = useRef<number | null>(null);
  latestDropIndexRef.current = state.dropIndex;
  const visibleByProjectRef = useRef(visibleCardIdsByProject);
  visibleByProjectRef.current = visibleCardIdsByProject;
  const fullByProjectRef = useRef(fullCardIdsByProject);
  fullByProjectRef.current = fullCardIdsByProject;
  const onCommitRef = useRef(onCommitWorktreeOrder);
  onCommitRef.current = onCommitWorktreeOrder;
  const getContainerRef = useRef(getScrollContainer);
  getContainerRef.current = getScrollContainer;
  const grabRef = useRef<WorktreeCardDragGrab | null>(null);
  const anchorRef = useRef<WorktreeCardDropAnchor | null>(null);
  const autoscrollLastFrameTimeRef = useRef<number | null>(null);
  const autoscrollFrameIdRef = useRef<number | null>(null);

  const dragSessionRef = useRef<WorktreeCardDragSession | null>(null);
  const clickSwallowTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClickUntilRef = useRef(0);

  const refreshCardRects = useCallback(() => {
    const container = getContainerRef.current();
    const session = dragSessionRef.current;
    if (!container || !session) {
      return [];
    }
    const rects = measureWorktreeCardDragRects(container, session.projectId);
    session.cardRects = rects;
    return rects;
  }, []);

  const computeDrop = useCallback(
    (
      pointerX: number,
      pointerY: number,
    ): { dropIndex: number; dropIndicatorY: number } | null => {
      const session = dragSessionRef.current;
      const container = getContainerRef.current();
      if (!session || !container) {
        return null;
      }
      if (
        shouldReevaluateWorktreeCardDropAnchor({
          anchor: anchorRef.current,
          pointerY,
          scrollTop: container.scrollTop,
        })
      ) {
        const containerTop = container.getBoundingClientRect().top;
        // Why: reuse the floating preview's own offset so the hit test tracks the
        // card the user sees, not the raw pointer.
        const localY = pointerY - containerTop + container.scrollTop;
        const referenceY = getWorktreeCardDragReferenceY({
          localY,
          grab: grabRef.current,
          activeHeight: 0,
        });
        const preview = computeWorktreeCardDropSlot({
          localY: referenceY,
          scrollTop: container.scrollTop,
          rects: session.cardRects,
          cardIds: session.sidebarCardIds,
          cardCount: session.sidebarCardIds.length,
          contentBottom: container.scrollHeight,
        });
        if (!preview) {
          anchorRef.current = null;
          return null;
        }
        anchorRef.current = {
          beforeWorktreeId: preview.dropAnchorId,
          pointerY,
          scrollTop: container.scrollTop,
        };
        return {
          dropIndex: preview.dropIndex,
          dropIndicatorY: preview.dropIndicatorY,
        };
      }
      const anchor = anchorRef.current;
      if (!anchor) {
        return null;
      }
      const dropIndex = resolveWorktreeCardDropAnchorIndex({
        anchor,
        cardIds: session.sidebarCardIds,
      });
      if (dropIndex === null) {
        anchorRef.current = null;
        return null;
      }
      void pointerX;
      const indicatorY = indicatorYForHeldDropIndex({
        rects: session.cardRects,
        dropIndex,
        scrollTop: container.scrollTop,
      });
      if (indicatorY === null) {
        anchorRef.current = null;
        return null;
      }
      return { dropIndex, dropIndicatorY: indicatorY };
    },
    [],
  );

  const applyDrop = useCallback(
    (
      worktreeId: string,
      projectId: string,
      drop: { dropIndex: number; dropIndicatorY: number } | null,
    ) => {
      latestDropIndexRef.current = drop?.dropIndex ?? null;
      const nextState: WorktreeCardDragState = drop
        ? { draggingWorktreeId: worktreeId, sourceProjectId: projectId, ...drop }
        : {
            draggingWorktreeId: worktreeId,
            sourceProjectId: projectId,
            dropIndex: null,
            dropIndicatorY: null,
          };
      setState((prev) =>
        prev.draggingWorktreeId === nextState.draggingWorktreeId &&
        prev.sourceProjectId === nextState.sourceProjectId &&
        prev.dropIndex === nextState.dropIndex &&
        prev.dropIndicatorY === nextState.dropIndicatorY
          ? prev
          : nextState,
      );
    },
    [],
  );

  const cancelAutoscroll = useCallback(() => {
    if (autoscrollFrameIdRef.current !== null) {
      window.cancelAnimationFrame(autoscrollFrameIdRef.current);
      autoscrollFrameIdRef.current = null;
    }
    autoscrollLastFrameTimeRef.current = null;
  }, []);

  const endDrag = useCallback(
    (commit: boolean) => {
      cancelAutoscroll();
      const session = dragSessionRef.current;
      if (!session) {
        setState(INITIAL_WORKTREE_CARD_DRAG_STATE);
        setSessionArmed(false);
        return;
      }
      try {
        session.sourceRow.releasePointerCapture(session.pointerId);
      } catch {
        // capture may already be released (pointercancel, element unmounted)
      }
      removeWorktreeCardPreview(session.preview);
      session.preview = null;
      setWorktreeCardDragDocumentStyles(false);
      if (session.promoted) {
        suppressClickUntilRef.current = window.performance.now() + 500;
        const sourceRow = session.sourceRow;
        const swallow = (e: MouseEvent): void => {
          const target = e.target as Node | null;
          if (target && sourceRow.contains(target)) {
            e.stopPropagation();
            e.preventDefault();
          }
          window.removeEventListener("click", swallow, true);
        };
        window.addEventListener("click", swallow, true);
        clickSwallowTimeoutRef.current = setTimeout(() => {
          window.removeEventListener("click", swallow, true);
          clickSwallowTimeoutRef.current = null;
        }, 0);
      }
      grabRef.current = null;
      anchorRef.current = null;
      const sidebarDropIndex =
        commit && session.promoted && latestDropIndexRef.current !== null
          ? latestDropIndexRef.current
          : null;
      const { projectId } = session;
      dragSessionRef.current = null;
      setState(INITIAL_WORKTREE_CARD_DRAG_STATE);
      setSessionArmed(false);
      if (sidebarDropIndex === null) {
        return;
      }

      commitWorktreeCardDragDrop({
        session,
        sidebarDropIndex,
        fullCardIds: fullByProjectRef.current.get(projectId) ?? [],
        onCommitWorktreeOrder: (orderedIds) =>
          onCommitRef.current(projectId, orderedIds),
      });
    },
    [cancelAutoscroll],
  );

  const promoteSession = useCallback(
    (session: WorktreeCardDragSession, clientX: number, clientY: number) => {
      const { preview, offsetX, offsetY, height } = createWorktreeCardPreview({
        sourceRow: session.sourceRow,
        pointerX: clientX,
        pointerY: clientY,
      });
      session.promoted = true;
      session.preview = preview;
      session.previewOffsetX = offsetX;
      session.previewOffsetY = offsetY;
      // Why: reuse the floating preview's own offset so the hit test tracks the
      // card the user sees, not the raw pointer.
      grabRef.current = getWorktreeCardDragGrab({ offsetY, height });
      anchorRef.current = null;
      suppressClickUntilRef.current = window.performance.now() + 500;
      setWorktreeCardDragDocumentStyles(true);
      // Why: setPointerCapture can throw if the element is detached. Check
      // isConnected first to avoid the throw; the global pointer listeners
      // still fire, so dragging keeps working even if capture fails.
      if (session.sourceRow.isConnected) {
        try {
          session.sourceRow.setPointerCapture(session.pointerId);
        } catch {
          // Ignore capture failure; global listeners will handle the drag.
        }
      }
      refreshCardRects();
      setState({
        draggingWorktreeId: session.worktreeId,
        sourceProjectId: session.projectId,
        dropIndex: null,
        dropIndicatorY: null,
      });
    },
    [refreshCardRects],
  );

  const runAutoscrollFrame = useCallback(
    (frameTime: number) => {
      autoscrollFrameIdRef.current = null;
      const session = dragSessionRef.current;
      const container = getContainerRef.current();
      if (!session?.promoted || !container) {
        cancelAutoscroll();
        return;
      }

      const previousFrameTime = autoscrollLastFrameTimeRef.current ?? frameTime;
      autoscrollLastFrameTimeRef.current = frameTime;
      const autoscroll = getSidebarDragAutoscroll({
        point: { clientX: session.latestPointerX, clientY: session.latestPointerY },
        containerRect: container.getBoundingClientRect(),
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        elapsedMs: frameTime - previousFrameTime,
      });
      if (autoscroll) {
        container.scrollTop = autoscroll.scrollTop;
        refreshCardRects();
      }

      if (session.preview) {
        updateWorktreeCardPreviewPosition({
          preview: session.preview,
          pointerX: session.latestPointerX,
          pointerY: session.latestPointerY,
          offsetX: session.previewOffsetX,
          offsetY: session.previewOffsetY,
        });
      }
      applyDrop(
        session.worktreeId,
        session.projectId,
        computeDrop(session.latestPointerX, session.latestPointerY),
      );

      autoscrollFrameIdRef.current = window.requestAnimationFrame(runAutoscrollFrame);
    },
    [applyDrop, cancelAutoscroll, computeDrop, refreshCardRects],
  );

  const ensureAutoscroll = useCallback(() => {
    if (autoscrollFrameIdRef.current !== null) {
      return;
    }
    autoscrollLastFrameTimeRef.current = null;
    autoscrollFrameIdRef.current = window.requestAnimationFrame(runAutoscrollFrame);
  }, [runAutoscrollFrame]);

  useEffect(() => {
    if (!sessionArmed) {
      return;
    }
    const onPointerMove = (e: PointerEvent): void => {
      const session = dragSessionRef.current;
      if (!session || e.pointerId !== session.pointerId) {
        return;
      }
      session.latestPointerX = e.clientX;
      session.latestPointerY = e.clientY;
      if (!session.promoted) {
        const dx = e.clientX - session.startX;
        const dy = e.clientY - session.startY;
        if (
          dx * dx + dy * dy <
          WORKTREE_CARD_DRAG_THRESHOLD_PX * WORKTREE_CARD_DRAG_THRESHOLD_PX
        ) {
          return;
        }
        promoteSession(session, e.clientX, e.clientY);
      }
      refreshCardRects();
      if (session.preview) {
        updateWorktreeCardPreviewPosition({
          preview: session.preview,
          pointerX: e.clientX,
          pointerY: e.clientY,
          offsetX: session.previewOffsetX,
          offsetY: session.previewOffsetY,
        });
      }
      applyDrop(
        session.worktreeId,
        session.projectId,
        computeDrop(e.clientX, e.clientY),
      );
      ensureAutoscroll();
    };
    const onPointerUp = (e: PointerEvent): void => {
      const session = dragSessionRef.current;
      if (!session || e.pointerId !== session.pointerId) {
        return;
      }
      endDrag(true);
    };
    const onPointerCancel = (e: PointerEvent): void => {
      const session = dragSessionRef.current;
      if (!session || e.pointerId !== session.pointerId) {
        return;
      }
      endDrag(false);
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        endDrag(false);
      }
    };
    const onBlur = (): void => endDrag(false);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onBlur);
      cancelAutoscroll();
      if (clickSwallowTimeoutRef.current !== null) {
        clearTimeout(clickSwallowTimeoutRef.current);
        clickSwallowTimeoutRef.current = null;
      }
    };
  }, [
    applyDrop,
    cancelAutoscroll,
    computeDrop,
    endDrag,
    ensureAutoscroll,
    promoteSession,
    refreshCardRects,
    sessionArmed,
  ]);

  const onCardPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, projectId: string, worktreeId: string) => {
      if (event.button !== 0 || event.pointerType === "touch") {
        return;
      }
      const sourceRow = event.currentTarget;
      if (isWorktreeCardDragBlocked(event.target, sourceRow)) {
        return;
      }
      const sidebarCardIds = visibleByProjectRef.current.get(projectId) ?? [];
      // A single card has nowhere to land, so leave the click path alone.
      if (sidebarCardIds.length <= 1 || !sidebarCardIds.includes(worktreeId)) {
        return;
      }
      const container = getContainerRef.current();
      if (!container) {
        return;
      }
      // Why: defer setPointerCapture until the drag threshold is crossed so a
      // card click still selects the workspace on pointerup.
      dragSessionRef.current = {
        worktreeId,
        projectId,
        sidebarCardIds,
        pointerId: event.pointerId,
        cardRects: measureWorktreeCardDragRects(container, projectId),
        sourceRow,
        startX: event.clientX,
        startY: event.clientY,
        latestPointerX: event.clientX,
        latestPointerY: event.clientY,
        promoted: false,
        preview: null,
        previewOffsetX: 0,
        previewOffsetY: 0,
        dropAnchorId: null,
      };
      setSessionArmed(true);
    },
    [],
  );

  const onCardClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (window.performance.now() >= suppressClickUntilRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return { state, onCardPointerDown, onCardClickCapture };
}
