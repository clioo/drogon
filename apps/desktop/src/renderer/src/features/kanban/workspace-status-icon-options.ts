/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca
   src/renderer/src/components/sidebar/workspace-status-icon-options.ts at
   pinned source c9790628 (clioo/drogon-orca). Adaptation: i18n
   translate(id, fallback) calls collapsed to their English fallback strings
   and createLocalizedCatalog replaced by a plain factory; Drogon's kanban
   slice ships the source's English copy only. */
import React from "react";
import {
  Ban,
  Circle,
  CircleAlert,
  CircleDashed,
  CircleDot,
  CircleEllipsis,
  CirclePause,
  CirclePlay,
  Flag,
  Timer,
} from "lucide-react";
import {
  ConductorDoneIcon,
  ConductorProgressIcon,
  ConductorReviewIcon,
} from "./workspace-status-icons";

export type WorkspaceStatusIconOption = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export const getWorkspaceStatusIconOptions =
  (): WorkspaceStatusIconOption[] => [
    {
      id: "circle",
      label: "Circle",
      icon: Circle,
    },
    {
      id: "circle-dot",
      label: "Dot",
      icon: CircleDot,
    },
    {
      id: "circle-progress",
      label: "Progress",
      icon: ConductorProgressIcon,
    },
    {
      id: "circle-dashed",
      label: "Dashed",
      icon: CircleDashed,
    },
    {
      id: "circle-ellipsis",
      label: "Waiting",
      icon: CircleEllipsis,
    },
    {
      id: "git-pull-request",
      label: "Review",
      icon: ConductorReviewIcon,
    },
    {
      id: "timer",
      label: "Timer",
      icon: Timer,
    },
    {
      id: "flag",
      label: "Flag",
      icon: Flag,
    },
    {
      id: "circle-alert",
      label: "Alert",
      icon: CircleAlert,
    },
    {
      id: "circle-pause",
      label: "Paused",
      icon: CirclePause,
    },
    {
      id: "circle-play",
      label: "Play",
      icon: CirclePlay,
    },
    {
      id: "circle-check",
      label: "Done",
      icon: ConductorDoneIcon,
    },
    {
      id: "ban",
      label: "Blocked",
      icon: Ban,
    },
    {
      id: "conductor-done",
      label: "Done",
      icon: ConductorDoneIcon,
    },
    {
      id: "conductor-review",
      label: "In review",
      icon: ConductorReviewIcon,
    },
    {
      id: "conductor-progress",
      label: "In progress",
      icon: ConductorProgressIcon,
    },
  ];
