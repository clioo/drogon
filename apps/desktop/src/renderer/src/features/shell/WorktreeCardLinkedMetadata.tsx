import { toast } from "sonner";
import type { Worktree } from "../../../../shared/session-contract";
import { worktreeIssueLinkSchema, type WorktreeIssueLink } from "../../../../shared/worktree-issue-contract";
import { JiraIcon } from "../../components/icons/JiraIcon";
import { LinearIcon } from "../../components/icons/LinearIcon";
import type { CardProperty } from "./workspace-options-state";
import { windowShellBridge } from "./worktree-bridges";

/** Only persisted, owner-matched associations and attributed listening ports
 * may produce badges; a display preference never fabricates a linked issue. */
export function WorktreeCardLinkedMetadata({ worktree, properties, ports, issueLinks = [], onOpenIssue }: {
  worktree: Worktree;
  properties: Partial<Record<CardProperty, boolean>>;
  ports: readonly number[];
  issueLinks?: readonly WorktreeIssueLink[];
  onOpenIssue?: (url: string) => void;
}) {
  const labels: { text: string; title: string }[] = [];
  if (worktree.creator === "cli" && properties.cli !== false)
    labels.push({ text: "Drogon CLI", title: "Created through Drogon CLI" });
  if (worktree.creator === "automation" && properties.automation !== false)
    labels.push({ text: "Automation", title: "Created by an automation" });
  if (properties.ports !== false)
    for (const port of ports) labels.push({ text: `:${port}`, title: `Listening port ${port}` });
  const issues = issueLinks.flatMap((raw) => {
    const parsed = worktreeIssueLinkSchema.safeParse(raw);
    if (!parsed.success) return [];
    const issue = parsed.data;
    return issue.worktreeId === worktree.id
      && properties[issue.provider === "linear" ? "linear-issue" : "jira-issue"] !== false ? [issue] : [];
  });
  const external = windowShellBridge()?.openExternal;
  const open = onOpenIssue ?? (external ? (url: string) => {
    void external(url).then((result) => { if (!result.ok) toast.error(result.error.message); })
      .catch(() => toast.error("Could not open the linked issue."));
  } : undefined);
  if (labels.length === 0 && issues.length === 0) return null;
  return <span className="shell-worktree-card-meta shell-worktree-card-linked-meta">
    {labels.map(({ text, title }) => <span className="shell-worktree-card-issue" key={title} title={title}>{text}</span>)}
    {issues.map((issue) => {
      const provider = issue.provider === "linear" ? "Linear" : "Jira";
      const Icon = issue.provider === "linear" ? LinearIcon : JiraIcon;
      const content = <><Icon className="size-3 shrink-0" /><span className="shell-worktree-card-issue-label">{issue.identifier}</span></>;
      const title = [issue.title || issue.identifier, issue.stateName, ...issue.labels, issue.url].filter(Boolean).join(" · ");
      return issue.url && open
        ? <button type="button" key={issue.provider} className="shell-worktree-card-issue" title={title}
            aria-label={`Open ${provider} ${issue.identifier}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
            onClick={(event) => { event.stopPropagation(); open(issue.url!); }}>{content}</button>
        : <span key={issue.provider} className="shell-worktree-card-issue" title={title} aria-label={`Linked ${provider} ${issue.identifier}`}>{content}</span>;
    })}
  </span>;
}
