// MIT Copyright (c) 2026 Lovecast Inc.
// The Meetings filter model. Pure functions only: the page renders it and
// the controller turns it into a `meeting.list` request, so what a filter
// means is testable without a browser.
//
// Why this exists at all: 327 transcripts make a reverse-chronological list
// nearly useless on its own. Search, a date range and a duration range are
// what turn the archive into something answerable, and every one of them is
// applied by the daemon — the page never filters a page of rows and pretends
// it filtered the corpus.

import type { MeetingsListInput, MeetingsPage } from "../../../../shared/meetings-contract";

export type MeetingsWhenPreset =
  | "any"
  | "today"
  | "last-7"
  | "last-30"
  | "last-90"
  | "custom";

export type MeetingsDurationPreset = "any" | "up-to-15" | "15-to-60" | "over-60";

export type MeetingsFilterState = {
  /** Raw input value; the controller trims it before it becomes a request. */
  query: string;
  when: MeetingsWhenPreset;
  /** Only used by `when: "custom"`, as `YYYY-MM-DD`. */
  from: string;
  to: string;
  duration: MeetingsDurationPreset;
};

export const EMPTY_MEETINGS_FILTERS: MeetingsFilterState = {
  query: "",
  when: "any",
  from: "",
  to: "",
  duration: "any",
};

/** `YYYY-MM-DD` in the viewer's own timezone, which is what a note's folder names. */
export function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when an input names a real calendar day, so the page never sends a
 * range the daemon will refuse (and never silently drops a typo either — the
 * filter bar says which input is not a date).
 */
export function isDateInput(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** The date range a preset means, or `null` when it needs no dates. */
export function presetRange(
  preset: MeetingsWhenPreset,
  today: Date,
): { from: string; to: string } | null {
  switch (preset) {
    case "today":
      return { from: localDateString(today), to: localDateString(today) };
    case "last-7":
      return { from: localDateString(shiftDays(today, -6)), to: localDateString(today) };
    case "last-30":
      return { from: localDateString(shiftDays(today, -29)), to: localDateString(today) };
    case "last-90":
      return { from: localDateString(shiftDays(today, -89)), to: localDateString(today) };
    default:
      return null;
  }
}

/**
 * A custom range that cannot be applied yet, or `null` when there is nothing
 * wrong. Reported instead of silently sending a range the daemon refuses.
 */
export function customRangeProblem(state: MeetingsFilterState): string | null {
  if (state.when !== "custom") return null;
  if (state.from !== "" && !isDateInput(state.from)) {
    return "The start date must be a real date (YYYY-MM-DD).";
  }
  if (state.to !== "" && !isDateInput(state.to)) {
    return "The end date must be a real date (YYYY-MM-DD).";
  }
  if (state.from !== "" && state.to !== "" && state.from > state.to) {
    return "The start date must not be after the end date.";
  }
  if (state.from === "" && state.to === "") {
    return "Enter a start or end date to use a custom range.";
  }
  return null;
}

export function isFilterActive(state: MeetingsFilterState): boolean {
  return (
    state.query.trim() !== "" ||
    state.when !== "any" ||
    state.duration !== "any"
  );
}

/**
 * The `meeting.list` input this filter set means. An unusable custom range
 * contributes no date filter (the filter bar shows the problem), and an empty
 * filter set contributes nothing at all, so the request stays exactly as it
 * was before filters existed.
 */
export function toListInput(
  state: MeetingsFilterState,
  today: Date,
): Omit<MeetingsListInput, "limit" | "offset"> {
  const input: Omit<MeetingsListInput, "limit" | "offset"> = {};
  const query = state.query.trim();
  if (query !== "") input.query = query;
  const problem = customRangeProblem(state);
  if (problem === null) {
    const range = presetRange(state.when, today);
    if (range) {
      input.from = range.from;
      input.to = range.to;
    } else if (state.when === "custom") {
      if (state.from !== "") input.from = state.from;
      if (state.to !== "") input.to = state.to;
    }
  }
  switch (state.duration) {
    case "up-to-15":
      input.maxMinutes = 15;
      break;
    case "15-to-60":
      input.minMinutes = 15;
      input.maxMinutes = 60;
      break;
    case "over-60":
      input.minMinutes = 61;
      break;
    default:
      break;
  }
  return input;
}

/** The applied filters named in one line, or `null` when nothing is filtered. */
export function activeFilterLabels(
  state: MeetingsFilterState,
  today: Date,
): string[] {
  const labels: string[] = [];
  const query = state.query.trim();
  if (query !== "") labels.push(`“${query}”`);
  if (customRangeProblem(state) === null) {
    const range = presetRange(state.when, today);
    if (range) {
      labels.push(
        range.from === range.to ? `on ${range.from}` : `${range.from} → ${range.to}`,
      );
    } else if (state.when === "custom") {
      if (state.from !== "" && state.to !== "") {
        labels.push(`${state.from} → ${state.to}`);
      } else if (state.from !== "") {
        labels.push(`from ${state.from}`);
      } else if (state.to !== "") {
        labels.push(`up to ${state.to}`);
      }
    }
  }
  switch (state.duration) {
    case "up-to-15":
      labels.push("up to 15 min");
      break;
    case "15-to-60":
      labels.push("15–60 min");
      break;
    case "over-60":
      labels.push("over 60 min");
      break;
    default:
      break;
  }
  return labels;
}

/**
 * What the list region says about how much of the corpus is on screen. Reads
 * the daemon's own numbers, so a filtered count is never presented as the
 * size of the folder.
 */
export function meetingsResultSummary(page: MeetingsPage | null): string {
  if (page === null) return "Notes folder not read";
  if (page.availability.reason !== "ready" && page.availability.reason !== "empty") {
    return "Notes folder not read";
  }
  const shown = page.meetings.length;
  const first = shown === 0 ? 0 : page.offset + 1;
  const last = page.offset + shown;
  if (page.searched || isFilterApplied(page)) {
    return `${page.total} of the notes match · showing ${first}–${last}`;
  }
  return `Showing ${first}–${last} of ${page.total}`;
}

/** Whether the page the daemon returned was produced by any filter at all. */
export function isFilterApplied(page: MeetingsPage): boolean {
  const { filters } = page;
  return (
    filters.query !== null ||
    filters.from !== null ||
    filters.to !== null ||
    filters.minMinutes !== null ||
    filters.maxMinutes !== null
  );
}

/**
 * The sentence a search with no results owes the reader: it is not the same
 * answer as an empty folder, and it says what was actually read.
 */
export function meetingsNoResultsCopy(page: MeetingsPage): string {
  if (page.searched) {
    return `No transcript in ${page.availability.transcriptRoot} matches this search. ${page.scanned} file${page.scanned === 1 ? "" : "s"} were read; the folder itself is readable.`;
  }
  return `No transcript in ${page.availability.transcriptRoot} matches these filters. The folder itself is readable.`;
}
