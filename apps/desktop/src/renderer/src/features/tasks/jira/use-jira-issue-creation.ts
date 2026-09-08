// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/use-task-page-jira-creation-state.ts,
// use-task-page-jira-creation-metadata.ts and
// use-task-page-jira-issue-creation.ts — the behavior, effects and copy are
// the fork's; the state lives in one hook instead of the source's
// model-spread chain, and the runtime client is this repo's JiraBridge.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  JiraBridge,
  JiraCreateField,
  JiraIssue,
  JiraIssueType,
  JiraProject,
} from "../../../../../shared/jira-contract";
import {
  buildJiraCreateCustomFields,
  getJiraUserCreateFieldKeys,
  isVisibleJiraCreateField,
} from "./jira-create-fields";
import {
  compareJiraProjectsByDisplayLabel,
  getJiraProjectSelectionKey,
} from "./jira-project-selection";
import { filterJiraProjectPickerProjects } from "./jira-project-picker-filter";

export type JiraIssueCreationDialogProps = {
  bridge: JiraBridge;
  /** The fork's jiraConnected gate: metadata loads only when connected. */
  connected: boolean;
  /** Explicit site selection (the fork's jiraTaskSourceContext ?? settings). */
  siteId?: string | null;
  /**
   * Called with the created issue after the fork's post-create re-read
   * (the fork inserts the row into the list cache and selects it).
   */
  onCreated?: (issue: JiraIssue) => void;
};

export function useJiraIssueCreationDialog({
  bridge,
  connected,
  siteId,
  onCreated,
}: JiraIssueCreationDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Project combobox state (the fork's newJiraIssueProject* slice).
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectComboboxOpen, setProjectComboboxOpen] = useState(false);
  const [projectCommandValue, setProjectCommandValue] = useState("");
  const [targetProjectKey, setTargetProjectKey] = useState<string | null>(null);
  const projectSearchInputRef = useRef<HTMLInputElement | null>(null);

  // Issue type + create-field state.
  const [availableIssueTypes, setAvailableIssueTypes] = useState<JiraIssueType[]>([]);
  const [issueTypesLoading, setIssueTypesLoading] = useState(false);
  const [targetTypeId, setTargetTypeId] = useState<string | null>(null);
  const [createFields, setCreateFields] = useState<JiraCreateField[]>([]);
  const [createFieldsLoading, setCreateFieldsLoading] = useState(false);
  const [createFieldsError, setCreateFieldsError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});

  const siteIdArg = siteId ?? undefined;

  // Projects load once per open (the fork's listProjects effect).
  useEffect(() => {
    if (!open || !connected) {
      return;
    }
    let cancelled = false;
    setProjectsLoading(true);
    void bridge
      .jiraListProjects({ siteId: siteIdArg })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setProjects(result.result);
        } else {
          toast.error(result.error.message);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, connected, bridge, siteIdArg]);

  const includeSiteNameInProjectLabel = useMemo(
    () => new Set(projects.map((project) => project.siteId)).size > 1,
    [projects],
  );

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => compareJiraProjectsByDisplayLabel(a, b, includeSiteNameInProjectLabel)),
    [projects, includeSiteNameInProjectLabel],
  );

  const filteredProjects = useMemo(
    () =>
      filterJiraProjectPickerProjects({
        projects: sortedProjects,
        query: projectQuery,
        includeSiteName: includeSiteNameInProjectLabel,
      }),
    [sortedProjects, projectQuery, includeSiteNameInProjectLabel],
  );

  const targetProject = useMemo(
    () =>
      sortedProjects.find(
        (project) => getJiraProjectSelectionKey(project) === targetProjectKey,
      ) ??
      sortedProjects[0] ??
      null,
    [sortedProjects, targetProjectKey],
  );

  // Why: reset the project query when the popover opens so a stale search
  // never hides the just-picked project (the fork's open-change handler).
  const handleProjectComboboxOpenChange = useCallback((next: boolean) => {
    setProjectComboboxOpen(next);
    if (next) {
      setProjectQuery("");
      setProjectCommandValue("");
    }
  }, []);

  const handleProjectSelect = useCallback(
    (selectionKey: string) => {
      setTargetProjectKey(selectionKey);
      setProjectComboboxOpen(false);
    },
    [],
  );

  const handleProjectTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Why: ArrowDown from the trigger moves focus into the search input
      // exactly like the source's combobox behavior.
      if (event.key === "ArrowDown") {
        event.preventDefault();
        projectSearchInputRef.current?.focus();
      }
    },
    [],
  );

  const targetType = useMemo(
    () =>
      availableIssueTypes.find((type) => type.id === targetTypeId) ??
      availableIssueTypes[0] ??
      null,
    [availableIssueTypes, targetTypeId],
  );

  // The fork's creation-metadata effect: issue types per selected project.
  useEffect(() => {
    if (!open || !connected || !targetProject) {
      setAvailableIssueTypes([]);
      setIssueTypesLoading(false);
      return;
    }
    let cancelled = false;
    setAvailableIssueTypes([]);
    setIssueTypesLoading(true);
    void bridge
      .jiraListIssueTypes({
        projectIdOrKey: targetProject.id,
        siteId: targetProject.siteId,
      })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setAvailableIssueTypes(result.result);
          setTargetTypeId(result.result[0]?.id ?? null);
        } else {
          toast.error("Failed to load Jira issue types.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Failed to load Jira issue types.");
        }
      })
      .finally(() => {
        if (!cancelled) setIssueTypesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, connected, targetProject, bridge]);

  // The fork's create-fields effect: scoped to project + issue type, with
  // late responses ignored after either selector switches.
  useEffect(() => {
    if (!open || !connected || !targetProject || !targetType) {
      setCreateFields([]);
      setCreateFieldsLoading(false);
      setCreateFieldsError(null);
      setCustomFieldValues({});
      return;
    }
    let cancelled = false;
    setCreateFields([]);
    setCreateFieldsLoading(true);
    setCreateFieldsError(null);
    setCustomFieldValues({});
    void bridge
      .jiraListCreateFields({
        projectIdOrKey: targetProject.id,
        issueTypeId: targetType.id,
        siteId: targetProject.siteId,
      })
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setCreateFields(result.result);
        } else {
          setCreateFieldsError("Failed to load required Jira fields.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCreateFieldsError("Failed to load required Jira fields.");
        }
      })
      .finally(() => {
        if (!cancelled) setCreateFieldsLoading(false);
      });
    return () => {
      // Why: create fields are scoped to project + issue type; ignore late
      // responses after switching either selector.
      cancelled = true;
    };
  }, [open, connected, targetProject, targetType, bridge]);

  const visibleCreateFields = useMemo(
    () => createFields.filter(isVisibleJiraCreateField),
    [createFields],
  );

  // Why: the fork renders every visible field as text/select input, so the
  // missing check is values-only (user fields block create until typed).
  const hasMissingJiraCreateField = useMemo(
    () =>
      visibleCreateFields.some(
        (field) => !(customFieldValues[field.key] ?? "").trim(),
      ),
    [visibleCreateFields, customFieldValues],
  );

  // The fork's handleCreateNewJiraIssue.
  const handleCreate = useCallback(async (): Promise<void> => {
    if (!targetProject || !targetType) {
      return;
    }
    const trimmedTitle = title.trim();
    if (!trimmedTitle || submitting || hasMissingJiraCreateField || createFieldsLoading) {
      return;
    }
    const customFields = buildJiraCreateCustomFields(
      visibleCreateFields,
      customFieldValues,
    );
    const userFieldKeys = getJiraUserCreateFieldKeys(visibleCreateFields);
    setSubmitting(true);
    try {
      const result = await bridge.jiraCreateIssue({
        siteId: targetProject.siteId,
        projectId: targetProject.id,
        issueTypeId: targetType.id,
        title: trimmedTitle,
        description: body || undefined,
        customFields,
        userFieldKeys,
      });
      if (!result.ok) {
        toast.error(result.error.message);
        return;
      }
      const created = result.result;
      if (!created.ok) {
        toast.error(created.error || "Failed to create Jira issue.");
        return;
      }
      toast.success(`Created ${created.key}`, {
        action: created.url
          ? {
              label: "View",
              onClick: () => window.open(created.url, "_blank"),
            }
          : undefined,
      });
      setOpen(false);
      setTitle("");
      setBody("");
      setCustomFieldValues({});
      // The fork re-reads the issue and inserts it into the list cache so
      // the inspector stays open; a failed re-read never breaks the create.
      void bridge
        .jiraGetIssue({ key: created.key, siteId: targetProject.siteId })
        .then((full) => {
          if (full.ok && full.result) {
            onCreated?.(full.result);
          }
        })
        .catch(() => {});
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create Jira issue.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    bridge,
    body,
    customFieldValues,
    createFieldsLoading,
    hasMissingJiraCreateField,
    onCreated,
    submitting,
    targetProject,
    targetType,
    title,
    visibleCreateFields,
  ]);

  return {
    open,
    setOpen,
    title,
    setTitle,
    body,
    setBody,
    submitting,
    projectsLoading,
    includeSiteNameInProjectLabel,
    sortedProjects,
    filteredProjects,
    projectQuery,
    setProjectQuery,
    projectComboboxOpen,
    handleProjectComboboxOpenChange,
    projectCommandValue,
    setProjectCommandValue,
    targetProject,
    targetProjectKey,
    handleProjectSelect,
    handleProjectTriggerKeyDown,
    projectSearchInputRef,
    availableIssueTypes,
    issueTypesLoading,
    targetTypeId,
    setTargetTypeId,
    targetType,
    createFieldsLoading,
    createFieldsError,
    visibleCreateFields,
    hasMissingJiraCreateField,
    customFieldValues,
    setCustomFieldValues,
    handleCreate,
  };
}

export type JiraIssueCreationDialogState = ReturnType<
  typeof useJiraIssueCreationDialog
>;
