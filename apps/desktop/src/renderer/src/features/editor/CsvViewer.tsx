// MIT Copyright (c) 2026 Lovecast Inc. Adapted from Orca's
// src/renderer/src/components/editor/CsvViewer.tsx. The source virtualizes
// with `@tanstack/react-virtual` for 100k+ row files; this rewrite's
// `files.read` bridge caps a read at MAX_FILE_BYTES (64 KiB, see
// shared/file-contract.ts), so a CSV opened here can never realistically
// need virtualization — rows render directly, capped defensively at
// MAX_RENDERED_ROWS. DOM structure (CSS grid table with sticky header/
// row-number column) and ARIA roles are kept faithful to the source.
import { useMemo } from "react";
import { detectCsvDelimiter, parseCsv } from "./csv-parse";

export const MAX_RENDERED_ROWS = 5_000;

const ROW_HEIGHT = 28;
const MIN_COL_PX = 80;
const MAX_COL_PX = 320;
const ROW_NUMBER_COL_PX = 48;
const CHAR_PX = 7;

export function CsvViewer({
  content,
  path,
}: {
  content: string;
  path: string;
}) {
  const parsed = useMemo(() => {
    const delimiter = detectCsvDelimiter(path, content);
    return parseCsv(content, delimiter);
  }, [content, path]);

  const { headerRow, bodyRows } = useMemo(() => {
    if (parsed.rows.length === 0)
      return { headerRow: [] as string[], bodyRows: [] as string[][] };
    const [head, ...rest] = parsed.rows;
    return { headerRow: head ?? [], bodyRows: rest };
  }, [parsed]);
  const columnCount = parsed.maxColumns;
  const header = useMemo(() => {
    const out = [...headerRow];
    while (out.length < columnCount) out.push("");
    return out;
  }, [headerRow, columnCount]);

  const columnWidths = useMemo(() => {
    const widths = Array.from<number>({ length: columnCount }).fill(MIN_COL_PX);
    const consider = (cell: string | undefined, idx: number): void => {
      if (!cell) return;
      const width = Math.min(
        MAX_COL_PX,
        Math.max(MIN_COL_PX, cell.length * CHAR_PX + 24),
      );
      if (width > widths[idx]!) widths[idx] = width;
    };
    header.forEach(consider);
    const sampleLimit = Math.min(bodyRows.length, 200);
    for (let i = 0; i < sampleLimit; i += 1) {
      const row = bodyRows[i]!;
      for (let c = 0; c < columnCount; c += 1) consider(row[c], c);
    }
    return widths;
  }, [header, bodyRows, columnCount]);

  const gridTemplate = `${ROW_NUMBER_COL_PX}px ${columnWidths.map((w) => `${w}px`).join(" ")}`;
  const renderedRows = bodyRows.slice(0, MAX_RENDERED_ROWS);

  if (parsed.rows.length === 0) {
    return (
      <div className="csv-viewer-empty flex h-full items-center justify-center text-sm text-muted-foreground">
        Empty file
      </div>
    );
  }

  return (
    <div className="csv-viewer flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1 overflow-auto font-mono text-xs">
        <div
          role="table"
          aria-label={`CSV table: ${path}`}
          aria-rowcount={parsed.rows.length}
          aria-colcount={columnCount + 1}
          className="inline-block min-w-full"
          style={{ width: "max-content" }}
        >
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-10 grid bg-muted/90 backdrop-blur"
            style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
          >
            <div
              role="columnheader"
              className="sticky left-0 z-20 flex items-center justify-end border-b border-r border-border/60 bg-muted/90 px-2 text-[10px] font-normal text-muted-foreground"
            >
              #
            </div>
            {header.map((cell, idx) => (
              <div
                role="columnheader"
                key={idx}
                className="flex items-center overflow-hidden border-b border-r border-border/60 px-2 font-medium text-foreground"
              >
                <span className="truncate" title={cell}>
                  {cell}
                </span>
              </div>
            ))}
          </div>
          {renderedRows.map((row, index) => (
            <div
              role="row"
              aria-rowindex={index + 2}
              key={index}
              className="group grid hover:bg-accent/40"
              style={{ gridTemplateColumns: gridTemplate, height: ROW_HEIGHT }}
            >
              <div
                role="rowheader"
                className="sticky left-0 z-[5] flex items-center justify-end border-b border-r border-border/40 bg-background/95 px-2 text-[10px] text-muted-foreground group-hover:bg-accent/40"
              >
                {index + 1}
              </div>
              {Array.from({ length: columnCount }).map((_, colIdx) => (
                <div
                  role="cell"
                  key={colIdx}
                  className="flex items-center overflow-hidden border-b border-r border-border/40 px-2 text-foreground"
                  title={row[colIdx] ?? ""}
                >
                  <span className="truncate">{row[colIdx] ?? ""}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-4 border-t border-border/60 px-3 py-1 text-xs text-muted-foreground">
        <span>{bodyRows.length.toLocaleString()} rows</span>
        <span>{columnCount} columns</span>
        {bodyRows.length > MAX_RENDERED_ROWS && (
          <span role="status">
            showing first {MAX_RENDERED_ROWS.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
