// Pin test for the accept-bot-session-resume resync hunk.
//
// What it pins: after the Add Project dialog lands, the journey reloads the
// renderer before creating the Bot (App.tsx `panelRegistry` memo freezes
// `createWorkspaceId`, so Create Bot is otherwise refused with "Select a
// workspace before creating a Bot."). Reverting that hunk must fail this
// test — that is what the discrimination gate checks.
//
// What it does NOT do: exercise the journey itself. The live run
// (`node scripts/accept-bot-session-resume.mjs`, background window, shell
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
    "accept-bot-session-resume.mjs",
  ),
  "utf8",
);

describe("bot-session-resume placement resync", () => {
  it("expands the collapsed Bot card before every Open session click", () => {
    assert.ok(
      journey.includes("async function openSessionFromCard()"),
      "the expand-first helper must exist",
    );
    const uses = journey.split("await openSessionFromCard();").length - 1;
    assert.equal(
      uses,
      3,
      `all three Open clicks must go through the helper, found ${uses}`,
    );
    assert.ok(
      !journey.includes("card.getByTestId(`open-session-"),
      "no direct collapsed-card Open click may remain",
    );
  });

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
});
