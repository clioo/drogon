import assert from "node:assert/strict";
import path from "node:path";

/** Real native associations, real menu clicks and persisted preferences.
 * No external issue page is opened and no provider credentials are needed. */
export async function probeWorkspaceProperties({ page, worktree, output }) {
  const original = await page.evaluate(() => window.drogon.ui.get());
  const checks = [];
  const card = () => page.locator(`[data-worktree-card-id="${worktree.id}"]`);
  async function menu() {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Workspace options", exact: true }).click();
  }
  async function toggle(label) {
    await menu();
    await page.getByRole("menuitemcheckbox", { name: label, exact: true }).click();
    await page.keyboard.press("Escape");
  }
  try {
    for (const [provider, identifier, url] of [
      ["linear", "ENG-123", "https://linear.app/acceptance/issue/ENG-123"],
      ["jira", "KAN-1", "https://example.atlassian.net/browse/KAN-1"],
    ]) {
      const reply = await page.evaluate(({ worktreeId, issue }) => window.drogon.project.worktreeLinkIssue({ worktreeId, issue }), {
        worktreeId: worktree.id, issue: { provider, identifier, title: `Acceptance ${provider} association`, url },
      });
      assert.equal(reply.ok, true, JSON.stringify(reply));
      assert.equal(reply.result.worktreeId, worktree.id);
    }
    await menu();
    await page.getByRole("menuitemradio", { name: "Detailed", exact: true }).click();
    await page.keyboard.press("Escape");
    // Labels follow main's reference-faithful WorkspaceOptionsMenuSections
    // tables (workspace-options-state.ts): card-layout preset Detailed/Compact,
    // group-by None/Project/Status/PR. Persisted ids are unchanged.
    for (const [groupBy, label] of [["none", "None"], ["repo", "Project"], ["workspace-status", "Status"], ["pr-status", "PR"]]) {
      await menu();
      await page.getByRole("group", { name: "Group by", exact: true }).getByRole("menuitemradio", { name: label, exact: true }).click();
      await page.keyboard.press("Escape");
      await card().getByText("ENG-123", { exact: true }).waitFor();
      await card().getByText("KAN-1", { exact: true }).waitFor();
      await card().getByText("BM2 child", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.drogon.ui.get().then((value) => value.groupBy)), groupBy);
      for (const [property, text] of [["Linear issue", "ENG-123"], ["Jira issue", "KAN-1"], ["Notes", "BM2 child"]]) {
        await toggle(property);
        await card().getByText(text, { exact: true }).waitFor({ state: "hidden" });
        await toggle(property);
        await card().getByText(text, { exact: true }).waitFor();
      }
      checks.push(`workspace-properties-real-associations-notes-${groupBy}`);
    }
    await toggle("Linear issue");
    await page.reload();
    await page.getByRole("button", { name: "Workspace options", exact: true }).waitFor();
    await card().getByText("KAN-1", { exact: true }).waitFor();
    assert.equal(await card().getByText("ENG-123", { exact: true }).count(), 0);
    assert.ok(!(await page.evaluate(() => window.drogon.ui.get())).worktreeCardProperties.includes("linear-issue"));
    checks.push("workspace-property-visibility-persists-through-real-reload");
    await menu();
    await page.getByRole("menuitemradio", { name: "Compact", exact: true }).click();
    await page.keyboard.press("Escape");
    await card().getByText("KAN-1", { exact: true }).waitFor({ state: "hidden" });
    await card().getByText("BM2 child", { exact: true }).waitFor({ state: "hidden" });
    const compact = await page.evaluate(() => window.drogon.ui.get());
    assert.deepEqual([...compact.worktreeCardProperties].sort(), ["status", "unread"]);
    checks.push("workspace-compact-applies-source-metadata-preset-not-only-density");
    await menu();
    await page.getByRole("menuitemradio", { name: "Detailed", exact: true }).click();
    await page.keyboard.press("Escape");
    await card().getByText("ENG-123", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "workspace-properties-linked-issues.png"), animations: "disabled" });
    assert.equal(await card().locator("button button").count(), 0, "issue actions cannot nest inside workspace buttons");
    checks.push("workspace-default-restores-real-metadata-with-independent-actions");
  } finally {
    await page.keyboard.press("Escape");
    for (const provider of ["linear", "jira"]) {
      const reply = await page.evaluate(({ worktreeId, provider }) => window.drogon.project.worktreeUnlinkIssue({ worktreeId, provider }), { worktreeId: worktree.id, provider });
      assert.equal(reply.ok, true, JSON.stringify(reply));
      assert.equal(reply.result.worktreeId, worktree.id);
    }
    await page.evaluate((preferences) => window.drogon.ui.set(preferences), original);
  }
  return checks;
}
