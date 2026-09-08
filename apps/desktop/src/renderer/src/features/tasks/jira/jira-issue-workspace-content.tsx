// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/jira-issue-workspace-content.tsx — title and
// labels editors, description section, comments list, action rail and the
// comment composer are verbatim DOM/classes/copy; CommentMarkdown maps to
// this directory's JiraMarkdown (the daemon renders ADF→markdown), and the
// Jira product mark is the fork's flattened icon.
import type { LucideIcon } from "lucide-react";
import { ArrowRight, LoaderCircle, RefreshCw, Save, Send } from "lucide-react";
import { JiraMarkdown } from "./jira-markdown";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { formatUiRelativeTimeFromDate } from "../task-page-source-context";
import type { JiraComment, JiraIssue } from "../../../../../shared/jira-contract";

export type JiraIssueWorkspaceAction = {
  label: string;
  icon: LucideIcon;
  action: () => void;
};

export function JiraIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 -30.632388516510233 255.324 285.95638851651023"
      aria-hidden
      className={className}
      fill="currentColor"
    >
      {/* Why: flatten the official Jira product mark so it matches the
      monochrome provider icons instead of rendering as a branded tile. */}
      <path d="M244.658 0H121.707a55.502 55.502 0 0 0 55.502 55.502h22.649V77.37c.02 30.625 24.841 55.447 55.466 55.467V10.666C255.324 4.777 250.55 0 244.658 0z" />
      <path d="M183.822 61.262H60.872c.019 30.625 24.84 55.447 55.466 55.467h22.649v21.938c.039 30.625 24.877 55.43 55.502 55.43V71.93c0-5.891-4.776-10.667-10.667-10.667z" />
      <path d="M122.951 122.489H0c0 30.653 24.85 55.502 55.502 55.502h22.72v21.867c.02 30.597 24.798 55.408 55.396 55.466V133.156c0-5.891-4.776-10.667-10.667-10.667z" />
    </svg>
  );
}

export function JiraIssueWorkspaceContent({
  displayed,
  titleDraft,
  setTitleDraft,
  labelsDraft,
  setLabelsDraft,
  handleSaveTitle,
  handleSaveLabels,
  pendingField,
  comments,
  commentsError,
  commentsLoading,
  retryComments,
  onUse,
  actionItems,
}: {
  displayed: JiraIssue;
  titleDraft: string;
  setTitleDraft: (value: string) => void;
  labelsDraft: string;
  setLabelsDraft: (value: string) => void;
  handleSaveTitle: () => void;
  handleSaveLabels: () => void;
  pendingField: string | null;
  comments: JiraComment[];
  commentsError: string | null;
  commentsLoading: boolean;
  retryComments: () => void;
  onUse: (issue: JiraIssue) => void;
  actionItems: JiraIssueWorkspaceAction[];
}): React.JSX.Element {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_228px]">
      <div className="min-h-0 overflow-y-auto scrollbar-sleek">
        <section className="border-b border-border/40 px-4 py-4">
          <div className="grid gap-2">
            <label className="text-[11px] font-medium text-muted-foreground">
              Title
            </label>
            <div className="flex gap-2">
              <Input
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    handleSaveTitle();
                  }
                }}
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveTitle}
                disabled={pendingField === "title"}
              >
                {pendingField === "title" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
              </Button>
            </div>
            <label className="mt-2 text-[11px] font-medium text-muted-foreground">
              Labels
            </label>
            <div className="flex gap-2">
              <Input
                value={labelsDraft}
                onChange={(event) => setLabelsDraft(event.target.value)}
                placeholder="backend, bug"
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveLabels}
                disabled={pendingField === "labels"}
              >
                {pendingField === "labels" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </section>

        <section className="border-b border-border/40 px-4 py-4">
          <div className="mb-2 flex items-center gap-2">
            <JiraIcon className="size-3 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">
              {displayed.issueType.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {displayed.project.key} ·{" "}
              {displayed.assignee?.displayName ?? "Unassigned"}
            </span>
          </div>
          {displayed.description?.trim() ? (
            <JiraMarkdown
              content={displayed.description}
              className="text-[14px] leading-relaxed"
            />
          ) : (
            <p className="text-sm italic text-muted-foreground">
              No description provided.
            </p>
          )}
        </section>

        <section className="px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-foreground">
                Comments
              </span>
              {comments.length > 0 ? (
                <span className="text-[12px] text-muted-foreground">
                  {comments.length}
                </span>
              ) : null}
            </div>
            {commentsError ? (
              <Button
                variant="outline"
                size="xs"
                onClick={retryComments}
                disabled={commentsLoading}
                className="gap-1"
              >
                {commentsLoading ? (
                  <LoaderCircle className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                Retry
              </Button>
            ) : null}
          </div>
          {commentsError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {commentsError}
            </div>
          ) : commentsLoading && comments.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className="rounded-md border border-border/50 bg-muted/20"
                >
                  <div className="flex min-w-0 items-center gap-2 border-b border-border/40 px-3 py-2">
                    {comment.user?.avatarUrl ? (
                      <img
                        src={comment.user.avatarUrl}
                        alt=""
                        className="size-5 shrink-0 rounded-full"
                      />
                    ) : null}
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {comment.user?.displayName ?? "Unknown"}
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {formatUiRelativeTimeFromDate(comment.createdAt)}
                    </span>
                  </div>
                  <div className="px-3 py-2">
                    <JiraMarkdown
                      content={comment.body}
                      className="text-[13px] leading-relaxed"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <aside className="border-t border-border/50 bg-muted/20 px-3 py-3 xl:border-l xl:border-t-0">
        <Button
          onClick={() => onUse(displayed)}
          className="mb-3 w-full justify-center gap-2 sm:hidden"
        >
          Start workspace
          <ArrowRight className="size-4" />
        </Button>
        <div className="grid gap-1">
          {actionItems.map((item) => {
            const Icon = item.icon;
            return (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={item.action}
                    className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={6}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

export function JiraIssueCommentComposer({
  commentDraft,
  setCommentDraft,
  commentSubmitting,
  canSubmitComment,
  handleSubmitComment,
}: {
  commentDraft: string;
  setCommentDraft: (value: string) => void;
  commentSubmitting: boolean;
  canSubmitComment: boolean;
  handleSubmitComment: () => void;
}): React.JSX.Element {
  return (
    <div className="flex-none border-t border-border/50 bg-background px-3 py-3">
      <div className="flex gap-2">
        <textarea
          value={commentDraft}
          onChange={(event) => setCommentDraft(event.target.value)}
          placeholder="Add a Jira comment..."
          rows={2}
          disabled={commentSubmitting}
          className="min-h-10 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <Button
          onClick={handleSubmitComment}
          disabled={!canSubmitComment || commentSubmitting}
          className="self-end gap-2"
        >
          {commentSubmitting ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Comment
        </Button>
      </div>
    </div>
  );
}
