// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/JiraIssueWorkspace.tsx — hydration, comments,
// transitions/priorities/users loading, optimistic mutations with rollback,
// and the comment submit path are the fork's; the zustand store maps to
// props (bridge, onPatched), the app store's patchJiraIssue has no Drogon
// counterpart (list owners refresh from the daemon), and CommentMarkdown
// maps to JiraMarkdown.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { VisuallyHidden } from "radix-ui";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "../../../components/ui/sheet";
import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText,
} from "./comment-body-submit-state";
import type {
  JiraBridge,
  JiraComment,
  JiraIssue,
  JiraIssueUpdate,
  JiraPriority,
  JiraTransition,
  JiraUser,
} from "../../../../../shared/jira-contract";
import { JiraIssueMetadataBar, JiraIssueWorkspaceHeader } from "./jira-issue-workspace-chrome";
import {
  JiraIssueCommentComposer,
  JiraIssueWorkspaceContent,
} from "./jira-issue-workspace-content";
import { getJiraIssueWorkspaceActions } from "./jira-issue-workspace-actions";

type JiraIssueWorkspaceProps = {
  issue: JiraIssue | null;
  onUse: (issue: JiraIssue) => void;
  onClose: () => void;
  bridge: JiraBridge;
  siteId?: string | null;
  openUrl: (url: string) => Promise<unknown> | unknown;
  writeClipboardText: (text: string) => Promise<unknown> | unknown;
  /** Called after a successful mutation re-read so list owners can refresh. */
  onPatched?: (issue: JiraIssue) => void;
};

export default function JiraIssueWorkspace({
  issue,
  onUse,
  onClose,
  bridge,
  siteId,
  openUrl,
  writeClipboardText,
  onPatched,
}: JiraIssueWorkspaceProps): React.JSX.Element {
  const [fullIssue, setFullIssue] = useState<JiraIssue | null>(null);
  const [issueLoading, setIssueLoading] = useState(false);
  const [comments, setComments] = useState<JiraComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<JiraTransition[]>([]);
  const [priorities, setPriorities] = useState<JiraPriority[]>([]);
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [pendingField, setPendingField] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [labelsDraft, setLabelsDraft] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const requestIdRef = useRef(0);
  const optimisticCommentsRef = useRef<JiraComment[]>([]);

  const displayed = fullIssue ?? issue;
  const siteIdArg = displayed?.siteId ?? siteId ?? undefined;

  const loadComments = useCallback(
    async (targetIssue: JiraIssue, requestId: number): Promise<void> => {
      setCommentsLoading(true);
      setCommentsError(null);
      try {
        const result = await bridge.jiraComments({
          key: targetIssue.key,
          siteId: targetIssue.siteId,
        });
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        let fetched = result.result;
        const optimistic = optimisticCommentsRef.current;
        if (optimistic.length > 0) {
          const fetchedIds = new Set(fetched.map((comment) => comment.id));
          fetched = [
            ...fetched,
            ...optimistic.filter((comment) => !fetchedIds.has(comment.id)),
          ];
        }
        setComments(fetched);
      } catch (error) {
        if (requestId === requestIdRef.current) {
          setCommentsError(
            error instanceof Error ? error.message : "Failed to load comments.",
          );
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setCommentsLoading(false);
        }
      }
    },
    [bridge],
  );

  useEffect(() => {
    if (!issue) {
      setFullIssue(null);
      setIssueLoading(false);
      setComments([]);
      setCommentsError(null);
      setTransitions([]);
      setPriorities([]);
      setUsers([]);
      setCommentDraft("");
      optimisticCommentsRef.current = [];
      return;
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    optimisticCommentsRef.current = [];
    setFullIssue(issue);
    setTitleDraft(issue.title);
    setLabelsDraft(issue.labels.join(", "));
    setComments([]);
    setCommentsError(null);
    setIssueLoading(true);

    void bridge
      .jiraGetIssue({ key: issue.key, siteId: issue.siteId })
      .then((result) => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (result.ok && result.result) {
          setFullIssue(result.result);
          setTitleDraft(result.result.title);
          setLabelsDraft(result.result.labels.join(", "));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setIssueLoading(false);
        }
      });

    void Promise.all([
      bridge.jiraListTransitions({ key: issue.key, siteId: issue.siteId }),
      bridge.jiraListPriorities({ siteId: issue.siteId }),
      bridge.jiraSearchUsers({ siteId: issue.siteId }),
    ])
      .then(([transitionsResult, prioritiesResult, usersResult]) => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        if (transitionsResult.ok) {
          setTransitions(transitionsResult.result);
        }
        if (prioritiesResult.ok) {
          setPriorities(prioritiesResult.result);
        }
        if (usersResult.ok) {
          setUsers(usersResult.result);
        }
      })
      .catch(() => {});

    void loadComments(issue, requestId);
  }, [issue, bridge, loadComments]);

  const refreshIssue = useCallback(async (): Promise<void> => {
    if (!displayed) {
      return;
    }
    try {
      const latest = await bridge.jiraGetIssue({
        key: displayed.key,
        siteId: displayed.siteId,
      });
      if (latest.ok && latest.result) {
        setFullIssue(latest.result);
        onPatched?.(latest.result);
      }
    } catch {
      // Keep the visible issue snapshot if refresh fails.
    }
  }, [bridge, displayed, onPatched]);

  const mutateIssue = useCallback(
    async (
      field: string,
      updates: JiraIssueUpdate,
      optimistic?: Partial<JiraIssue>,
    ): Promise<void> => {
      if (!displayed || pendingField) {
        return;
      }
      setPendingField(field);
      const previous = displayed;
      try {
        if (optimistic) {
          setFullIssue({ ...displayed, ...optimistic });
        }
        const result = await bridge.jiraUpdateIssue({
          key: displayed.key,
          siteId: siteIdArg,
          ...updates,
        });
        if (!result.ok) {
          throw new Error(result.error.message);
        }
        if (!result.result.ok) {
          throw new Error(result.result.error);
        }
        await refreshIssue();
      } catch (error) {
        setFullIssue(previous);
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to update Jira issue.",
        );
      } finally {
        setPendingField(null);
      }
    },
    [bridge, displayed, pendingField, refreshIssue, siteIdArg],
  );

  const handleSaveTitle = useCallback(() => {
    if (!displayed) {
      return;
    }
    const title = titleDraft.trim();
    if (!title || title === displayed.title) {
      setTitleDraft(displayed.title);
      return;
    }
    void mutateIssue("title", { title }, { title });
  }, [displayed, mutateIssue, titleDraft]);

  const handleSaveLabels = useCallback(() => {
    if (!displayed) {
      return;
    }
    const labels = labelsDraft
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    void mutateIssue("labels", { labels }, { labels });
  }, [displayed, labelsDraft, mutateIssue]);

  const handleSubmitComment = useCallback(async (): Promise<void> => {
    if (!displayed || commentSubmitting) {
      return;
    }
    const bodyState = getCommentBodySubmitState(commentDraft);
    if (bodyState.status === "empty") {
      return;
    }
    if (bodyState.status === "too-large-leading-whitespace") {
      toast.error("Comment is too large to submit safely.");
      return;
    }
    setCommentSubmitting(true);
    try {
      const result = await bridge.jiraAddComment({
        key: displayed.key,
        body: bodyState.body,
        siteId: displayed.siteId,
      });
      if (!result.ok) {
        throw new Error(result.error.message);
      }
      if (!result.result.ok) {
        throw new Error(result.result.error);
      }
      const comment: JiraComment = {
        id: result.result.id ?? `local-${Date.now()}`,
        body: bodyState.body,
        createdAt: new Date().toISOString(),
        user: { accountId: "local", displayName: "You" },
      };
      optimisticCommentsRef.current.push(comment);
      setComments((prev) => [...prev, comment]);
      setCommentDraft("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add comment.",
      );
    } finally {
      setCommentSubmitting(false);
    }
  }, [bridge, commentDraft, commentSubmitting, displayed]);
  const canSubmitComment = hasBoundedCommentBodyText(commentDraft);

  const actionItems = useMemo(
    () =>
      displayed
        ? getJiraIssueWorkspaceActions(displayed, { openUrl, writeClipboardText })
        : [],
    [displayed, openUrl, writeClipboardText],
  );

  return (
    <Sheet open={issue !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-[min(92vw,780px)] p-0 sm:max-w-[780px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <VisuallyHidden.Root asChild>
          <SheetTitle>{displayed?.title ?? "Jira issue"}</SheetTitle>
        </VisuallyHidden.Root>
        <VisuallyHidden.Root asChild>
          <SheetDescription>
            Preview, edit, and start work from the selected issue.
          </SheetDescription>
        </VisuallyHidden.Root>

        {displayed ? (
          <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
            <JiraIssueWorkspaceHeader
              displayed={displayed}
              issueLoading={issueLoading}
              onUse={onUse}
              onClose={onClose}
            />

            <JiraIssueMetadataBar
              displayed={displayed}
              pendingField={pendingField}
              transitions={transitions}
              priorities={priorities}
              users={users}
              mutateIssue={mutateIssue}
            />

            <JiraIssueWorkspaceContent
              displayed={displayed}
              titleDraft={titleDraft}
              setTitleDraft={setTitleDraft}
              labelsDraft={labelsDraft}
              setLabelsDraft={setLabelsDraft}
              handleSaveTitle={handleSaveTitle}
              handleSaveLabels={handleSaveLabels}
              pendingField={pendingField}
              comments={comments}
              commentsError={commentsError}
              commentsLoading={commentsLoading}
              retryComments={() => void loadComments(displayed, requestIdRef.current)}
              onUse={onUse}
              actionItems={actionItems}
            />

            <JiraIssueCommentComposer
              commentDraft={commentDraft}
              setCommentDraft={setCommentDraft}
              commentSubmitting={commentSubmitting}
              canSubmitComment={canSubmitComment}
              handleSubmitComment={() => void handleSubmitComment()}
            />
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
