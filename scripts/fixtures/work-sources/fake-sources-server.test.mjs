// The fake sources server answers the Linear operations the daemon sends;
// here the board picker's recommendation query (`DrogonLinearAssigned`):
// the viewer's open assigned issues with their team, never a completed,
// canceled, deleted or someone else's issue.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Starts the fixture on `data`, returns its port; teardown on any outcome. */
async function listen(t, data) {
  const dir = mkdtempSync(path.join(tmpdir(), "dsrc-"));
  const file = path.join(dir, "site.json");
  writeFileSync(file, JSON.stringify(data));
  const child = spawn(
    process.execPath,
    [path.join(here, "fake-sources-server.mjs"), "--data", file, "--port", "0"],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(async () => {
    child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((resolve) => child.on("close", resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((_, reject) =>
    child.on("exit", (code) =>
      reject(new Error(`fixture exited with ${code}: ${stderr.trim()}`)),
    ),
  );
  const listening = (async () => {
    for await (const line of readline.createInterface({
      input: child.stdout,
    })) {
      const match = /^LISTEN (\d+)$/.exec(line);
      if (match) return Number(match[1]);
    }
    throw new Error("fixture closed stdout before listening");
  })();
  return Promise.race([listening, exited]);
}

async function linear(port, apiKey, query, variables = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/linear/graphql`, {
    method: "POST",
    headers: { authorization: apiKey, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

async function github(port, token, query, variables = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/github/graphql`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

async function githubRest(port, token, pathname) {
  const res = await fetch(`http://127.0.0.1:${port}/github${pathname}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  return res.json();
}

/** `POST /__fixture/<service>/incomplete`. */
async function incomplete(port, service, collection, mode = null) {
  const res = await fetch(
    `http://127.0.0.1:${port}/__fixture/${service}/incomplete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ collection, mode }),
    },
  );
  assert.equal(res.status, 200, `the incomplete control answers ${collection}`);
}

test("DrogonLinearAssigned lists the viewer's open assigned issues with their team", async (t) => {
  const data = JSON.parse(
    readFileSync(path.join(here, "data", "sources-site.json"), "utf8"),
  );
  const eng = data.linear.teams.find((team) => team.id === "team-eng");
  const done = eng.states.find((state) => state.type === "completed");
  const canceled = eng.states.find((state) => state.type === "canceled");
  const open = eng.states.find(
    (state) => !["completed", "canceled"].includes(state.type),
  );
  const me = data.linear.viewer.name;
  // Only ENG-A counts: done, canceled, deleted and someone else's do not.
  data.linear.issues = [
    ...data.linear.issues.filter((issue) => issue.team !== "team-eng"),
    {
      ...data.linear.issues[0],
      id: "a",
      identifier: "ENG-A",
      team: "team-eng",
      assignee: me,
      state: open.id,
    },
    {
      ...data.linear.issues[0],
      id: "b",
      identifier: "ENG-B",
      team: "team-eng",
      assignee: me,
      state: done.id,
    },
    ...(canceled
      ? [
          {
            ...data.linear.issues[0],
            id: "c",
            identifier: "ENG-C",
            team: "team-eng",
            assignee: me,
            state: canceled.id,
          },
        ]
      : []),
    {
      ...data.linear.issues[0],
      id: "d",
      identifier: "ENG-D",
      team: "team-eng",
      assignee: me,
      state: open.id,
      deleted: true,
    },
    {
      ...data.linear.issues[0],
      id: "e",
      identifier: "ENG-E",
      team: "team-eng",
      assignee: "Ana Lopez",
      state: open.id,
    },
  ];
  const port = await listen(t, data);
  const reply = await linear(
    port,
    data.linear.apiKey,
    "query DrogonLinearAssigned { viewer { assignedIssues(first: 100) { nodes { team { id } } } } }",
  );
  const teams = reply.data.viewer.assignedIssues.nodes
    .map((node) => node.team.id)
    .sort();
  assert.deepEqual(teams, ["team-eng", "team-ops"]);
});

// Every connection the daemon walks reports its `pageInfo`, and the
// incomplete control makes a source answer the way a broken one does: the
// Work board's fail-closed tests need a page that claims another one
// without naming a cursor, and a REST listing that never ends.
const TEAMS = `query DrogonLinearTeams($after: String) { teams(first: 100, after: $after) {
   nodes { id } pageInfo { hasNextPage endCursor } } }`;
const ASSIGNED = `query DrogonLinearAssigned($after: String) { viewer {
   assignedIssues(first: 100, after: $after) { nodes { team { id } } pageInfo { hasNextPage endCursor } } } }`;
const TEAM = `query DrogonLinearTeam($id: String!) { team(id: $id) {
   states(first: 100) { nodes { id } pageInfo { hasNextPage endCursor } }
   cycles(first: 100) { nodes { id } pageInfo { hasNextPage endCursor } } } }`;
const ISSUES = `query DrogonLinearIssues($id: String!, $after: String) { team(id: $id) {
   issues(first: 100, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } } }`;
const ITEMS = `query DrogonGhItems($id: ID!, $after: String) { node(id: $id) {
   items(first: 100, after: $after) { nodes { id fieldValues(first: 50) { nodes { __typename } pageInfo { hasNextPage endCursor } } }
     pageInfo { hasNextPage endCursor } } } }`;
const PROJECT = `query DrogonGhProject($id: ID!) { node(id: $id) {
   fields(first: 50) { nodes { __typename } pageInfo { hasNextPage endCursor } } } }`;
const PROJECTS = `query DrogonGhProjects { viewer {
   projectsV2(first: 50) { nodes { id } pageInfo { hasNextPage endCursor } }
   organizations(first: 50) { nodes { login } pageInfo { hasNextPage endCursor } } } }`;
const WHOLE = { hasNextPage: false, endCursor: null };
const NO_CURSOR = { hasNextPage: true, endCursor: null };

test("every walked connection reports pageInfo, and one can be made to lie", async (t) => {
  const data = JSON.parse(
    readFileSync(path.join(here, "data", "sources-site.json"), "utf8"),
  );
  const port = await listen(t, data);
  const key = data.linear.apiKey;
  const token = data.github.token;
  const project = data.github.projects[0].id;

  // Linear: the team list, the recommendation counts, a team's states and
  // cycles, and the issue walk itself.
  assert.deepEqual((await linear(port, key, TEAMS)).data.teams.pageInfo, WHOLE);
  assert.deepEqual(
    (await linear(port, key, ASSIGNED)).data.viewer.assignedIssues.pageInfo,
    WHOLE,
  );
  const team = (await linear(port, key, TEAM, { id: "team-eng" })).data.team;
  assert.deepEqual(team.states.pageInfo, WHOLE);
  assert.deepEqual(team.cycles.pageInfo, WHOLE);
  const page = (await linear(port, key, ISSUES, { id: "team-eng" })).data.team
    .issues;
  assert.equal(page.pageInfo.hasNextPage, true, "the fixture pages in threes");
  assert.equal(page.pageInfo.endCursor, "3");
  const rest = (
    await linear(port, key, ISSUES, { id: "team-eng", after: "3" })
  ).data.team.issues;
  assert.equal(rest.pageInfo.hasNextPage, false);

  // GitHub: project items, one item's field values, a project's field list
  // and the picker's own listings.
  const items = (await github(port, token, ITEMS, { id: project })).data.node
    .items;
  assert.equal(items.pageInfo.endCursor, "3");
  assert.deepEqual(items.nodes[0].fieldValues.pageInfo, WHOLE);
  assert.deepEqual(
    (await github(port, token, PROJECT, { id: project })).data.node.fields
      .pageInfo,
    WHOLE,
  );
  const picker = (await github(port, token, PROJECTS)).data.viewer;
  assert.deepEqual(picker.projectsV2.pageInfo, WHOLE);
  assert.deepEqual(picker.organizations.pageInfo, WHOLE);

  // A page that claims another one and names no cursor, per collection.
  for (const [service, collection, read] of [
    ["linear", "teams", async () => (await linear(port, key, TEAMS)).data.teams],
    [
      "linear",
      "assigned",
      async () =>
        (await linear(port, key, ASSIGNED)).data.viewer.assignedIssues,
    ],
    [
      "linear",
      "states",
      async () =>
        (await linear(port, key, TEAM, { id: "team-eng" })).data.team.states,
    ],
    [
      "linear",
      "cycles",
      async () =>
        (await linear(port, key, TEAM, { id: "team-eng" })).data.team.cycles,
    ],
    [
      "linear",
      "issues",
      async () =>
        (await linear(port, key, ISSUES, { id: "team-eng" })).data.team.issues,
    ],
    [
      "github",
      "items",
      async () => (await github(port, token, ITEMS, { id: project })).data.node.items,
    ],
    [
      "github",
      "item-fields",
      async () =>
        (await github(port, token, ITEMS, { id: project })).data.node.items
          .nodes[0].fieldValues,
    ],
    [
      "github",
      "project-fields",
      async () =>
        (await github(port, token, PROJECT, { id: project })).data.node.fields,
    ],
    [
      "github",
      "projects",
      async () => (await github(port, token, PROJECTS)).data.viewer.projectsV2,
    ],
  ]) {
    await incomplete(port, service, collection, "null-cursor");
    assert.deepEqual(
      (await read()).pageInfo,
      NO_CURSOR,
      `${service} ${collection} claims another page and names none`,
    );
    await incomplete(port, service, collection, null);
    assert.notDeepEqual((await read()).pageInfo, NO_CURSOR, `${collection} is whole again`);
  }

  // `over-cap` never reaches a last page: the walk runs into its cap.
  await incomplete(port, "linear", "issues", "over-cap");
  const forever = (await linear(port, key, ISSUES, { id: "team-eng", after: "900" }))
    .data.team.issues;
  assert.equal(forever.pageInfo.hasNextPage, true);
  assert.equal(forever.nodes.length, 0, "past the end and still not the last page");
  await incomplete(port, "linear", "issues", null);

  // REST has no cursor, so an endless listing is one full page after another.
  assert.equal(
    (await githubRest(port, token, "/user/repos?per_page=100&page=4")).length,
    0,
  );
  await incomplete(port, "github", "repos", "over-cap");
  assert.equal(
    (await githubRest(port, token, "/user/repos?per_page=100&page=4")).length,
    100,
  );
  await incomplete(port, "github", "repos", null);
  const repo = data.github.repos[0].full_name;
  await incomplete(port, "github", "repo-issues", "over-cap");
  const issues = await githubRest(
    port,
    token,
    `/repos/${repo}/issues?state=all&per_page=100&page=9`,
  );
  assert.equal(issues.length, 100);
  assert.equal(new Set(issues.map((i) => i.number)).size, 100, "distinct issues");
  await incomplete(port, "github", "repo-issues", null);
  assert.ok(
    (await githubRest(port, token, `/repos/${repo}/issues?state=all&per_page=100&page=9`))
      .length < 100,
  );
});
