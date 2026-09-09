// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// use-task-page-jira-list-state.ts, use-task-page-jira-list-projection.ts,
// use-task-page-jira-list-effects.ts and the Jira arm of
// use-task-page-provider-metadata.ts — the state shape, the 300ms search
// debounce, the preset-vs-JQL fetch switch, the per-site priority loading,
// the selected-issue reconciliation and the projects fetch are the fork's.
// Data-layer adaptations: the zustand runtime client is this repo's
// JiraBridge (Result envelopes instead of thrown errors, so the daemon's
// error code is mapped onto the fork's "Error <status>:" message shape
// before the fork's load-state parser sees it); the fork's
// jira.getProjectStatusOrder RPC has no daemon counterpart (R17-A contract)
// so the list always renders with the fork's alphabetical section
// fallback; the resume-state settings RPC is localStorage
// (jira-task-resume-storage).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  JiraBridge,
  JiraIssue,
  JiraPriority,
  JiraProject,
} from "../../../../../shared/jira-contract";
import type { JiraPresetId } from "../task-page-localized-options";
import { JIRA_ITEM_LIMIT, TASK_SEARCH_DEBOUNCE_MS } from "../task-page-source-context";
import {
  readJiraTaskResumeState,
  writeJiraTaskResumeState,
} from "../jira-task-resume-storage";
import {
  createTaskPageJiraLoadFailureState,
  type TaskPageJiraLoadError,
} from "./jira-list-load-state";
import {
  sortJiraIssues,
  type JiraIssueSortColumn,
  type JiraIssueSortDirection,
  type JiraPrioritiesBySite,
} from "./jira-issue-sorter";
import type { TaskSource } from "../task-source-navigation";

/** Daemon Result error code → the HTTP status the fork's parser keys on. */
const JIRA_ERROR_CODE_STATUS: Record<string, number> = {
  jira_auth_required: 401,
  jira_forbidden: 403,
  jira_not_found: 404,
  jira_rate_limited: 429,
  jira_bad_request: 400,
};

/** Why: feed the fork's load-state parser the "Error <status>:" shape it
 *  extracts codes from, preserving the daemon's message as the details. */
function toForkErrorMessage(code: string, message: string): string {
  const status = JIRA_ERROR_CODE_STATUS[code];
  return status === undefined ? message : `Error ${status}: ${message}`;
}

export type UseJiraListStateArgs = {
  bridge: JiraBridge;
  taskSource: TaskSource;
  jiraConnected: boolean;
  /** The fork's selectedJiraSiteId ('all' or one site id). */
  selectedJiraSiteId: string | null;
};

export type JiraListState = {
  jiraIssues: JiraIssue[];
  jiraLoading: boolean;
  jiraError: TaskPageJiraLoadError | null;
  jiraErrorDetailsOpen: boolean;
  setJiraErrorDetailsOpen: (open: boolean) => void;
  jiraSearchInput: string;
  setJiraSearchInput: React.Dispatch<React.SetStateAction<string>>;
  appliedJiraSearch: string;
  setAppliedJiraSearch: React.Dispatch<React.SetStateAction<string>>;
  activeJiraPreset: JiraPresetId;
  setActiveJiraPreset: (preset: JiraPresetId) => void;
  handleRefreshJiraIssues: () => void;
  jiraOrderBy: JiraIssueSortColumn;
  jiraOrderDirection: JiraIssueSortDirection;
  handleJiraSort: (column: JiraIssueSortColumn) => void;
  sortedJiraIssues: JiraIssue[];
  availableJiraProjects: JiraProject[];
  jiraProjectsLoading: boolean;
  /** Persists the fork's resume fields (preset/query). */
  persistJiraResumeState: (state: { jiraPreset?: JiraPresetId; jiraQuery?: string }) => void;
  /** The fork's site-switch clear: issues drop immediately, the spinner
   *  shows, and the pending site switch's fetch repaints the list. */
  resetJiraList: () => void;
  /** Replaces one issue in the list after a workspace mutation re-read. */
  patchJiraIssue: (issue: JiraIssue) => void;
};

export function useJiraListState({
  bridge,
  taskSource,
  jiraConnected,
  selectedJiraSiteId,
}: UseJiraListStateArgs): JiraListState {
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([]);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState<TaskPageJiraLoadError | null>(null);
  const [jiraErrorDetailsOpen, setJiraErrorDetailsOpen] = useState(false);
  // The fork's resume restoration seeds the JQL box, the applied query and
  // the preset from the persisted resume state before the first fetch.
  const [resumeSeed] = useState(() => readJiraTaskResumeState());
  const [jiraSearchInput, setJiraSearchInput] = useState(
    () => resumeSeed?.jiraQuery ?? "",
  );
  const [appliedJiraSearch, setAppliedJiraSearch] = useState(
    () => resumeSeed?.jiraQuery ?? "",
  );
  const [activeJiraPreset, setActiveJiraPreset] = useState<JiraPresetId>(
    () => (resumeSeed?.jiraPreset as JiraPresetId | undefined) ?? "assigned",
  );
  const [jiraRefreshNonce, setJiraRefreshNonce] = useState(0);
  const [jiraOrderBy, setJiraOrderBy] = useState<JiraIssueSortColumn>("updated");
  const [jiraOrderDirection, setJiraOrderDirection] =
    useState<JiraIssueSortDirection>("desc");
  const [jiraPrioritiesBySite, setJiraPrioritiesBySite] =
    useState<JiraPrioritiesBySite>(() => new Map());
  const [availableJiraProjects, setAvailableJiraProjects] = useState<JiraProject[]>(
    [],
  );
  const [jiraProjectsLoading, setJiraProjectsLoading] = useState(false);
  const jiraSearchPersistReadyRef = useRef(false);
  const jiraRequestIdRef = useRef(0);

  const persistJiraResumeState = useCallback(
    (state: { jiraPreset?: JiraPresetId; jiraQuery?: string }) => {
      writeJiraTaskResumeState({
        jiraPreset: state.jiraPreset ?? activeJiraPreset,
        jiraQuery: state.jiraQuery ?? appliedJiraSearch.trim(),
      });
    },
    [activeJiraPreset, appliedJiraSearch],
  );

  // The fork's priority-sort effect: site schemes rank differently, so the
  // sorter needs each represented site's own priority list (errors → []).
  const jiraPrioritySiteIdsKey = useMemo(() => {
    const siteIds =
      selectedJiraSiteId && selectedJiraSiteId !== "all"
        ? [selectedJiraSiteId]
        : jiraIssues.flatMap((issue) => (issue.siteId ? [issue.siteId] : []));
    // Why: result refreshes replace the issue array; depend on the represented sites, not identity.
    return JSON.stringify([...new Set(siteIds)].sort());
  }, [jiraIssues, selectedJiraSiteId]);
  useEffect(() => {
    if (taskSource !== "jira" || !jiraConnected || jiraOrderBy !== "priority") {
      setJiraPrioritiesBySite((current) =>
        current.size === 0 ? current : new Map(),
      );
      return;
    }
    let cancelled = false;
    const jiraPrioritySiteIds = JSON.parse(jiraPrioritySiteIdsKey) as string[];
    void Promise.all(
      jiraPrioritySiteIds.map(async (siteId) => {
        try {
          const result = await bridge.jiraListPriorities({ siteId });
          return [siteId, result.ok ? result.result : []] as const;
        } catch {
          return [siteId, [] as JiraPriority[]] as const;
        }
      }),
    ).then((prioritiesBySite) => {
      if (!cancelled) {
        setJiraPrioritiesBySite(new Map(prioritiesBySite));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, jiraConnected, jiraOrderBy, jiraPrioritySiteIdsKey, taskSource]);

  const handleJiraSort = useCallback(
    (column: JiraIssueSortColumn) => {
      if (jiraOrderBy === column) {
        setJiraOrderDirection((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
      } else {
        setJiraOrderBy(column);
        setJiraOrderDirection(column === "updated" || column === "status" ? "desc" : "asc");
      }
    },
    [jiraOrderBy],
  );

  // The fork's search debounce: typing commits the draft query 300ms after
  // the last keystroke (the resume write below persists the applied value).
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAppliedJiraSearch(jiraSearchInput);
    }, TASK_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [jiraSearchInput]);

  useEffect(() => {
    if (!jiraSearchPersistReadyRef.current) {
      jiraSearchPersistReadyRef.current = true;
      return;
    }
    persistJiraResumeState({ jiraQuery: appliedJiraSearch.trim() });
  }, [appliedJiraSearch, persistJiraResumeState]);

  // The fork's list effect: a typed JQL query searches verbatim, an empty
  // box lists the active preset; a late response for an older window is
  // dropped, never rendered.
  useEffect(() => {
    if (taskSource !== "jira") {
      return;
    }
    if (!jiraConnected) {
      return;
    }
    let cancelled = false;
    setJiraLoading(true);
    setJiraError(null);
    setJiraErrorDetailsOpen(false);
    const trimmed = appliedJiraSearch.trim();
    jiraRequestIdRef.current += 1;
    const requestId = `tasks-jira-${jiraRequestIdRef.current}`;
    const siteId = selectedJiraSiteId && selectedJiraSiteId !== "all"
      ? selectedJiraSiteId
      : undefined;
    const request = trimmed.length > 0
      ? bridge.jiraSearchIssues({
          jql: trimmed,
          limit: JIRA_ITEM_LIMIT,
          siteId,
          requestId,
        })
      : bridge.jiraListIssues({
          filter: activeJiraPreset,
          limit: JIRA_ITEM_LIMIT,
          siteId,
          requestId,
        });
    void request
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          const failure = createTaskPageJiraLoadFailureState(
            new Error(toForkErrorMessage(result.error.code, result.error.message)),
          );
          setJiraIssues(failure.issues);
          setJiraError(failure.error);
          setJiraLoading(false);
          return;
        }
        setJiraIssues(result.result.issues);
        setJiraLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const failureState = createTaskPageJiraLoadFailureState(error);
        setJiraIssues(failureState.issues);
        setJiraError(failureState.error);
        setJiraLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    bridge,
    taskSource,
    jiraConnected,
    selectedJiraSiteId,
    appliedJiraSearch,
    activeJiraPreset,
    jiraRefreshNonce,
  ]);

  // The provider-metadata effect: the full project list feeds the create
  // button's disabled/loading state and the dialog's default project.
  useEffect(() => {
    if (taskSource !== "jira" || !jiraConnected) {
      setAvailableJiraProjects([]);
      setJiraProjectsLoading(false);
      return;
    }
    let cancelled = false;
    setAvailableJiraProjects([]);
    setJiraProjectsLoading(true);
    const siteId = selectedJiraSiteId && selectedJiraSiteId !== "all"
      ? selectedJiraSiteId
      : undefined;
    void bridge
      .jiraListProjects({ siteId })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setAvailableJiraProjects(result.result);
        } else {
          console.warn("[TaskPage] Failed to fetch Jira projects");
        }
      })
      .catch(() => {
        if (!cancelled) {
          console.warn("[TaskPage] Failed to fetch Jira projects");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setJiraProjectsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, taskSource, jiraConnected, selectedJiraSiteId, jiraRefreshNonce]);

  // Why: the fork's sortJiraIssues projection — status sorts client-side via
  // the section grouping, so the comparator stays a stable no-op there.
  const sortedJiraIssues = useMemo(() => {
    return sortJiraIssues(jiraIssues, jiraOrderBy, jiraOrderDirection, jiraPrioritiesBySite);
  }, [jiraIssues, jiraOrderBy, jiraOrderDirection, jiraPrioritiesBySite]);

  const handleRefreshJiraIssues = useCallback(() => {
    setJiraRefreshNonce((nonce) => nonce + 1);
  }, []);

  const resetJiraList = useCallback(() => {
    setJiraIssues([]);
    setJiraError(null);
    setJiraErrorDetailsOpen(false);
    setJiraLoading(true);
  }, []);

  const patchJiraIssue = useCallback((issue: JiraIssue) => {
    setJiraIssues((current) =>
      current.map((existing) =>
        existing.key === issue.key &&
        (!existing.siteId || !issue.siteId || existing.siteId === issue.siteId)
          ? issue
          : existing,
      ),
    );
  }, []);

  return {
    jiraIssues,
    jiraLoading,
    jiraError,
    jiraErrorDetailsOpen,
    setJiraErrorDetailsOpen,
    jiraSearchInput,
    setJiraSearchInput,
    appliedJiraSearch,
    setAppliedJiraSearch,
    activeJiraPreset,
    setActiveJiraPreset,
    handleRefreshJiraIssues,
    jiraOrderBy,
    jiraOrderDirection,
    handleJiraSort,
    sortedJiraIssues,
    availableJiraProjects,
    jiraProjectsLoading,
    persistJiraResumeState,
    resetJiraList,
    patchJiraIssue,
  };
}
