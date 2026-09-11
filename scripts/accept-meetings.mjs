// Focused CDP acceptance for the Meetings SECTION (the owner's own Write That
// Down notes): the honest states, search and filtering over a 320-transcript
// corpus, paging, extraction with a fixture local model, the commitment
// ledger, the read-only guarantee and the light/dark sweeps at
// 1440/1100/900/760.
//
// Real dev app over CDP in a BACKGROUND window (DROGON_BACKGROUND_WINDOW=1,
// its own temp DROGON_DATA_DIR/DROGON_ELECTRON_PROFILE, window parked
// off-screen). The notes are fixtures written by this script — never the
// developer's own ~/Transcripts, and never real model inference: `pi` on the
// daemon's PATH is a fixture shell script that echoes deterministic JSON.
//
// The one daemon runs with WTD_OUTPUT_DIR pointing at a path this script
// creates underneath it, so the SAME app process honestly reports "the folder
// does not exist", then "the folder is empty", then the real corpus. That
// live transition is the point: the states are not mocked.
//
// Usage: node scripts/accept-meetings.mjs [--keep]
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import {
  startAcceptanceProcess,
  stopAcceptanceProcess,
  runAcceptanceProcess,
} from "./acceptance-process.mjs";
import { emulatePageFocus } from "./acceptance-page-focus.mjs";
import { selectSettingsTheme } from "./acceptance-theme.mjs";

const keep = process.argv.includes("--keep");
const root = fileURLToPath(new URL("..", import.meta.url));
const appDir = path.join(root, "apps", "desktop");
const electron = createRequire(path.join(appDir, "package.json"))("electron");
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
const daemonBin = path.join(root, "target", "debug", exe("drogond"));
const cliBin = path.join(root, "target", "debug", exe("drogon-cli"));

/** Transcripts the corpus holds. The owner has 327; 320 is the same problem. */
const CORPUS = 320;
/** The query only these notes carry, so a result count is exact. */
const SEARCH_TOKEN = "zanzibar";
const SEARCH_TOKEN_NOTES = 3;
/**
 * The transcript line each token note carries, by index. The fixture model
 * copies a real line out of the prompt, so an assertion against these proves
 * the quote the panel shows is the note's own text and not the model's.
 */
const TOKEN_LINES = Array.from(
  { length: SEARCH_TOKEN_NOTES },
  (_, index) => `[00:00] routine status of meeting ${index} ${SEARCH_TOKEN} omnibus`,
);

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "meetings-"));
const dataDir = path.join(fixtureRoot, "data");
const notesDir = path.join(fixtureRoot, "Transcripts");
const binDir = path.join(fixtureRoot, "bin");
const output = path.join(root, ".preflight", "acceptance", `meetings-${Date.now()}`);
await mkdir(output, { recursive: true });
await mkdir(binDir, { recursive: true });

/**
 * The fixture local model. It is what the daemon resolves as `pi` on PATH, so
 * `meeting investigate` runs for real end to end — argv planning, the spawn,
 * the bounded read — with a deterministic answer instead of a model. It also
 * refuses any argv that names another provider or model, so a regression that
 * tried to bill the owner would fail this script.
 */
await writeFile(
  path.join(binDir, "pi"),
  `#!/bin/sh
case "$*" in
  *"--provider dgx-spark"*) ;;
  *) echo "wrong provider" >&2; exit 9 ;;
esac
case "$*" in
  *"--model qwen3.8-flash-next-nvidia-nvfp4"*) ;;
  *) echo "wrong model" >&2; exit 9 ;;
esac
case "$*" in
  *"extract commitments from ONE meeting transcript"*)
    line=$(printf '%s' "$*" | grep -o '\\[0[0-9]:[0-9][0-9]\\].*' | head -1)
    quote=$(printf '%s' "$line" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    printf '{"summary":"Fixture summary of the indexed meeting.","decisions":[{"text":"Fixture decision read from the note","quote":"%s"}],"actions":[{"text":"Fixture action the note states","owner":"Carlos","quote":"%s","confidence":"high"},{"text":"Invented action","quote":"I will migrate the database tonight","confidence":"high"}],"openQuestions":[]}\\n' "$quote" "$quote"
    exit 0
    ;;
esac
echo "fixture harness has nothing to do" >&2
exit 0
`,
  { mode: 0o755 },
);

const report = {
  kind: "meetings-cdp",
  corpus: CORPUS,
  output,
  checks: [],
  screenshots: [],
  states: {},
  timings: {},
  processes: {},
};
let daemon = null;
let desktop = null;
let browser = null;
let page = null;
const ownedPids = new Set();

function ownPid(pid) {
  if (pid) ownedPids.add(pid);
}

async function allProcesses() {
  const { stdout } = await runAcceptanceProcess("ps", ["-Ao", "pid=,ppid="], { timeout: 5000 });
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, ppid]) => Number.isInteger(pid) && Number.isInteger(ppid))
    .map(([pid, ppid]) => ({ pid, ppid }));
}

async function descendants(roots) {
  const all = await allProcesses();
  const found = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of all) {
      if (found.has(item.ppid) && !found.has(item.pid)) {
        found.add(item.pid);
        grew = true;
      }
    }
  }
  return [...found];
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopOwned(child, label) {
  if (!child) return;
  const result = await stopAcceptanceProcess(child);
  report.processes[label] = result.verdict;
  if (result.verdict !== "exited") {
    throw new Error(`${label} did not exit cleanly: ${JSON.stringify(result)}`);
  }
}

async function waitForDaemon() {
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      const response = await runAcceptanceProcess(
        cliBin,
        ["--data-dir", dataDir, "--json", "status"],
        { timeout: 2000 },
      );
      assert.equal(JSON.parse(response.stdout).ok, true);
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(100);
    }
  }
}

async function launchDesktop() {
  desktop = startAcceptanceProcess(electron, [appDir, "--remote-debugging-port=0"], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      DROGON_DATA_DIR: dataDir,
      DROGON_ELECTRON_PROFILE: path.join(fixtureRoot, "electron"),
      DROGON_BACKGROUND_WINDOW: "1",
      // Park the window off-screen at the widest sweep width, exactly like
      // scripts/fidelity/compare-surfaces.mjs does; narrower widths use CDP
      // viewport emulation because the app cannot be asked to resize itself
      // in a background window.
      DROGON_WINDOW_BOUNDS: "1440x900+4000+4000",
    },
  });
  ownPid(desktop.pid);
  const endpoint = await new Promise((resolve, reject) => {
    let tail = "";
    const timer = setTimeout(() => reject(new Error(`no debugging endpoint: ${tail}`)), 30000);
    desktop.once("exit", () => reject(new Error(`electron exited before connecting: ${tail}`)));
    desktop.stderr.on("data", (bytes) => {
      tail = (tail + bytes.toString()).slice(-8192);
      const match = tail.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  for (let i = 0; i < 240 && !browser.contexts()[0]?.pages()[0]; i += 1) await delay(50);
  page = browser.contexts()[0].pages()[0];
  assert.ok(page, "electron must create a rendered page");
  await emulatePageFocus(page);
  page.setDefaultTimeout(20000);
  await page.getByRole("button", { name: "Reveal active workspace", exact: true }).waitFor();
}

async function shot(name) {
  const file = path.join(output, name);
  await page.screenshot({ path: file, animations: "disabled" });
  report.screenshots.push(name);
}

async function assertNoOverflow(label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, `horizontal overflow at ${label}`);
  report.checks.push(`no-horizontal-overflow-${label}`);
}

async function openMeetings() {
  await page.getByRole("button", { name: "Meetings", exact: true }).first().click();
  await page.getByRole("heading", { name: "Meeting transcripts", exact: true }).waitFor();
}

async function refreshMeetings() {
  await page.getByRole("button", { name: "Refresh meetings", exact: true }).click();
}

/** Writes one conversation exactly as Write That Down's TranscriptWriter does. */
async function writeNote({ date, time, duration, title, body }) {
  const file =
    duration === "recording…"
      ? `${time}_recording_.md`
      : `${time}_${duration.replace(" min", "min")}.md`;
  const colon = time.replace("-", ":");
  const dir = path.join(notesDir, date);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, file),
    `# ${title}\n**Date:** ${date} ${colon}\n**Duration:** ${duration}\n\n## Transcript\n\n${body}\n`,
  );
}

/**
 * The fixture corpus: `count` transcripts spread over real calendar days
 * ending today, so the date presets mean something. Returns the dates it
 * wrote, newest first, so the script can compute expectations instead of
 * guessing at them.
 */
async function seedCorpus(count) {
  const dates = [];
  const formatter = (day) =>
    `${day.getFullYear()}-${`${day.getMonth() + 1}`.padStart(2, "0")}-${`${day.getDate()}`.padStart(2, "0")}`;
  const durations = [5, 12, 18, 30, 42, 55, 61, 75, 90, 95];
  let written = 0;
  let dayOffset = 0;
  while (written < count) {
    const day = new Date();
    day.setDate(day.getDate() - dayOffset);
    const date = formatter(day);
    dates.push(date);
    const perDay = written + 2 <= count ? 2 : 1;
    for (let slot = 0; slot < perDay; slot += 1) {
      const minutes = durations[written % durations.length];
      const time = slot === 0 ? "08-05" : "15-30";
      const token = written < SEARCH_TOKEN_NOTES ? ` ${SEARCH_TOKEN} omnibus` : "";
      await writeNote({
        date,
        time,
        duration: `${minutes} min`,
        title: `Weekly sync ${written}${token}`,
        body: `[00:00] routine status of meeting ${written}${token}\n[00:10] we agreed to ship the budget report\n[00:20] Raul owns MR ${142 + written}`,
      });
      written += 1;
    }
    dayOffset += 1;
  }
  return dates;
}

async function treeHash() {
  const entries = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      const bytes = await readFile(full);
      entries.push(
        `${path.relative(notesDir, full)}:${createHash("sha256").update(bytes).digest("hex")}`,
      );
    }
  }
  await walk(notesDir);
  return entries.sort().join("\n");
}

try {
  daemon = startAcceptanceProcess(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: {
      ...process.env,
      WTD_OUTPUT_DIR: notesDir,
      // The fixture `pi` leads PATH, so extraction runs a deterministic script
      // and the developer's real agent is never invoked.
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
    },
  });
  ownPid(daemon.pid);
  await waitForDaemon();
  await launchDesktop();

  // The surface must be reachable from the sidebar, which is where it lives.
  // Pin the capture size explicitly: the native window is 1440x900 at DPR 2
  // (a 2880x1800 shot), and every other capture in this sweep is measured at
  // the emulated viewport, so the first one must match.
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMeetings();
  await page.getByText("Notes folder not found", { exact: true }).waitFor();
  const missingCopy = await page.locator("main").innerText();
  assert.ok(
    missingCopy.includes(notesDir),
    `the missing state must name the exact folder: ${missingCopy}`,
  );
  assert.ok(
    !missingCopy.includes("No transcript artifacts found"),
    "a missing folder must never render the empty-meetings copy",
  );
  assert.ok(
    !missingCopy.includes("0 transcripts"),
    `an unread folder must never claim a transcript count: ${missingCopy}`,
  );
  assert.ok(
    missingCopy.includes("Notes folder could not be read"),
    `the header must say the folder could not be read: ${missingCopy}`,
  );
  report.states.missing = missingCopy.split("\n").slice(0, 8).join(" | ");
  await assertNoOverflow("missing-1440");
  await shot("01-missing-folder-dark-1440.png");
  report.checks.push("missing-folder-named-not-empty");
  report.checks.push("unread-folder-header-never-claims-a-count");

  // Same process, folder now exists and is empty: a different truth.
  await mkdir(notesDir, { recursive: true });
  await refreshMeetings();
  await page.getByText("No transcript artifacts found", { exact: true }).waitFor();
  const emptyCopy = await page.locator("main").innerText();
  assert.ok(emptyCopy.includes("holds no Write That Down transcripts"), emptyCopy);
  report.states.empty = emptyCopy.split("\n").slice(0, 8).join(" | ");
  report.checks.push("empty-folder-says-empty-only-when-empty");

  // The empty state, both themes, all four widths.
  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await openMeetings();
    await page.getByText("No transcript artifacts found", { exact: true }).waitFor();
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByText("No transcript artifacts found", { exact: true }).waitFor();
      await assertNoOverflow(`empty-${theme}-${width}`);
      await shot(`empty-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // The corpus the owner actually has: hundreds of transcripts, plus one
  // unparseable file and one unrelated Markdown file that must stay out.
  const dates = await seedCorpus(CORPUS);
  await mkdir(path.join(notesDir, dates[0]), { recursive: true });
  await writeFile(
    path.join(notesDir, dates[0], "16-00_5min.md"),
    "# Broken\nno header at all\n",
  );
  await writeFile(path.join(notesDir, dates[0], "weekly-sync-summary.md"), "# Summary\n");
  await writeFile(path.join(notesDir, "README.md"), "# not a date folder\n");
  const before = await treeHash();

  const pageLoadStarted = Date.now();
  await refreshMeetings();
  await page.getByText("Weekly sync 0 zanzibar omnibus", { exact: true }).waitFor();
  report.timings.populatedFirstRowMs = Date.now() - pageLoadStarted;
  const listText = await page.locator("main").innerText();
  assert.ok(
    listText.includes(`${CORPUS + 1} transcripts`),
    `the header must count every indexed transcript, including the failed one: ${listText.slice(0, 400)}`,
  );
  assert.ok(
    listText.includes("Failed") && listText.includes("malformed-transcript"),
    `the unparseable file must be listed and named: ${listText.slice(0, 400)}`,
  );
  assert.ok(
    listText.includes("16-00_5min.md"),
    "the failing file must be named by path",
  );
  assert.ok(
    !listText.includes("weekly-sync-summary.md") && !listText.includes("README.md"),
    "files outside the transcript convention must never be indexed",
  );
  report.checks.push("corpus-indexed-newest-first-with-named-failure");

  // Bounded rendering: one page of rows, whatever the corpus holds, with
  // real pagination to reach the rest.
  const firstPageRows = await page.locator('[role="listitem"]').count();
  assert.ok(
    firstPageRows <= 51,
    `the DOM must hold one page of rows, not the corpus: ${firstPageRows}`,
  );
  assert.ok(
    listText.includes(`Showing 1–${firstPageRows} of ${CORPUS + 1}`),
    `the list must report the window it shows: ${listText.slice(0, 300)}`,
  );
  assert.ok(
    (await page.getByRole("button", { name: "Next page" }).count()) === 1,
    "a 321-transcript folder must paginate",
  );
  const pageOneFirstRow = (await page.locator('[role="listitem"] h3').first().innerText()).trim();
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByText(`Showing ${firstPageRows + 1}–`, { exact: false }).waitFor();
  const pageTwoFirstRow = (await page.locator('[role="listitem"] h3').first().innerText()).trim();
  assert.notEqual(
    pageOneFirstRow,
    pageTwoFirstRow,
    "page 2 must be a different slice of the corpus",
  );
  await page.getByRole("button", { name: "Page 1" }).click();
  await page.getByText(pageOneFirstRow, { exact: false }).first().waitFor();
  report.checks.push("corpus-paginates-one-bounded-page-at-a-time");
  report.states.populated = `${CORPUS + 1} indexed, ${firstPageRows} rows per page`;

  // The populated page, both themes, all four widths.
  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await openMeetings();
    await page.getByText(pageOneFirstRow, { exact: false }).first().waitFor();
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByText(pageOneFirstRow, { exact: false }).first().waitFor();
      await assertNoOverflow(`populated-${theme}-${width}`);
      await shot(`populated-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Search: the daemon searches the corpus and the row shows the line the
  // match came from, because a count the owner cannot check is not an answer.
  const searchStarted = Date.now();
  await page.getByLabel("Search transcripts").fill(SEARCH_TOKEN);
  await page
    .getByText(`${SEARCH_TOKEN_NOTES} of the notes match`, { exact: false })
    .waitFor();
  report.timings.searchMs = Date.now() - searchStarted;
  const searchText = await page.locator("main").innerText();
  assert.ok(
    searchText.includes(`line 7`) || searchText.includes("line 8") || searchText.includes("line 9"),
    `the matching transcript line must be shown with its number: ${searchText.slice(0, 500)}`,
  );
  assert.ok(
    searchText.includes("routine status of meeting 0"),
    `the matched body line must come from the note: ${searchText.slice(0, 600)}`,
  );
  assert.ok(
    (await page.locator('[role="listitem"]').count()) === SEARCH_TOKEN_NOTES,
    "a search must not pad its results",
  );
  report.checks.push("search-shows-the-matching-transcript-line");
  report.states.search = `${SEARCH_TOKEN_NOTES} of ${CORPUS + 1}`;

  for (const theme of ["light", "dark"]) {
    await selectSettingsTheme(page, theme);
    await openMeetings();
    await page.getByLabel("Search transcripts").fill(SEARCH_TOKEN);
    await page
      .getByText(`${SEARCH_TOKEN_NOTES} of the notes match`, { exact: false })
      .waitFor();
    for (const width of [1440, 1100, 900, 760]) {
      await page.setViewportSize({ width, height: 900 });
      await page
        .getByText(`${SEARCH_TOKEN_NOTES} of the notes match`, { exact: false })
        .waitFor();
      await assertNoOverflow(`search-${theme}-${width}`);
      await shot(`search-${theme}-${width}.png`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // Filters: a duration bucket and a date preset, both applied by the daemon.
  // The search from the sweep above is cleared first: a filter leg that still
  // carried it would be measuring the intersection of two filters.
  await openMeetings();
  const clearButton = page.getByRole("button", { name: "Clear" });
  if ((await clearButton.count()) > 0) await clearButton.click();
  await page
    .getByText(`Showing 1–${firstPageRows} of ${CORPUS + 1}`, { exact: false })
    .waitFor();
  await page.getByLabel("Meeting duration").click();
  await page.getByRole("option", { name: "Over 60 min" }).click();
  await page.getByText("of the notes match", { exact: false }).waitFor();
  const durationText = await page.locator("main").innerText();
  const longCounts = [...durationText.matchAll(/(\d+) min/g)].map((match) => Number(match[1]));
  assert.ok(longCounts.length > 0, `the duration filter must return rows: ${durationText.slice(0, 300)}`);
  assert.ok(
    longCounts.every((minutes) => minutes > 60 || minutes === 60),
    `a duration filter must not return a shorter meeting: ${longCounts.slice(0, 12)}`,
  );
  await page.getByRole("button", { name: "Clear" }).click();
  await page
    .getByText(`Showing 1–${firstPageRows} of ${CORPUS + 1}`, { exact: false })
    .waitFor();
  report.checks.push("duration-filter-applied-by-the-daemon");

  await page.getByLabel("Meeting date").click();
  await page.getByRole("option", { name: "Last 7 days" }).click();
  await page.getByText("of the notes match", { exact: false }).waitFor();
  const recentDays = new Set(dates.slice(0, 7));
  const shownDays = await page
    .locator('[role="listitem"] p span')
    .allInnerTexts()
    .then((values) => values.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)));
  assert.ok(shownDays.length > 0, "the date preset must return rows");
  assert.ok(
    shownDays.every((day) => recentDays.has(day)),
    `the date preset must not return an older meeting: ${[...new Set(shownDays)]}`,
  );
  report.states.range = `${shownDays.length} rows inside the last 7 days`;
  report.checks.push("date-filter-applied-by-the-daemon");
  await page.getByRole("button", { name: "Clear" }).click();
  await page
    .getByText(`Showing 1–${firstPageRows} of ${CORPUS + 1}`, { exact: false })
    .waitFor();

  // Extraction, over a real note, with the fixture local model. Nothing is
  // created by looking; the suggestion keeps the line it came from and the
  // invention is reported as discarded.
  const tokenRow = page.locator('[role="listitem"]', { hasText: SEARCH_TOKEN });
  await page.getByLabel("Search transcripts").fill(SEARCH_TOKEN);
  await page.getByText(`${SEARCH_TOKEN_NOTES} of the notes match`, { exact: false }).waitFor();
  await tokenRow.first().getByRole("button", { name: /Open transcript/ }).click();
  await page
    .getByRole("button", { name: /Suggest actions with the local model/ })
    .click();
  await page.getByText("Suggested from this transcript").waitFor({ timeout: 60000 });
  const analysisText = await page.locator("main").innerText();
  assert.ok(
    analysisText.includes("qwen3.8-flash-next-nvidia-nvfp4"),
    `the run must name the free local model: ${analysisText.slice(0, 500)}`,
  );
  assert.ok(
    analysisText.includes("Fixture action the note states"),
    `a verified suggestion must be shown: ${analysisText.slice(0, 600)}`,
  );
  assert.ok(
    analysisText.includes("line 7") || analysisText.includes("line 8"),
    "every suggestion must show the transcript line it came from",
  );
  assert.ok(
    TOKEN_LINES.some((line) => analysisText.includes(line)),
    `the quote must be one of the note's own lines, verbatim: ${analysisText.slice(0, 1200)}`,
  );
  assert.ok(
    analysisText.includes("discarded because the quote was not found"),
    `the invented suggestion must be reported as discarded: ${analysisText.slice(0, 900)}`,
  );
  assert.ok(
    !analysisText.includes("Fixture action the note states") ||
      !analysisText.includes("Invented action\n(line"),
    "an unverifiable suggestion must never be listed as a finding",
  );
  report.checks.push("local-model-extraction-verified-and-honest");
  await shot("10-analysis-light-1440.png");

  // Accepting is explicit, and the ledger is Drogon's own file.
  await page.getByRole("button", { name: /Add to my actions/ }).first().click();
  await page.getByText(/Added to my actions/).waitFor();
  await page.getByRole("button", { name: /Back to meetings/ }).click();
  await page.getByRole("tab", { name: /My actions/ }).click();
  await page.getByText("Fixture action the note states").waitFor();
  const ledgerText = await page.locator("main").innerText();
  assert.ok(
    ledgerText.includes("line 7") || ledgerText.includes("line 8"),
    `an accepted action keeps the line it came from: ${ledgerText.slice(0, 500)}`,
  );
  assert.ok(
    TOKEN_LINES.some((line) => ledgerText.includes(line)),
    "an accepted action keeps the quote that supports it",
  );
  report.states.actions = ledgerText.split("\n").slice(0, 10).join(" | ");
  report.checks.push("accepted-action-lands-in-the-ledger-with-provenance");
  await shot("11-actions-light-1440.png");

  await selectSettingsTheme(page, "dark");
  await openMeetings();
  await page.getByRole("tab", { name: /My actions/ }).click();
  await page.getByText("Fixture action the note states").waitFor();
  await shot("11-actions-dark-1440.png");

  await page.getByRole("button", { name: /Open transcript/ }).first().click();
  await page.getByRole("button", { name: /Back to meetings/ }).waitFor();
  report.checks.push("ledger-row-opens-its-own-transcript");

  // The ledger is a file in the data dir; the notes folder is untouched.
  const ledger = JSON.parse(
    await readFile(path.join(dataDir, "meeting-commitments.json"), "utf8"),
  );
  assert.equal(ledger.commitments.length, 1, "one accepted action, one ledger row");
  assert.equal(ledger.commitments[0].status, "open");
  assert.ok(
    TOKEN_LINES.includes(ledger.commitments[0].quote),
    `the stored quote is the transcript line: ${ledger.commitments[0].quote}`,
  );
  report.checks.push("ledger-is-drogons-own-file");

  const after = await treeHash();
  assert.equal(after, before, "the notes must be byte-identical after browse, search and analyse");
  report.checks.push("notes-untouched-after-browse-search-and-analysis");
  report.notesTreeHash = createHash("sha256").update(before).digest("hex");

  // The capabilities the surface gates on, straight from the real daemon.
  const status = JSON.parse(
    (
      await runAcceptanceProcess(cliBin, ["--data-dir", dataDir, "--json", "status"], {
        timeout: 5000,
      })
    ).stdout,
  );
  for (const capability of ["meetings.v1", "meetings.actions.v1"]) {
    assert.ok(
      status.result.capabilities.includes(capability),
      `status must advertise ${capability}: ${status.result.capabilities.join(",")}`,
    );
  }
  report.checks.push("service-advertises-meetings-v1-and-actions-v1");

  report.status = "PASSED";
} catch (error) {
  report.status = "FAILED";
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  try {
    if (browser) await browser.close().catch(() => {});
    const tracked = [...ownedPids].filter((pid) => alive(pid));
    const victims = tracked.length > 0 ? await descendants(tracked) : [];
    await stopOwned(desktop, "desktop");
    await stopOwned(daemon, "daemon");
    await delay(500);
    const survivors = victims.filter((pid) => alive(pid));
    report.processes.survivors = survivors;
    if (survivors.length > 0) {
      process.exitCode = 1;
      await writeFile(
        path.join(output, "survivors.json"),
        `${JSON.stringify({ victims, survivors }, null, 2)}\n`,
      );
    }
    if (!keep) await rm(fixtureRoot, { recursive: true, force: true });
    else report.fixtureRoot = fixtureRoot;
  } catch (cleanupError) {
    process.exitCode = 1;
    report.cleanupError =
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
  }
  await writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
