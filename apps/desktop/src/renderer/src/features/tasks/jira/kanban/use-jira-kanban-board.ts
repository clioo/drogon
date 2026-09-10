// C09 Jira kanban board state: paged loading over the existing Jira bridge,
// per-issue workflow transitions, the pending/reconciliation move overlay
// and stable selection — the board-specific data layer on top of the C02
// kanban interaction primitives. No second HTTP stack, no second assignment
// system, no workspace-status writes: lanes come from real status ids and
// moves only from transitions Jira actually offers.
//
// MIT Copyright (c) 2026 Lovecast Inc.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  JiraBridge,
  JiraIssue,
  JiraStartIssueResult,
  JiraTransition,
} from "../../../../../../shared/jira-contract";
import type { JiraPresetId } from "../../task-page-localized-options";
import {
  JIRA_ITEM_LIMIT,
  TASK_SEARCH_DEBOUNCE_MS,
} from "../../task-page-source-context";
import {
  readJiraTaskResumeState,
  writeJiraTaskResumeState,
} from "../../jira-task-resume-storage";
import {
  buildJiraBoardCoverage,
  buildJiraKanbanLanes,
  describeJiraBoardCoverage,
  findJiraLaneByIdentity,
  type JiraBoardCoverage,
  type JiraKanbanLane,
} from "./jira-kanban-columns";
import {
  classifyJiraMoveResult,
  describeJiraBlockedReason,
  planJiraMove,
  reconcileJiraMove,
  type JiraBlockedReason,
  type JiraMoveTarget,
  type JiraPendingMove,
  type JiraTransitionPlan,
} from "./jira-kanban-moves";
import { getJiraIssueIdentity } from "./jira-issue-identity";
import { useJiraKanbanSelection } from "./use-jira-kanban-selection";

export type JiraKanbanNotice = {
  identity: string | null;
  tone: "blocked" | "info";
  message: string;
};

export type UseJiraKanbanBoardArgs = {
  bridge: JiraBridge;
  jiraConnected: boolean;
  /** The Tasks page's selected Jira site ('all' or one site id). */
  selectedSiteId: string | null;
  /**
   * Local git project used by `jira.startIssue` when a card's session is
   * opened from the board itself. The mounted Tasks page supplies it from
   * its own project context; the board never invents one.
   */
  startIssueProjectId?: string | null;
  /** Called after `jiraStartIssue` resolved with the linked worktree. */
  onSessionOpened?: (issue: JiraIssue, result: JiraStartIssueResult) => void;
};

export function useJiraKanbanBoard({
  bridge,
  jiraConnected,
  selectedSiteId,
  startIssueProjectId = null,
  onSessionOpened,
}: UseJiraKanbanBoardArgs) {
  // The existing Jira preference authority (the Tasks page's resume state)
  // seeds and persists the preset + query, exactly like the list view.
  const [resumeSeed] = useState(() => readJiraTaskResumeState());
  const [preset, setPresetState] = useState<JiraPresetId>(
    () => (resumeSeed?.jiraPreset as JiraPresetId | undefined) ?? "assigned",
  );
  const [queryInput, setQueryInput] = useState(
    () => resumeSeed?.jiraQuery ?? "",
  );
  const [appliedQuery, setAppliedQuery] = useState(
    () => resumeSeed?.jiraQuery ?? "",
  );
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<JiraBoardCoverage>(() =>
    buildJiraBoardCoverage({ loadedCount: 0 }),
  );
  /** Server coverage of the LATEST page; stale after a failed load-more. */
  const [staleData, setStaleData] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Transitions Jira offers, per composed issue identity; invalidated after
  // every settled move so the next menu open re-reads the workflow.
  const [transitionsByIdentity, setTransitionsByIdentity] = useState<
    Map<string, JiraTransition[]>
  >(new Map());
  const [loadingTransitions, setLoadingTransitions] = useState<Set<string>>(
    () => new Set(),
  );
  // Moves requested before the issue's transitions were loaded (lane drops
  // race the fetch): the intent is queued as state and an effect runs it
  // with the closures of the render that has the transitions — no stale-ref
  // race, never silently swallowed, never guessed.
  const [deferredMoves, setDeferredMoves] = useState<
    Map<string, { issue: JiraIssue; target: JiraMoveTarget }>
  >(new Map());
  // Pending move overlay, per composed issue identity: at most one
  // unresolved move per issue, so a blind duplicate POST is unreachable.
  const [pendingByIdentity, setPendingByIdentity] = useState<
    Map<string, JiraPendingMove>
  >(new Map());
  const [notice, setNotice] = useState<JiraKanbanNotice | null>(null);
  const [openingSessionIdentity, setOpeningSessionIdentity] = useState<
    string | null
  >(null);
  const requestNonceRef = useRef(0);

  // The fork's 300ms search debounce (the list view's cadence).
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAppliedQuery(queryInput);
    }, TASK_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [queryInput]);

  const persistResume = useCallback(
    (state: { jiraPreset?: JiraPresetId; jiraQuery?: string }) => {
      writeJiraTaskResumeState({
        jiraPreset: state.jiraPreset ?? preset,
        jiraQuery: state.jiraQuery ?? appliedQuery.trim(),
      });
    },
    [preset, appliedQuery],
  );

  const setPreset = useCallback(
    (next: JiraPresetId) => {
      setPresetState(next);
      persistResume({ jiraPreset: next });
    },
    [persistResume],
  );

  const siteId =
    selectedSiteId && selectedSiteId !== "all" ? selectedSiteId : undefined;

  // The board's load effect: a typed query searches verbatim (paged), an
  // empty query lists the active preset. A late response for an older
  // window is dropped, never rendered.
  useEffect(() => {
    if (!jiraConnected) {
      setIssues([]);
      setCoverage(buildJiraBoardCoverage({ loadedCount: 0 }));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setStaleData(false);
    requestNonceRef.current += 1;
    const requestId = `jira-kanban-${requestNonceRef.current}`;
    const trimmed = appliedQuery.trim();
    const request =
      trimmed.length > 0
        ? bridge.jiraSearchIssues({
            jql: trimmed,
            limit: JIRA_ITEM_LIMIT,
            startAt: 0,
            siteId,
            requestId,
          })
        : bridge.jiraListIssues({
            filter: preset,
            limit: JIRA_ITEM_LIMIT,
            siteId,
            requestId,
          });
    void request
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error.message);
          setIssues([]);
          setCoverage(buildJiraBoardCoverage({ loadedCount: 0 }));
          setLoading(false);
          return;
        }
        setIssues(result.result.issues);
        setCoverage(
          buildJiraBoardCoverage({
            loadedCount: result.result.issues.length,
            total: result.result.total ?? null,
            isLast: result.result.isLast ?? null,
          }),
        );
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setIssues([]);
        setCoverage(buildJiraBoardCoverage({ loadedCount: 0 }));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, jiraConnected, siteId, appliedQuery, preset, refreshNonce]);

  const refresh = useCallback(() => setRefreshNonce((nonce) => nonce + 1), []);

  /**
   * Load the next page. Only the verbatim-query path pages (`jira.search`
   * supports `startAt`; preset lists fetch one bounded window). Appends
   * deduped by composed identity — a reloaded overlapping page never
   * duplicates or misattributes a card, and selection survives by identity.
   */
  const canLoadMore = appliedQuery.trim().length > 0 && !coverage.complete;
  const loadMore = useCallback(() => {
    if (!canLoadMore || loading) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    requestNonceRef.current += 1;
    const requestId = `jira-kanban-${requestNonceRef.current}`;
    void bridge
      .jiraSearchIssues({
        jql: appliedQuery.trim(),
        limit: JIRA_ITEM_LIMIT,
        startAt: issues.length,
        siteId,
        requestId,
      })
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          // Keep the previously loaded issues on screen and say so: a page
          // failure must not masquerade as the full set.
          setError(result.error.message);
          setStaleData(true);
          setLoading(false);
          return;
        }
        const known = new Set(issues.map(getJiraIssueIdentity));
        const appended = result.result.issues.filter(
          (issue) => !known.has(getJiraIssueIdentity(issue)),
        );
        const merged = [...issues, ...appended];
        setIssues(merged);
        setCoverage(
          buildJiraBoardCoverage({
            loadedCount: merged.length,
            total: result.result.total ?? null,
            isLast: result.result.isLast ?? null,
          }),
        );
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStaleData(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedQuery, bridge, canLoadMore, issues, loading, siteId]);

  // Client-side card filter over the loaded set (search-style narrowing).
  const [cardFilter, setCardFilter] = useState("");
  const renderedIssues = useMemo(() => {
    const needle = cardFilter.trim().toLowerCase();
    if (!needle) return issues;
    return issues.filter(
      (issue) =>
        issue.key.toLowerCase().includes(needle) ||
        issue.title.toLowerCase().includes(needle),
    );
  }, [issues, cardFilter]);

  const lanes = useMemo(
    () => buildJiraKanbanLanes(renderedIssues),
    [renderedIssues],
  );

  const selection = useJiraKanbanSelection(issues, renderedIssues);

  // --- transitions -----------------------------------------------------------

  const fetchTransitions = useCallback(
    (issue: JiraIssue): void => {
      const identity = getJiraIssueIdentity(issue);
      setLoadingTransitions((current) => {
        if (current.has(identity)) return current;
        const next = new Set(current);
        next.add(identity);
        return next;
      });
      void bridge
        .jiraListTransitions({
          key: issue.key,
          siteId: issue.siteId ?? undefined,
        })
        .then((result) => {
          const transitions = result.ok ? result.result : [];
          setTransitionsByIdentity((current) => {
            const next = new Map(current);
            next.set(identity, transitions);
            return next;
          });
        })
        .catch(() => {
          // The daemon already degrades failures to []; a transport error
          // lands the same way: no transitions, honestly.
          setTransitionsByIdentity((current) => {
            const next = new Map(current);
            next.set(identity, []);
            return next;
          });
        })
        .finally(() => {
          setLoadingTransitions((current) => {
            const next = new Set(current);
            next.delete(identity);
            return next;
          });
        });
    },
    [bridge],
  );

  /** The transitions offered for one issue, fetching on first need. */
  const getTransitions = useCallback(
    (issue: JiraIssue): JiraTransition[] | null => {
      const identity = getJiraIssueIdentity(issue);
      const known = transitionsByIdentity.get(identity);
      if (known !== undefined) return known;
      if (!loadingTransitions.has(identity)) {
        fetchTransitions(issue);
      }
      return null;
    },
    [transitionsByIdentity, loadingTransitions, fetchTransitions],
  );

  const invalidateTransitions = useCallback((identity: string): void => {
    setTransitionsByIdentity((current) => {
      if (!current.has(identity)) return current;
      const next = new Map(current);
      next.delete(identity);
      return next;
    });
  }, []);

  // --- moves -----------------------------------------------------------------

  /** Adopt the server's truth for one issue (identity-keyed patch). */
  const patchIssueFromServer = useCallback((fresh: JiraIssue): void => {
    const identity = getJiraIssueIdentity(fresh);
    setIssues((current) =>
      current.map((issue) =>
        getJiraIssueIdentity(issue) === identity ? fresh : issue,
      ),
    );
  }, []);

  const confirmWithServer = useCallback(
    (pending: JiraPendingMove, issue: JiraIssue): void => {
      void bridge
        .jiraGetIssue({ key: issue.key, siteId: issue.siteId ?? undefined })
        .then((result) => {
          if (!result.ok || result.result === null) {
            // Confirmation itself failed: keep the honest pending overlay
            // with a retry; never claim success or failure.
            setNotice({
              identity: pending.identity,
              tone: "blocked",
              message:
                "Could not confirm the move with Jira. Retry confirmation from the card.",
            });
            return;
          }
          const reconciliation = reconcileJiraMove(pending, result.result);
          patchIssueFromServer(reconciliation.issue);
          setPendingByIdentity((current) => {
            const next = new Map(current);
            next.delete(pending.identity);
            return next;
          });
          invalidateTransitions(pending.identity);
          if (reconciliation.kind === "not-applied") {
            setNotice({
              identity: pending.identity,
              tone: "blocked",
              message: `Jira still shows this issue in ${reconciliation.issue.status.name}. The move did not land — retry from the card menu if intended.`,
            });
          } else if (reconciliation.kind === "superseded") {
            setNotice({
              identity: pending.identity,
              tone: "info",
              message: `Jira moved this issue to ${reconciliation.issue.status.name} meanwhile — showing the server's status.`,
            });
          }
        })
        .catch(() => {
          setNotice({
            identity: pending.identity,
            tone: "blocked",
            message:
              "Could not reach Jira to confirm the move. Retry confirmation from the card.",
          });
        });
    },
    [bridge, invalidateTransitions, patchIssueFromServer],
  );

  const executePlan = useCallback(
    (issue: JiraIssue, plan: JiraTransitionPlan): void => {
      const identity = getJiraIssueIdentity(issue);
      if (pendingByIdentity.has(identity)) {
        // An unresolved move already owns this issue: no second POST.
        setNotice({
          identity,
          tone: "blocked",
          message:
            "A move for this issue is still pending. Wait for it to settle.",
        });
        return;
      }
      const pending: JiraPendingMove = {
        identity,
        transitionId: plan.transitionId,
        transitionName: plan.transitionName,
        targetStatusId: plan.targetStatus.id,
        originStatusId: issue.status.id,
        state: "in-flight",
      };
      setPendingByIdentity((current) => {
        if (current.has(identity)) {
          // Updater-level guard: the snapshot above cannot race a same-tick
          // move into a duplicate POST.
          return current;
        }
        const next = new Map(current);
        next.set(identity, pending);
        return next;
      });
      void bridge
        .jiraUpdateIssue({
          key: issue.key,
          siteId: issue.siteId ?? undefined,
          transitionId: plan.transitionId,
        })
        .then((result) => {
          const verdict = classifyJiraMoveResult(result);
          if (verdict.kind === "applied") {
            setPendingByIdentity((current) => {
              const next = new Map(current);
              next.delete(identity);
              return next;
            });
            invalidateTransitions(identity);
            // The optimistic overlay drops only into a fresh server read.
            void bridge
              .jiraGetIssue({
                key: issue.key,
                siteId: issue.siteId ?? undefined,
              })
              .then((fresh) => {
                if (fresh.ok && fresh.result) {
                  patchIssueFromServer(fresh.result);
                }
              })
              .catch(() => {});
            return;
          }
          if (verdict.kind === "rejected") {
            setPendingByIdentity((current) => {
              const next = new Map(current);
              next.delete(identity);
              return next;
            });
            invalidateTransitions(identity);
            setNotice({ identity, tone: "blocked", message: verdict.reason });
            return;
          }
          // Uncertain: the POST may have landed. Keep the overlay and
          // reconcile against the server before anything else.
          setPendingByIdentity((current) => {
            const next = new Map(current);
            next.set(identity, {
              ...pending,
              state: "awaiting-reconciliation",
            });
            return next;
          });
          confirmWithServer(
            { ...pending, state: "awaiting-reconciliation" },
            issue,
          );
        })
        .catch(() => {
          // Transport-level throw without a Result envelope: uncertain.
          setPendingByIdentity((current) => {
            const next = new Map(current);
            next.set(identity, {
              ...pending,
              state: "awaiting-reconciliation",
            });
            return next;
          });
          confirmWithServer(
            { ...pending, state: "awaiting-reconciliation" },
            issue,
          );
        });
    },
    [
      bridge,
      confirmWithServer,
      invalidateTransitions,
      patchIssueFromServer,
      pendingByIdentity,
    ],
  );

  /** Plan (or refuse) a move, then post it. Blocked reasons are surfaced,
   *  never guessed around. A request that arrives before the transitions
   *  load is queued, not dropped. */
  const moveIssue = useCallback(
    (issue: JiraIssue, target: JiraMoveTarget): void => {
      const identity = getJiraIssueIdentity(issue);
      const available = getTransitions(issue);
      if (available === null) {
        setDeferredMoves((current) => {
          if (current.has(identity)) return current;
          const next = new Map(current);
          next.set(identity, { issue, target });
          return next;
        });
        setNotice({
          identity,
          tone: "info",
          message:
            "Loading this issue's transitions from Jira — the move will run when they arrive.",
        });
        return;
      }
      const plan = planJiraMove({
        issue,
        availableTransitions: available,
        target,
      });
      if (!plan.ok) {
        setNotice({
          identity,
          tone: "blocked",
          message: describeJiraBlockedReason(plan.reason, available),
        });
        return;
      }
      executePlan(issue, plan.plan);
    },
    [executePlan, getTransitions],
  );

  // Run deferred moves whose transitions have since arrived, with the fresh
  // closures of this render (never the stale ones the request came from).
  useEffect(() => {
    if (deferredMoves.size === 0) {
      return;
    }
    for (const [identity, move] of deferredMoves) {
      const available = transitionsByIdentity.get(identity);
      if (available === undefined) {
        continue; // still loading — the effect reruns when they arrive
      }
      setDeferredMoves((current) => {
        if (!current.has(identity)) return current;
        const next = new Map(current);
        next.delete(identity);
        return next;
      });
      const plan = planJiraMove({
        issue: move.issue,
        availableTransitions: available,
        target: move.target,
      });
      if (!plan.ok) {
        setNotice({
          identity,
          tone: "blocked",
          message: describeJiraBlockedReason(plan.reason, available),
        });
        continue;
      }
      executePlan(move.issue, plan.plan);
    }
  }, [deferredMoves, executePlan, transitionsByIdentity]);

  /** Lane drop: move to the lane's real status id. Ambiguity (several
   *  transitions reach it) is refused with the menu as the resolution. */
  const moveIssueToLane = useCallback(
    (issue: JiraIssue, laneIdentity: string): void => {
      const lane = findJiraLaneByIdentity(lanes, laneIdentity);
      if (!lane) {
        return;
      }
      moveIssue(issue, { kind: "status", statusId: lane.statusId });
    },
    [lanes, moveIssue],
  );

  /** Explicit menu action: run one exact transition id. */
  const runTransition = useCallback(
    (issue: JiraIssue, transitionId: string): void => {
      moveIssue(issue, { kind: "transition", transitionId });
    },
    [moveIssue],
  );

  const retryReconciliation = useCallback(
    (issue: JiraIssue): void => {
      const identity = getJiraIssueIdentity(issue);
      const pending = pendingByIdentity.get(identity);
      if (!pending || pending.state !== "awaiting-reconciliation") {
        return;
      }
      confirmWithServer(pending, issue);
    },
    [confirmWithServer, pendingByIdentity],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  // --- sessions + local assignment slot ---------------------------------------

  /** Open the issue's linked session: `jira.startIssue` (idempotent — it
   *  returns the existing worktree) through the board's project context. */
  const openSession = useCallback(
    (issue: JiraIssue): void => {
      if (!startIssueProjectId) {
        setNotice({
          identity: getJiraIssueIdentity(issue),
          tone: "blocked",
          message: "Select a project to open this issue's session.",
        });
        return;
      }
      const identity = getJiraIssueIdentity(issue);
      setOpeningSessionIdentity(identity);
      void bridge
        .jiraStartIssue({
          projectId: startIssueProjectId,
          key: issue.key,
          siteId: issue.siteId ?? undefined,
          title: issue.title,
        })
        .then((result) => {
          if (result.ok) {
            onSessionOpened?.(issue, result.result);
          } else {
            setNotice({
              identity,
              tone: "blocked",
              message: result.error.message,
            });
          }
        })
        .catch((cause: unknown) => {
          setNotice({
            identity,
            tone: "blocked",
            message: cause instanceof Error ? cause.message : String(cause),
          });
        })
        .finally(() => setOpeningSessionIdentity(null));
    },
    [bridge, onSessionOpened, startIssueProjectId],
  );

  const coverageLine = describeJiraBoardCoverage(coverage);
  const filterLine =
    cardFilter.trim().length > 0
      ? `${renderedIssues.length} of ${issues.length} loaded issues match the filter.`
      : null;

  return {
    // data
    issues,
    renderedIssues,
    lanes,
    loading,
    error,
    staleData,
    coverageLine,
    filterLine,
    refresh,
    canLoadMore,
    loadMore,
    preset,
    setPreset,
    queryInput,
    setQueryInput,
    cardFilter,
    setCardFilter,
    // transitions + moves
    getTransitions,
    pendingByIdentity,
    moveIssueToLane,
    runTransition,
    retryReconciliation,
    notice,
    dismissNotice,
    // selection
    ...selection,
    // sessions
    openingSessionIdentity,
    openSession,
  };
}

export type JiraKanbanBoardController = ReturnType<typeof useJiraKanbanBoard>;
export type { JiraBlockedReason };
