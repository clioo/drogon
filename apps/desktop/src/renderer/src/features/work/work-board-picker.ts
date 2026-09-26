// The import dialog's board picker: a name filter over the listed boards
// and a "Recommended for you" group — the boards holding your open
// assigned issues, most first. Pure, so the dialog only renders.
import type { WorkProviderBoard } from "../../../../shared/work-contract";

/** A listed board; `assignedOpen` comes from a daemon that counts your open
 *  issues per board (absent from an older one, which recommends nothing). */
export type PickerBoard = WorkProviderBoard & { assignedOpen?: number };

/** Case- and accent-insensitive form for matching. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Boards whose name, project key or project name hold every word of the
 *  query, in listed order; a blank query keeps them all. */
export function filterBoards<B extends PickerBoard>(boards: B[], query: string): B[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return boards;
  return boards.filter((board) => {
    const haystack = fold([board.name, board.projectKey ?? "", board.projectName ?? ""].join(" "));
    return words.every((word) => haystack.includes(word));
  });
}

/** Recommended (open assigned issues, most first; ties keep listed order)
 *  and the rest in listed order. */
export function groupBoards<B extends PickerBoard>(boards: B[]): { recommended: B[]; rest: B[] } {
  const assigned = (board: B) => board.assignedOpen ?? 0;
  const recommended = boards
    .map((board, index) => ({ board, index }))
    .filter(({ board }) => assigned(board) > 0)
    .sort((a, b) => assigned(b.board) - assigned(a.board) || a.index - b.index)
    .map(({ board }) => board);
  return { recommended, rest: boards.filter((board) => assigned(board) === 0) };
}

/** "1 assigned to you", "4 assigned to you". */
export function assignedLabel(count: number): string {
  return `${count} assigned to you`;
}
