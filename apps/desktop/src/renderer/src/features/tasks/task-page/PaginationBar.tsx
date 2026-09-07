// MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
// src/renderer/src/components/task-page/PaginationBar.tsx and
// task-page-pagination-page-numbers.ts (page numbers live in their own
// module here, mirroring the source layout).
import { getPageNumbers } from "../task-page-pagination-page-numbers";
import { cn } from "../cn";
import { ChevronLeft, LoaderCircle, ChevronRight } from "lucide-react";
import type { JSX } from "react";

export function PaginationBar({
  currentPage,
  totalPages,
  loadingTarget,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  loadingTarget: number | null;
  onPageChange: (page: number) => void;
}): JSX.Element {
  const pageNumbers = getPageNumbers(currentPage, totalPages);
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
    <nav
      aria-label="Pagination"
      className="flex items-center justify-center gap-1 border-t border-border/50 px-4 py-3"
    >
      <button
        type="button"
        disabled={currentPage === 0 || loadingTarget !== null}
        onClick={() => onPageChange(currentPage - 1)}
        aria-label="Previous page"
        className={btnClass}
      >
        <ChevronLeft className="size-4" />
        Previous
      </button>

      {pageNumbers.map((entry, idx) =>
        entry === "ellipsis" ? (
          <span
            key={`ellipsis-${idx}`}
            aria-hidden
            className="inline-flex size-8 items-center justify-center text-sm text-muted-foreground"
          >
            ...
          </span>
        ) : (
          <button
            key={entry}
            type="button"
            disabled={loadingTarget !== null && loadingTarget !== entry}
            onClick={() => onPageChange(entry)}
            aria-label={`Page ${entry + 1}`}
            aria-current={entry === currentPage ? "page" : undefined}
            className={numClass(entry)}
          >
            {loadingTarget === entry ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              entry + 1
            )}
          </button>
        ),
      )}

      <button
        type="button"
        disabled={currentPage >= totalPages - 1 || loadingTarget !== null}
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
