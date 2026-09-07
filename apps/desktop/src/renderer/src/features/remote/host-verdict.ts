/**
 * The fixed verdict vocabulary, taken verbatim from the incumbent
 * `UnstoppedPtyVerdict`. Do not introduce synonyms and never collapse
 * `unverifiable` into either neighbour.
 */
export type HostVerdict = "live" | "unverifiable" | "exited";

/**
 * Loss of contact is never evidence of exit.
 *
 * Normative rule (docs/reference/ssh-execution-boundary.md, "The rule",
 * consequence 2): "No asserting what you cannot observe. Loss of contact
 * is not evidence of `exited`. Report `unverifiable`, never `exited`."
 * `exited` requires positive evidence of absence from the host that owns
 * the process; a transport failure, timeout, socket close, or any client-
 * side bookkeeping observation can only ever produce `unverifiable`.
 *
 * This helper therefore accepts any failure shape and ALWAYS returns
 * `unverifiable` — it structurally cannot return `exited`. Reporting a
 * transport loss as `exited` orphans live work and can cold-start a
 * duplicate over the same worktree; that is the error this boundary
 * exists to prevent.
 */
export function verdictFor(_lossOfContact: unknown): HostVerdict {
  return "unverifiable";
}
