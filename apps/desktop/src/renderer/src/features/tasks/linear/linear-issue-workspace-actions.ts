/* MIT Copyright (c) 2026 Lovecast Inc.
   Linear row actions: open, copy URL/identifier/branch/prompt. Labels match
   the Jira row actions; the openers are props, never globals. */
import { Clipboard, ExternalLink, GitBranch } from "lucide-react";
import { toast } from "sonner";
import type { IssueDetails } from "../../../../../shared/worktree-issue-contract";
import { buildLinearIssueContextPrompt } from "./linear-start";
import { buildLinearBranchName } from "./linear-workspace-seed";

export type LinearIssueWorkspaceAction = {
  label: string;
  icon: typeof ExternalLink;
  action: () => void;
};

export function getLinearIssueWorkspaceActions(
  issue: IssueDetails,
  {
    openUrl,
    writeClipboardText,
  }: {
    openUrl: (url: string) => Promise<unknown> | unknown;
    writeClipboardText: (text: string) => Promise<unknown> | unknown;
  },
): LinearIssueWorkspaceAction[] {
  const copyTextToClipboard = async (text: string, label: string): Promise<void> => {
    try {
      await writeClipboardText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };
  return [
    ...(issue.url
      ? [
          {
            label: "Open in Linear",
            icon: ExternalLink,
            action: () => void openUrl(issue.url!),
          } as LinearIssueWorkspaceAction,
        ]
      : []),
    ...(issue.url
      ? [
          {
            label: "Copy URL",
            icon: Clipboard,
            action: () => void copyTextToClipboard(issue.url!, "URL"),
          } as LinearIssueWorkspaceAction,
        ]
      : []),
    {
      label: "Copy identifier",
      icon: Clipboard,
      action: () => void copyTextToClipboard(issue.identifier, "Identifier"),
    },
    {
      label: "Copy suggested branch name",
      icon: GitBranch,
      action: () =>
        void copyTextToClipboard(buildLinearBranchName(issue), "Branch name"),
    },
    {
      label: "Copy prompt",
      icon: Clipboard,
      action: () =>
        void copyTextToClipboard(buildLinearIssueContextPrompt(issue), "Prompt"),
    },
  ];
}
