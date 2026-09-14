// Read-only adversarial audit for acceptance-harness iteration 2.
// Emits evidence for env sanitization and URL-to-filesystem path review; it
// deliberately reports residual denylist risk instead of hiding it.
import { readFile } from "node:fs/promises";
import { cleanAcceptanceEnvironment } from "./packaged-fixture-daemon.mjs";

const inheritedPath = process.argv[2] ?? ".preflight/issue-383-iteration2/inherited-drogon-env-names.txt";
const inherited = (await readFile(inheritedPath, "utf8"))
  .split(/\n/)
  .map((line) => line.trim().split(" ")[0])
  .filter(Boolean);
const workerEnv = Object.fromEntries(
  inherited.map((key) => [key, key === "DROGON_DISPATCH_CAPABILITY" ? "redacted" : "worker-value"]),
);
Object.assign(workerEnv, {
  DROGON_BACKGROUND_WINDOW: "1",
  DROGON_VERIFY_OS_FOCUS: "1",
  DROGON_UPGRADE_FROM_BUNDLE: "/old/Drogon.app",
});
const cleaned = cleanAcceptanceEnvironment(workerEnv);
const synthetic = cleanAcceptanceEnvironment({
  ...workerEnv,
  DROGON_NEW_WORKER_CONTEXT: "poison",
});

const result = {
  inheritedDrogonNames: inherited,
  removedActual: inherited.filter((key) => !(key in cleaned)),
  preserved: {
    background: cleaned.DROGON_BACKGROUND_WINDOW,
    verify: cleaned.DROGON_VERIFY_OS_FOCUS,
    upgrade: cleaned.DROGON_UPGRADE_FROM_BUNDLE,
  },
  finding: synthetic.DROGON_NEW_WORKER_CONTEXT === "poison"
    ? "denylist preserves an unlisted DROGON_* worker-context variable"
    : null,
};
console.log(JSON.stringify(result, null, 2));
