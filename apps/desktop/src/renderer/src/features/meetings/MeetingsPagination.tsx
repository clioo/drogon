// MIT Copyright (c) 2026 Lovecast Inc.
// Page numbers for the Meetings list, ported from orca-drogon's
// src/renderer/src/components/task-page-pagination-page-numbers.ts (the same
// windowed-page algorithm the Tasks page uses) with the same
// PaginationBar chrome as src/renderer/src/components/task-page/
// PaginationBar.tsx. Why paging rather than virtualisation: the daemon pages
// the corpus (50 rows per request by default, 200 at most), the page holds one
// page of rows in the DOM, and the layout stays the fork's page-scroll
// layout — nothing renders 327 rows to find one meeting.
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { cn } from "../../lib/utils";

export function getMeetingsPageNumbers(
  current: number,
  total: number,
): (number | "ellipsis")[] {
  if (total <= 9) {
    return Array.from({ length: total }, (_, index) => index);
  }
  const pages = new Set<number>();
  pages.add(0);
  pages.add(total - 1);
  for (let i = Math.max(0, current - 2); i <= Math.min(total - 1, current + 2); i++) {
    pages.add(i);
  }
  const sorted = [...pages].sort((left, right) => left - right);
  const result: (number | "ellipsis")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
      result.push("ellipsis");
    }
    result.push(sorted[i]);
  }
  return result;
}

export function MeetingsPagination({
  currentPage,
  totalPages,
  loading,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}): React.JSX.Element | null {
  if (totalPages <= 1) return null;
  const pageNumbers = getMeetingsPageNumbers(currentPage, totalPages);
  const btnClass =
    "inline-flex w-24 items-center justify-center gap-0.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
  const numClass = (page: number): string =>
    cn(
      "inline-flex size-8 items-center justify-center rounded-md text-sm transition",
      page === currentPage
        ? "bg-primary text-primary-foreground font-medium"
        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
    );
  return (
    <nav aria-label="Meeting pages" className="flex flex-wrap items-center justify-center gap-1">
      <button
        type="button"
        disabled={currentPage === 0 || loading}
        onClick={() => onPageChange(currentPage - 1)}
        aria-label="Previous page"
        className={btnClass}
      >
        <ChevronLeft className="size-4" />
        Previous
      </button>
      {pageNumbers.map((entry, index) =>
        entry === "ellipsis" ? (
          <span
            key={`ellipsis-${index}`}
            aria-hidden
            className="inline-flex size-8 items-center justify-center text-sm text-muted-foreground"
          >
            ...
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            disabled={loading}
            onClick={() => onPageChange(entry)}
            aria-label={`Page ${entry + 1}`}
            aria-current={entry === currentPage ? "page" : undefined}
            className={numClass(entry)}
          >
            {loading && entry === currentPage ? (
              <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              entry + 1
            )}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={currentPage >= totalPages - 1 || loading}
        onClick={() => onPageChange(currentPage + 1)}
        aria-label="Next page"
        className={btnClass}
      >
        Next
        <ChevronRight className="size-4" />
      </button>
    </nav>
  );
}
