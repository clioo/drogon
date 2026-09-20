// Hunk pins for scripts/accept-worker-settle-releases-pty.mjs (new in
// this lane): the journey must keep every link of the settled-but-live
// chain it was added to pin.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const journey = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "accept-worker-settle-releases-pty.mjs",
);

test("settle journey keeps the full settled-but-live chain", async () => {
  const source = await readFile(journey, "utf8");
  for (const pin of [
    "reported-attempt-reads-succeeded-but-live",
    "stop-on-settled-attempt-refuses-attempt-settled",
    "refused-stop-leaves-the-pty-live",
    "release-signals-the-lingering-process",
    "no-live-pty-remains-for-the-reported-dispatch",
  ]) {
    assert.ok(source.includes(pin), `missing chain link: ${pin}`);
  }
});
