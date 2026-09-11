// MIT Copyright (c) 2026 Lovecast Inc.
// Ported from orca-drogon: src/renderer/src/components/meetings/
// meetings-page-copy.ts. Status labels/variants and the setup URL are
// verbatim; the availability copy is rewritten for the states this daemon
// can actually observe (the fork's capture-adapter / bridge / speech-model
// notices have no counterpart here, and `empty` plus the always-present
// folder line are additive).
import type {
  MeetingStatus,
  MeetingsPage,
} from "../../../../shared/meetings-contract";

export const WRITE_THAT_DOWN_SETUP_URL =
  "https://github.com/clioo/write-that-down-patrick";

export function meetingStatusLabel(status: MeetingStatus): string {
  return status === "recording"
    ? "Recording"
    : status === "failed"
      ? "Failed"
      : "Saved";
}

export function meetingStatusVariant(
  status: MeetingStatus,
): "default" | "secondary" | "destructive" {
  return status === "recording"
    ? "default"
    : status === "failed"
      ? "destructive"
      : "secondary";
}

export function meetingDurationLabel(
  status: MeetingStatus,
  durationMinutes: number | null,
): string {
  if (status === "recording") return "In progress";
  return durationMinutes === null
    ? "Unknown duration"
    : `${durationMinutes} min`;
}

/**
 * The headline notice, or `null` when there is nothing to warn about. Every
 * non-ready state names what Drogon actually observed, and the missing /
 * unreadable states name the exact path — an empty list must never be the
 * only thing the owner sees when the notes folder could not be found.
 */
export function meetingsAvailabilityCopy(
  page: MeetingsPage,
): { title: string; description: string } | null {
  const { availability } = page;
  switch (availability.reason) {
    case "unsupported-platform":
      return {
        title: "Write That Down meetings are macOS-only",
        description:
          "Meeting notes come from a macOS app. Drogon can index a compatible Markdown folder on this host, but the tool itself cannot run here.",
      };
    case "not-installed":
      return {
        title: "Write That Down is not installed",
        description:
          "Install the companion on this Mac to record new meetings. Drogon still lists compatible notes it finds and never takes ownership of them.",
      };
    case "invalid-configuration":
      return {
        title: "Write That Down configuration needs attention",
        description:
          "The companion's configuration could not be read safely, so the notes folder is the built-in default. Existing notes are untouched.",
      };
    case "transcript-root-missing":
      return {
        title: "Notes folder not found",
        description:
          "Drogon looked exactly where Write That Down would write. Nothing was created and nothing unrelated was claimed.",
      };
    case "transcript-root-unreadable":
      return {
        title: "Notes folder cannot be read",
        description:
          "The folder exists, but this Drogon process does not have permission to list it.",
      };
    default:
      // `ready` has nothing to disclose beyond the folder line; `empty`
      // speaks through the empty state, which names the folder itself.
      return null;
  }
}

/** One line that always names the folder and where that answer came from. */
export function meetingsFolderLine(page: MeetingsPage): string {
  const { availability } = page;
  const origin =
    availability.transcriptRootSource === "config"
      ? "Write That Down config"
      : availability.transcriptRootSource === "environment"
        ? "WTD_OUTPUT_DIR"
        : "default";
  const state =
    availability.transcriptRootState === "readable"
      ? "readable"
      : availability.transcriptRootState === "missing"
        ? "missing"
        : "unreadable";
  return `${availability.transcriptRoot} · ${origin} · folder ${state} · read-only`;
}

/**
 * Empty-state copy. Only the `empty` reason may say "no transcripts"; every
 * other reason says what went wrong and keeps the notice above as the
 * explanation.
 */
export function meetingsEmptyCopy(page: MeetingsPage): {
  title: string;
  description: string;
} {
  if (page.availability.reason === "empty") {
    return {
      title: "No transcript artifacts found",
      description: `The notes folder ${page.availability.transcriptRoot} is readable and holds no Write That Down transcripts yet. Files outside the tool's date-folder Markdown convention stay out of this list.`,
    };
  }
  return {
    title: "No transcripts could be read",
    description: `Drogon could not read any meeting from ${page.availability.transcriptRoot}. This is not the same as having no meetings; the notice above says why.`,
  };
}

/**
 * The header line. `count` is null whenever the folder could not be read, and
 * then the header says so: "0 transcripts" for a folder Drogon never managed
 * to list would be the same false statement the list region refuses to make.
 */
export function meetingsCountLabel(count: number | null, loading = false): string {
  if (count === null) {
    return loading ? "Reading the notes folder…" : "Notes folder could not be read";
  }
  return `${count} transcript${count === 1 ? "" : "s"} · Write That Down`;
}
