// @vitest-environment node
// MIT Copyright (c) 2026 Lovecast Inc.
// The filter model, as pure functions: what a preset means, what a request
// carries, and which inputs are refused instead of being guessed at. This is
// the layer that decides whether the corpus is searched or a page is shuffled,
// so it is tested without a DOM.
import { describe, expect, it } from "vitest";
import {
  EMPTY_MEETINGS_FILTERS,
  activeFilterLabels,
  customRangeProblem,
  isDateInput,
  isFilterActive,
  localDateString,
  meetingsNoResultsCopy,
  meetingsResultSummary,
  presetRange,
  toListInput,
} from "./meetings-filters";
import { availability, page } from "./meetings-test-fixtures";

const TODAY = new Date(2026, 8, 10); // 2026-09-10, local time.

describe("meetings filter model", () => {
  it("maps a preset to a real inclusive range", () => {
    expect(presetRange("today", TODAY)).toEqual({ from: "2026-09-10", to: "2026-09-10" });
    expect(presetRange("last-7", TODAY)).toEqual({ from: "2026-09-04", to: "2026-09-10" });
    expect(presetRange("last-30", TODAY)).toEqual({ from: "2026-08-12", to: "2026-09-10" });
    expect(presetRange("last-90", TODAY)).toEqual({ from: "2026-06-13", to: "2026-09-10" });
    expect(presetRange("any", TODAY)).toBeNull();
    expect(presetRange("custom", TODAY)).toBeNull();
    // The range walks real calendar days, including across a month boundary.
    expect(presetRange("last-7", new Date(2026, 2, 3))).toEqual({
      from: "2026-02-25",
      to: "2026-03-03",
    });
  });

  it("formats today in the viewer's own timezone", () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
    expect(localDateString(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });

  it("sends an empty request when nothing is filtered", () => {
    expect(toListInput(EMPTY_MEETINGS_FILTERS, TODAY)).toEqual({});
    expect(isFilterActive(EMPTY_MEETINGS_FILTERS)).toBe(false);
    expect(activeFilterLabels(EMPTY_MEETINGS_FILTERS, TODAY)).toEqual([]);
  });

  it("trims the query and refuses one that is only spaces", () => {
    expect(toListInput({ ...EMPTY_MEETINGS_FILTERS, query: "  budget  " }, TODAY)).toEqual({
      query: "budget",
    });
    expect(activeFilterLabels({ ...EMPTY_MEETINGS_FILTERS, query: "budget" }, TODAY)).toEqual([
      "“budget”",
    ]);
  });

  it("turns each duration bucket into the range it names", () => {
    expect(toListInput({ ...EMPTY_MEETINGS_FILTERS, duration: "up-to-15" }, TODAY)).toEqual({
      maxMinutes: 15,
    });
    expect(toListInput({ ...EMPTY_MEETINGS_FILTERS, duration: "15-to-60" }, TODAY)).toEqual({
      minMinutes: 15,
      maxMinutes: 60,
    });
    expect(toListInput({ ...EMPTY_MEETINGS_FILTERS, duration: "over-60" }, TODAY)).toEqual({
      minMinutes: 61,
    });
  });

  it("combines a query, a preset range and a duration", () => {
    const input = toListInput(
      {
        query: "budget",
        when: "last-30",
        from: "",
        to: "",
        duration: "over-60",
      },
      TODAY,
    );
    expect(input).toEqual({
      query: "budget",
      from: "2026-08-12",
      to: "2026-09-10",
      minMinutes: 61,
    });
  });

  it("accepts only real calendar dates", () => {
    expect(isDateInput("2026-09-10")).toBe(true);
    expect(isDateInput("2024-02-29")).toBe(true);
    expect(isDateInput("2026-02-30")).toBe(false);
    expect(isDateInput("2025-02-29")).toBe(false);
    expect(isDateInput("2026-13-01")).toBe(false);
    expect(isDateInput("2026-00-10")).toBe(false);
    expect(isDateInput("2026-9-10")).toBe(false);
    expect(isDateInput("")).toBe(false);
  });

  it("refuses a custom range it cannot mean, and keeps the filter off", () => {
    const reversed = { ...EMPTY_MEETINGS_FILTERS, when: "custom" as const, from: "2026-09-10", to: "2026-09-01" };
    expect(customRangeProblem(reversed)).toContain("must not be after");
    expect(toListInput(reversed, TODAY)).toEqual({});

    const empty = { ...EMPTY_MEETINGS_FILTERS, when: "custom" as const };
    expect(customRangeProblem(empty)).toContain("start or end date");
    expect(toListInput(empty, TODAY)).toEqual({});

    const nonsense = {
      ...EMPTY_MEETINGS_FILTERS,
      when: "custom" as const,
      from: "yesterday",
    };
    expect(customRangeProblem(nonsense)).toContain("real date");

    const halfOpen = { ...EMPTY_MEETINGS_FILTERS, when: "custom" as const, from: "2026-09-01" };
    expect(customRangeProblem(halfOpen)).toBeNull();
    expect(toListInput(halfOpen, TODAY)).toEqual({ from: "2026-09-01" });
    expect(activeFilterLabels(halfOpen, TODAY)).toEqual(["from 2026-09-01"]);
  });

  it("summarizes the page from the daemon's own numbers", () => {
    expect(meetingsResultSummary(null)).toBe("Notes folder not read");
    expect(
      meetingsResultSummary(page({ total: 327, offset: 0, meetings: [], hasMore: true })),
    ).toBe("Showing 0–0 of 327");
    expect(
      meetingsResultSummary(
        page({
          meetings: [page().meetings[0]],
          total: 327,
          offset: 50,
          hasMore: true,
        }),
      ),
    ).toBe("Showing 51–51 of 327");
    // A filtered or searched answer is never presented as the folder's size.
    expect(
      meetingsResultSummary(
        page({
          meetings: [page().meetings[0]],
          total: 3,
          searched: true,
          filters: { query: "budget", from: null, to: null, minMinutes: null, maxMinutes: null },
        }),
      ),
    ).toBe("3 of the notes match · showing 1–1");
    // A folder that could not be read never reports a count.
    expect(
      meetingsResultSummary(
        page({
          availability: availability({ status: "unavailable", reason: "transcript-root-missing" }),
          meetings: [],
          total: 0,
        }),
      ),
    ).toBe("Notes folder not read");
  });

  it("owes a search with no results the truth about what it read", () => {
    const searched = page({
      meetings: [],
      total: 0,
      searched: true,
      scanned: 327,
      filters: { query: "zzz", from: null, to: null, minMinutes: null, maxMinutes: null },
    });
    expect(meetingsNoResultsCopy(searched)).toContain("327 files were read");
    expect(meetingsNoResultsCopy(searched)).toContain("readable");
    const filtered = page({
      meetings: [],
      total: 0,
      filters: { query: null, from: "2026-09-01", to: null, minMinutes: null, maxMinutes: null },
    });
    expect(meetingsNoResultsCopy(filtered)).toContain("matches these filters");
  });
});
