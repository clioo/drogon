/**
 * Listing scope annotation, mirroring the incumbent
 * `annotateOmittedHostScope` contract: a listing is only evidence about
 * the hosts it actually covered. When a result does not name its scope,
 * an empty answer is not evidence that nothing is running elsewhere
 * (docs/reference/ssh-execution-boundary.md, "Reading artifacts instead
 * of process state"). A scope annotation answers *selectability* — which
 * rows a command may address — never process liveness.
 */
export interface RemoteListing<Row> {
  rows: readonly Row[];
  /** Hosts the listing actually covered. */
  coveredHostIds: readonly string[];
  /** Hosts that could not be reached or were excluded from this listing. */
  omittedHostIds: readonly string[];
  /**
   * `complete` only when nothing was omitted; any omission (even with
   * zero rows) makes the whole listing `unverifiable` as a statement
   * about the fleet.
   */
  scope: "complete" | "unverifiable";
}

export interface RawListing<Row> {
  rows: readonly Row[];
  coveredHostIds: readonly string[];
  omittedHostIds?: readonly string[];
}

/**
 * Names the omitted scope of a listing. No-op (scope `complete`) when
 * nothing was omitted; otherwise the listing is stamped `unverifiable`
 * and carries the explicit omitted-host ids, so an empty row set can
 * never masquerade as "nothing exists elsewhere".
 */
export function annotateOmittedHostScope<Row>(
  listing: RawListing<Row>,
): RemoteListing<Row> {
  const omittedHostIds = listing.omittedHostIds ?? [];
  return {
    rows: listing.rows,
    coveredHostIds: listing.coveredHostIds,
    omittedHostIds,
    scope: omittedHostIds.length > 0 ? "unverifiable" : "complete",
  };
}
