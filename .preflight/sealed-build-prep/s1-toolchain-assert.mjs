import assert from "node:assert/strict";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

// Stage payload, NOT a supervisor: runs UNDER the frozen outer, which owns
// custody, deadlines, env, observation, and cleanup. Asserts the frozen
// private env the outer guarantees (outer lines 66-78): Node 24 first on a
// fixed PATH, no ambient inheritance (bootstrap-outer.sh env -i).
// Cargo is intentionally NOT asserted here: no known-absolute cargo exists in
// evidence, so S8 stays behind owner extension E1 (owner blesses the path).
assert.equal(
  Number(process.versions.node.split(".")[0]),
  24,
  "Node 24 is required",
);
for (const tool of ["git", "node", "npm"]) {
  let ok = false;
  for (const dir of process.env.PATH.split(path.delimiter)) {
    try {
      await access(path.join(dir, tool), constants.X_OK);
      ok = true;
      break;
    } catch {
      /* try next dir */
    }
  }
  assert.ok(ok, `Required tool missing: ${tool}`);
}
console.log(JSON.stringify({ status: "TOOLCHAIN-OK", node: process.version }));
