// Pin for the packaged probe's kernel exit observer path.
//
// The observer is a python3 script handed to `spawn`. Resolving it with
// `URL.pathname` leaves `%20` in place for a checkout whose path contains a
// space -- Drogon's own `~/Library/Application Support/Drogon/workspaces/...`
// -- and python3 then exits 2 ("can't open file") before it ever registers:
// the packaged acceptance aborts with "exit observer exited before ready
// (code 2, signal null)" after 25 checks. CI's own checkout has no space, so
// only an injected URL can pin this; the second case proves the real script
// still resolves to a file that exists.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { observerScriptPath } from "./probe-rendered-changed-daemon-binary.mjs";

test("the exit observer path decodes a checkout path containing a space", () => {
  const moduleUrl = pathToFileURL(
    "/tmp/Application Support/drogon/scripts/probe-rendered-changed-daemon-binary.mjs",
  );
  assert.equal(
    observerScriptPath(moduleUrl),
    "/tmp/Application Support/drogon/scripts/live-child-exit-observer.py",
  );
});

test("the real observer script resolves to an existing, unencoded path", () => {
  const resolved = observerScriptPath(import.meta.url);
  assert.ok(!resolved.includes("%20"), `still encoded: ${resolved}`);
  assert.ok(existsSync(resolved), `missing observer script: ${resolved}`);
});
