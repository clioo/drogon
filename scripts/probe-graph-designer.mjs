// The graph-design probe: THE GRAPH MUST BE DESIGNABLE, NOT JUST
// OBSERVABLE. Drives the REAL app over CDP from a workspace with NO graph:
//
//   1. the honest empty state names the ownership split (the `intent` half
//      is the plan, the user's to author; `state` is the daemon's) and
//      offers the primary action "Design the graph";
//   2. the canvas: two nodes are added and named, given prompts, a harness
//      and (where the contract has one) a model picked from the REAL
//      per-harness picker; a dependency edge is drawn by DRAGGING one
//      node's port onto the other;
//   3. saving writes ONLY the intent half through the daemon's
//      `graph.write_intent`: the probe reads `.drogon/graph.json` from
//      disk and proves the exact designed intent, with an EMPTY state
//      half — nothing invented;
//   4. editing round-trips: the first node's harness changes via the real
//      picker, the shell honesty rule applies (no model on a shell node),
//      and a second save lands;
//   5. Run goes through the ONE existing path — graph.compile shows the
//      runtime's own findings in the review panel, graph.run launches —
//      and the probe watches the nodes' statuses change from the
//      daemon's silence to `succeeded` with real run ids recorded in the
//      state half, while the intent bytes stay untouched;
//   6. screenshots in light AND dark at 1440/1100/900/760 with a strict
//      no-horizontal-overflow budget.
//
// The executed nodes are `shell` on purpose: the acceptance must never run
// paid model inference. The harness/model pickers themselves are driven
// against the real catalogs (harness.list / harness.models), and the
// saved intent proves the picks landed.

import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { selectSettingsTheme } from "./acceptance-theme.mjs";

const WIDTHS = [1440, 1100, 900, 760];

const NODE_ONE_TITLE = "Discover the repo";
// A shell node EXECUTES its prompt as a shell command — that is what
// the compiler emits. Prose here would exit 127.
const NODE_ONE_PROMPT = "printf 'GRAPH-STEP-ONE\\n'";
const NODE_TWO_TITLE = "Print marker";
const NODE_TWO_PROMPT = "printf 'GRAPH-STEP-TWO\\n'";
const TYPED_MODEL = "acceptance-claude-model";
const VERIFY = "true";

async function shot(page, output, name) {
  await page.screenshot({
    path: path.join(output, name),
    animations: "disabled",
  });
}

async function readGraph(workspace) {
  return JSON.parse(
    await readFile(path.join(workspace, ".drogon", "graph.json"), "utf8"),
  );
}

/** Waits until the locator's text contains the expected fragment. */
async function waitForText(locator, fragment, timeout = 15000) {
  await locator
    .getByText(fragment, { exact: false })
    .first()
    .waitFor({ timeout });
}

export async function probeGraphDesigner({ page, workspace, output, cli, dataDir }) {
  const checks = [];
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = page.locator('[data-testid="mentu-tab-panel"]');

  // 1. With NO graph on disk, the empty state states the ownership split
  //    and offers the design action.
  await page.getByRole("button", { name: "New tab", exact: true }).click();
  await page.getByRole("menuitem", { name: "Mentu", exact: true }).click();
  await page.getByRole("tab", { name: "Mentu", exact: true }).waitFor();
  const empty = panel.locator('[data-testid="work-graph-empty"]');
  await empty.waitFor({ timeout: 15000 });
  const emptyText = (await empty.innerText()) ?? "";
  assert.match(emptyText, /intent/, "the empty state must name the intent half");
  assert.match(emptyText, /state/, "the empty state must name the state half");
  assert.match(
    emptyText,
    /yours to author/i,
    "the empty state must say the plan is the user's to author",
  );
  assert.match(
    emptyText,
    /only the daemon observes/i,
    "the empty state must say the state half is the daemon's",
  );
  await shot(page, output, "work-graph-empty-light.png");
  await empty.locator('[data-testid="work-graph-design-new"]').click();
  const designer = panel.locator('[data-testid="work-graph-designer"]');
  await designer.waitFor();
  checks.push("graph-empty-state-offers-design-and-states-ownership");

  // 2a. Node one: name, prompt, verify command, harness = Claude Code
  //     (the real catalog), model typed through the real picker.
  await designer.locator('[data-testid="design-add-node"]').click();
  await designer.locator('[data-testid="design-field-title"]').waitFor();
  await designer.locator('[data-testid="design-field-title"]').fill(NODE_ONE_TITLE);
  await waitForText(designer, NODE_ONE_TITLE);
  await designer.locator('[data-testid="design-field-prompt"]').fill(NODE_ONE_PROMPT);
  await designer.locator('[data-testid="design-field-verify"]').fill(VERIFY);
  await page.getByRole("combobox", { name: "Harness", exact: true }).click();
  await page.getByRole("option", { name: "Claude Code", exact: false }).first().click();
  // The real per-harness model picker: search, then pick the typed row —
  // a host that enumerates nothing says so, and a typed id rides
  // explicitly unverified.
  await page.getByRole("button", { name: "Browse models" }).click();
  const search = page.getByRole("combobox", { name: "Search models" });
  await search.waitFor();
  await search.fill(TYPED_MODEL);
  await page
    .getByRole("option", { name: new RegExp(TYPED_MODEL) })
    .first()
    .click();
  const modelValue = await designer
    .locator('[data-testid="design-field-model"]')
    .inputValue();
  assert.equal(modelValue, TYPED_MODEL);
  await waitForText(designer, "unverified");
  checks.push("graph-designer-picks-harness-and-model-from-the-real-pickers");

  // 2b. Node two: name + prompt.
  await designer.locator('[data-testid="design-add-node"]').click();
  await designer.locator('[data-testid="design-field-title"]').waitFor();
  await designer.locator('[data-testid="design-field-title"]').fill(NODE_TWO_TITLE);
  await designer.locator('[data-testid="design-field-prompt"]').fill(NODE_TWO_PROMPT);

  // 2c. Draw the dependency by dragging node one's port onto node two.
  const portBox = await page
    .getByTestId("design-node-port-discover-the-repo")
    .boundingBox();
  const targetBox = await page
    .getByTestId("design-node-print-marker")
    .boundingBox();
  assert.ok(portBox && targetBox, "both cards and the port must be laid out");
  await page.mouse.move(portBox.x + portBox.width / 2, portBox.y + portBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 10 },
  );
  await page.mouse.up();
  await designer
    .locator('[data-design-edge="discover-the-repo->print-marker"]')
    .waitFor({ timeout: 10000 });
  checks.push("graph-designer-draws-a-dependency-by-dragging-a-port");

  // 3. Save: the daemon writes ONLY the intent half; the state half must
  //    hold nothing invented.
  await designer.locator('[data-testid="design-save"]').click();
  await designer.locator('[data-testid="design-status-saved"]').waitFor({ timeout: 15000 });
  const saved = await readGraph(workspace);
  assert.equal(saved.version, 1);
  assert.equal(saved.intent.nodes.length, 2, JSON.stringify(saved.intent, null, 2));
  const one = saved.intent.nodes.find((node) => node.id === "discover-the-repo");
  const two = saved.intent.nodes.find((node) => node.id === "print-marker");
  assert.ok(one && two, `both designed nodes must exist: ${JSON.stringify(saved.intent)}`);
  assert.equal(one.title, NODE_ONE_TITLE);
  assert.equal(one.harness, "claude");
  assert.equal(one.model, TYPED_MODEL);
  assert.equal(one.prompt, NODE_ONE_PROMPT);
  assert.deepEqual(one.verifyCommands, [VERIFY]);
  assert.deepEqual(one.dependsOn, []);
  assert.deepEqual(two.dependsOn, ["discover-the-repo"]);
  assert.equal(two.harness, "shell");
  assert.equal(two.prompt, NODE_TWO_PROMPT);
  // The daemon's own projection may record the intent nodes as `idle` —
  // the contract's "never observed" status. Nothing may be INVENTED: no
  // run ids, timestamps, evidence or outcomes the daemon never saw.
  for (const stateNode of saved.state.nodes) {
    assert.equal(stateNode.status, "idle", JSON.stringify(saved.state, null, 2));
    assert.equal(stateNode.runId, undefined, JSON.stringify(stateNode));
    assert.equal(stateNode.startedAt, undefined, JSON.stringify(stateNode));
    assert.equal(stateNode.evidence, undefined, JSON.stringify(stateNode));
    assert.equal(stateNode.lastError, undefined, JSON.stringify(stateNode));
  }
  assert.ok(typeof saved.state.updatedAt === "string");
  checks.push("graph-save-writes-exactly-the-designed-intent-and-no-state");

  // 4. Edits round-trip through the same seam: harness via the real
  //    picker, and the shell honesty rule (a shell node has no model).
  await page.getByTestId("design-node-discover-the-repo").click();
  await page.getByRole("combobox", { name: "Harness", exact: true }).click();
  await page
    .getByRole("option", { name: /shell — run a local command/ })
    .click();
  const shellNote = designer.locator('[data-testid="design-shell-no-model"]');
  await shellNote.waitFor();
  assert.match(
    (await shellNote.innerText()) ?? "",
    /no model/,
    "a shell node must say honestly that it has no model",
  );
  assert.equal(
    await designer.locator('[data-testid="design-field-model"]').count(),
    0,
    "the model field must be gone for a shell node",
  );
  await designer.locator('[data-testid="design-save"]').click();
  await designer.locator('[data-testid="design-status-saved"]').waitFor({ timeout: 15000 });
  const edited = await readGraph(workspace);
  assert.equal(edited.intent.nodes.find((node) => node.id === "discover-the-repo").harness, "shell");
  checks.push("graph-edit-round-trips-and-shell-nodes-lose-nothing");

  // 5. Run through the ONE existing path: compile → review → run.
  await designer.locator('[data-testid="design-run"]').click();
  const review = designer.locator('[data-testid="design-review"]');
  await review.waitFor({ timeout: 15000 });
  assert.match(
    (await review.innerText()) ?? "",
    /discover-the-repo → print-marker/,
    "the review must show the execution order",
  );
  await shot(page, output, "work-graph-designer-review.png");
  await designer.locator('[data-testid="design-review-approve"]').click();
  await designer.locator('[data-testid="design-run-launched"]').waitFor({ timeout: 30000 });
  const launched = (await designer.locator('[data-testid="design-run-launched"]').innerText()) ?? "";
  const runId = launched.match(/run_[A-Za-z0-9]+/)?.[0] ?? null;
  await designer.locator('[data-testid="design-watch"]').click();
  await panel.locator('[data-testid="work-graph-pane"]').waitFor();
  checks.push("graph-run-goes-through-compile-review-approve");

  // Both nodes flip from the daemon's silence to succeeded, with real run
  // records. The pane's own poll does the watching.
  try {
    const succeeded = panel.locator('[data-work-graph-status="succeeded"]');
    await succeeded.first().waitFor({ timeout: 45000 });
    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-work-graph-status="succeeded"]').length >= 2,
      undefined,
      { timeout: 60000 },
    );
  } catch (error) {
    // Deep diagnostics: what does the pane render, does a manual refresh
    // advance the daemon's projection, and what does the run row say?
    const paneHtml = await panel
      .locator('[data-testid="work-graph-pane"]')
      .innerHTML()
      .catch((e) => `innerHTML failed: ${e}`);
    const paneSnippet = String(paneHtml).replace(/\s+/g, " ").slice(0, 1200);
    await panel.locator('[data-testid="work-graph-refresh"]').click().catch(() => {});
    await page.waitForTimeout(2500);
    const afterRefresh = await readGraph(workspace).catch((readError) => ({
      readError: String(readError),
    }));
    const after = await readGraph(workspace).catch((readError) => ({
      readError: String(readError),
    }));
    const notices = await panel
      .locator('[data-testid="design-notice"], [role="alert"]')
      .allTextContents()
      .catch(() => []);
    const runIdMatch = launched.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
    );
    // The run row as the DAEMON sees it, through the renderer's own gated
    // Mentu bridge (the daemon answer, not a file guess).
    let runStatus = null;
    try {
      runStatus = runIdMatch
        ? await page.evaluate(async (runId) => {
            const result = await window.drogon.mentu.mentuRunStatus({ runId });
            return result;
          }, runIdMatch[0])
        : { skipped: "no run id in the launch panel" };
    } catch (statusError) {
      runStatus = { error: String(statusError) };
    }
    let runtimeProcesses = null;
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync(
        "/bin/ps",
        ["-axo", "pid,stat,etime,command"],
        { maxBuffer: 4 * 1024 * 1024 },
      );
      const lines = String(stdout)
        .split("\n")
        .filter((line) => line.includes("mentu-recipes"));
      runtimeProcesses = lines.length ? lines : "no mentu-recipes process";
    } catch (psError) {
      runtimeProcesses = String(psError);
    }
    throw new Error(
      `the nodes never reached succeeded. launch panel: ${JSON.stringify(launched)}; " +
      "graph.json after launch: ${JSON.stringify(after)}; after manual refresh: ${JSON.stringify(afterRefresh)}; " +
      "pane: ${JSON.stringify(paneSnippet)}; notices: ${JSON.stringify(notices)}; " +
      "runStatus via bridge: ${JSON.stringify(runStatus)?.slice(0, 2500)}; " +
      "runtime processes: ${JSON.stringify(runtimeProcesses)}; original: ${error}`,
    );
  }
  const after = await readGraph(workspace);
  assert.equal(after.intent.nodes.length, 2, "the run must never touch the intent");
  // The intent bytes are exactly what the designer saved — including the
  // canvas positions, which the daemon preserves without understanding.
  const afterOne = after.intent.nodes.find((node) => node.id === "discover-the-repo");
  const afterTwo = after.intent.nodes.find((node) => node.id === "print-marker");
  assert.ok(afterOne && afterTwo, JSON.stringify(after.intent, null, 2));
  assert.equal(afterOne.harness, "shell");
  assert.equal(afterOne.model, "");
  assert.deepEqual(afterOne.position, { x: 48, y: 24 }, JSON.stringify(afterOne));
  assert.deepEqual(afterTwo.dependsOn, ["discover-the-repo"]);
  assert.equal(after.state.nodes.length, 2, JSON.stringify(after.state, null, 2));
  for (const stateNode of after.state.nodes) {
    assert.equal(stateNode.status, "succeeded", JSON.stringify(after.state, null, 2));
    assert.ok(stateNode.runId, `each node records its run: ${JSON.stringify(stateNode)}`);
  }
  if (runId) {
    assert.ok(
      after.state.nodes.some((node) => node.runId === runId),
      `the launched run id must be attributed: ${runId} vs ${JSON.stringify(after.state)}`,
    );
  }
  // Inspector: the evidence lives on the node, resolved through the
  // existing mentu.run_evidence RPC.
  await panel.locator('[data-work-graph-node="print-marker"]').click();
  const inspector = panel.locator('[data-testid="work-graph-node-inspector"]');
  await waitForText(inspector, "Exit code:");
  assert.match((await inspector.innerText()) ?? "", /GRAPH-STEP-TWO/);
  checks.push("graph-run-records-state-while-intent-stays-untouched");

  // 6. Screenshots: designed graph in light and dark, at every acceptance
  //    width, with a strict no-horizontal-overflow budget.
  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await page.getByRole("tab", { name: "Mentu", exact: true }).click();
    await panel.locator('[data-testid="work-graph-pane"]').waitFor();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      assert.ok(
        overflow <= 0,
        `the work graph must not scroll horizontally at ${width}px ${theme} (overflow ${overflow}px)`,
      );
      await shot(page, output, `work-graph-run-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    if (theme === "dark") {
      // The designed canvas itself, in dark: the designer's cards, edges
      // and inspector — plus the honest designed/live distinction.
      await panel.locator('[data-testid="work-graph-design"]').click();
      await designer.waitFor();
      await shot(page, output, "work-graph-designer-dark.png");
      await designer.locator('[data-testid="design-done"]').click();
      await panel.locator('[data-testid="work-graph-pane"]').waitFor();
    }
    await shot(page, output, `work-graph-run-${theme}-hero.png`);
  }
  await selectSettingsTheme(page, "light");
  await page.getByRole("tab", { name: "Mentu", exact: true }).click();
  await panel.locator('[data-testid="work-graph-pane"]').waitFor();
  checks.push("graph-screenshots-light-dark-and-no-overflow-1440-1100-900-760");

  // Leave the strip as the probe found it: the Mentu tab probe that runs
  // next expects a strip without a Mentu tab.
  await page.getByRole("button", { name: "Close tab Mentu", exact: true }).click();
  await page
    .getByRole("tab", { name: "Mentu", exact: true })
    .waitFor({ state: "detached" });

  return checks;
}
