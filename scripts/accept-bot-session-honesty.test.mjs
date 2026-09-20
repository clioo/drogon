// Pin test for the accept-bot-session-honesty resync hunk.
//
// What it pins: after the Add Project dialog lands, the journey reloads the
// renderer before creating the Bot (App.tsx `panelRegistry` memo freezes
// `createWorkspaceId`, so Create Bot is otherwise refused with "Select a
// workspace before creating a Bot."). Reverting that hunk must fail this
// test — that is what the discrimination gate checks.
//
// What it does NOT do: exercise the journey itself. The live run
// (`node scripts/accept-bot-session-honesty.mjs`, background window, shell
// fixture) proves the behaviour; a sabotaged fixture (no harness banner)
// proves the journey still fails.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const journey = readFileSync(
  path.join(
    fileURLToPath(new URL(".", import.meta.url)),
    "accept-bot-session-honesty.mjs",
  ),
  "utf8",
);

describe("bot-session-honesty placement resync", () => {
  it("reloads the renderer after Add Project and before Create Bot", () => {
    const added = journey.indexOf(
      'addDialog.getByRole("button", { name: "Add Project", exact: true }).click();',
    );
    const reloaded = journey.indexOf("await page.reload();");
    const refocused = journey.indexOf("await emulatePageFocus(page);", reloaded);
    const created = journey.indexOf(
      '"Create Bot", exact: true }).click();',
      reloaded,
    );
    assert.ok(added !== -1, "the Add Project submit must exist");
    assert.ok(reloaded !== -1, "the renderer reload must exist");
    assert.ok(
      reloaded > added,
      "the reload must come after the project lands",
    );
    assert.ok(
      refocused !== -1 && refocused < created,
      "focus must be re-emulated after the reload",
    );
    assert.ok(
      created !== -1 && created > reloaded,
      "Create Bot must come after the reload",
    );
  });

  it("renders the unverifiable Bot row as not-reporting, never exit", () => {
    assert.ok(
      journey.includes("unverifiable-bot-row-renders-not-reporting"),
      "the row-honesty check must be recorded",
    );
    assert.ok(
      journey.includes('data-bot-session-state") === "unknown"'),
      "the row must settle on the not-reporting state",
    );
    assert.ok(
      journey.includes("No recent update"),
      "the row must say it is not reporting",
    );
  });
});
