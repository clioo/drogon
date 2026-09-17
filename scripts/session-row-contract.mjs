import assert from "node:assert/strict";

// Session-row contract for the additive `hasForegroundChild` field
// (issue #333). Live rows carry a real census boolean; rows restored
// straight from SQLite predate the field, where absent reads as idle —
// the same rule the renderer already applies (`hasForegroundChild?` is
// optional in `session-contract.ts` / `result-validation.ts`).

// Normalizes a row for cross-restart comparison: a missing field means
// the row was restored from a payload that predates it, which the
// contract reads as idle. A present value is never stripped or coerced.
export function normalizeSessionRow(row) {
  return { ...row, hasForegroundChild: row.hasForegroundChild ?? false };
}

export function normalizeSessionRows(rows) {
  return rows.map(normalizeSessionRow);
}

// Pins the additive field instead of stripping it: every row must carry
// a real boolean. `expectFalseFor` additionally pins the value for rows
// that must be quiet (idle/exited), proving they never report a busy tab.
export function assertSessionRowsPinForegroundChild(rows, options = {}) {
  const { expectFalseFor = () => false, label = "session rows" } = options;
  for (const row of rows) {
    assert.equal(
      typeof row.hasForegroundChild,
      "boolean",
      `${label}: row ${row.id} must carry a boolean hasForegroundChild`,
    );
    if (expectFalseFor(row)) {
      assert.equal(
        row.hasForegroundChild,
        false,
        `${label}: idle row ${row.id} must report hasForegroundChild:false`,
      );
    }
  }
  return rows;
}
