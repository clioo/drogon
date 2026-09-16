// Issue #333: close-busy-tab confirm copy. Pure, unit-tested like the
// sibling dialog-copy modules.

export function getCloseBusyTerminalDialogCopy(agent: boolean): {
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
} {
  if (agent) {
    return {
      title: "Stop this agent?",
      description:
        "The agent in this tab is still working. Closing the tab stops its session.",
      cancelLabel: "Cancel",
      confirmLabel: "Stop agent",
    };
  }
  return {
    title: "Stop running command?",
    description:
      "A command in this tab is still running. Closing the tab stops its session.",
    cancelLabel: "Cancel",
    confirmLabel: "Stop command",
  };
}
