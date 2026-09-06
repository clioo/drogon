import type { Session } from "../../shared/session-contract";

export function updateSessionProjection(
  items: Session[],
  observed: Session,
): Session[] {
  const current = items.find((item) => item.id === observed.id);
  if (!current || current.incarnation !== observed.incarnation) return items;
  if (
    current.verdict === observed.verdict &&
    current.exitCode === observed.exitCode &&
    current.cols === observed.cols &&
    current.rows === observed.rows
  )
    return items;
  return items.map((item) => (item === current ? observed : item));
}
