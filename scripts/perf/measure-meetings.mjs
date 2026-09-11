#!/usr/bin/env node
// Meetings-section performance probe: proves the section is usable with the
// corpus the owner actually has (300+ transcripts), and that the work a
// request does is BOUNDED rather than proportional to the corpus.
//
//   node scripts/perf/measure-meetings.mjs [--transcripts 320] [--samples 12] [--out report.json]
//
// What it measures, against a real `drogond` and the real `drogon-cli`:
//   * `meeting.list` page 1 and a deep page (page 5) over the whole corpus;
//   * a full-text `--query` across the corpus;
//   * the bytes each request made the daemon read, from the daemon's own
//     numbers (`scanned` is the count of note BODIES read: a list that does
//     not search must report 0, because a row is built from the note's own
//     bounded header window and never from the whole file).
//
// Every metric reports median + p95. The script asserts the bounded-read
// property, so a regression that made listing read every note would fail
// here rather than merely get slower.
//
// Owns its processes: a private data dir, a private fixture notes tree, and a
// SIGTERM-then-verify teardown for the daemon it started (never a broad
// pkill, never this machine's own Drogon).
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = args[index + 1];
  return next !== undefined && !next.startsWith("--") ? next : true;
};

const TRANSCRIPTS = Number(flag("transcripts", "320"));
const SAMPLES = Number(flag("samples", "12"));
const OUT = flag("out", null);
const daemonBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogond.exe" : "drogond");
const cliBin = path.join(root, "target", "debug", process.platform === "win32" ? "drogon-cli.exe" : "drogon-cli");

const fixtureRoot = await mkdtemp(path.join(tmpdir(), "meetings-perf-"));
const dataDir = path.join(fixtureRoot, "data");
const notesDir = path.join(fixtureRoot, "Transcripts");
let daemon = null;

function cli(argv, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cliBin, ["--data-dir", dataDir, "--json", ...argv], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`drogon-cli ${argv.join(" ")} timed out`));
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`drogon-cli ${argv.join(" ")} failed (${code}): ${err || out}`));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (error) {
        reject(new Error(`drogon-cli ${argv.join(" ")} did not print JSON: ${out}`));
      }
    });
  });
}

async function timed(label, argv, { expectScanned } = {}) {
  const samples = [];
  let last = null;
  for (let index = 0; index < SAMPLES; index += 1) {
    const started = process.hrtime.bigint();
    const envelope = await cli(argv);
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
    last = envelope.result;
    if (!envelope.ok) throw new Error(`${label} failed: ${JSON.stringify(envelope.error)}`);
  }
  samples.sort((left, right) => left - right);
  const metric = {
    label,
    samples: samples.length,
    medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(1)),
    p95Ms: Number(samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)].toFixed(1)),
    maxMs: Number(samples[samples.length - 1].toFixed(1)),
    total: last.total,
    scanned: last.scanned ?? 0,
  };
  if (expectScanned !== undefined && metric.scanned !== expectScanned) {
    throw new Error(
      `${label}: expected the daemon to read ${expectScanned} note bodies, saw ${metric.scanned}`,
    );
  }
  return metric;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

try {
  // A corpus of `TRANSCRIPTS` real notes over real calendar days, newest
  // today, with a token in three of them so a search has an exact answer.
  await mkdir(path.join(notesDir), { recursive: true });
  const durations = [5, 12, 18, 30, 42, 55, 61, 75, 90, 95];
  let written = 0;
  let dayOffset = 0;
  let corpusBytes = 0;
  while (written < TRANSCRIPTS) {
    const day = new Date();
    day.setDate(day.getDate() - dayOffset);
    const date = `${day.getFullYear()}-${`${day.getMonth() + 1}`.padStart(2, "0")}-${`${day.getDate()}`.padStart(2, "0")}`;
    const dir = path.join(notesDir, date);
    await mkdir(dir, { recursive: true });
    const perDay = written + 2 <= TRANSCRIPTS ? 2 : 1;
    for (let slot = 0; slot < perDay; slot += 1) {
      const minutes = durations[written % durations.length];
      const time = slot === 0 ? "08-05" : "15-30";
      const token = written < 3 ? " zanzibar" : "";
      // A realistic transcript body: a 40-minute meeting is tens of
      // kilobytes, which is the size that makes the header-only read for a
      // list row measurably different from reading the whole note.
      const lines = [`[00:00] routine status of meeting ${written}${token}`];
      for (let line = 1; line <= 600; line += 1) {
        const minute = Math.floor(line / 3);
        lines.push(
          `[${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}] speaker ${line % 4}: the agenda item ${line} of meeting ${written} was discussed at length`,
        );
      }
      lines.push("[00:10] we agreed to ship the budget report");
      lines.push(`[00:20] Raul owns MR ${142 + written}`);
      const body = `# Weekly sync ${written}${token}\n**Date:** ${date} ${time.replace("-", ":")}\n**Duration:** ${minutes} min\n\n## Transcript\n\n${lines.join("\n")}\n`;
      corpusBytes += Buffer.byteLength(body);
      await writeFile(path.join(dir, `${time}_${minutes}min.md`), body);
      written += 1;
    }
    dayOffset += 1;
  }

  daemon = spawn(daemonBin, ["--data-dir", dataDir], {
    stdio: "ignore",
    env: { ...process.env, WTD_OUTPUT_DIR: notesDir },
  });
  const deadline = Date.now() + 30000;
  for (;;) {
    try {
      await cli(["status"], { timeout: 2000 });
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await delay(100);
    }
  }

  const metrics = [];
  // Landing on the page: one page of rows, zero note bodies read.
  metrics.push(await timed("meeting.list page 1 (limit 50)", ["meeting", "list", "--limit", "50"], { expectScanned: 0 }));
  metrics.push(await timed("meeting.list deep page (offset 200)", ["meeting", "list", "--limit", "50", "--offset", "200"], { expectScanned: 0 }));
  metrics.push(await timed("meeting.list date range", ["meeting", "list", "--from", "2000-01-01", "--limit", "50"], { expectScanned: 0 }));
  metrics.push(await timed("meeting.list duration range", ["meeting", "list", "--min-minutes", "61", "--limit", "50"], { expectScanned: 0 }));
  // A search must read note bodies (that is the only way to search text) and
  // must report how many it read, so the cost is visible rather than assumed.
  const search = await timed("meeting.list --query (full corpus scan)", ["meeting", "list", "--query", "budget", "--limit", "50"]);
  if (search.total !== TRANSCRIPTS) {
    throw new Error(`a query every note carries must match every note, saw ${search.total}`);
  }
  if (search.scanned < TRANSCRIPTS) {
    throw new Error(`a full-text search must report reading every note: ${search.scanned}`);
  }
  metrics.push(search);

  const report = {
    kind: "meetings-perf",
    noteBytesPerNote: Math.round(corpusBytes / TRANSCRIPTS),
    corpusBytes,
    transcripts: TRANSCRIPTS,
    samples: SAMPLES,
    metrics,
    notes: [
      "scanned = note bodies the daemon read for that request. A list that does not search reads none: rows come from the note's bounded header window plus directory metadata; a row costs at most 16 KiB of the note, not the whole file.",
      "A search reads each note once, one at a time, under the daemon's own byte budget; it is proportional to the corpus by necessity and bounded by design.",
    ],
  };
  console.log(JSON.stringify(report, null, 2));
  if (OUT) await writeFile(path.resolve(OUT), `${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = 0;
} catch (error) {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
} finally {
  if (daemon && alive(daemon.pid)) {
    daemon.kill("SIGTERM");
    const deadline = Date.now() + 10000;
    while (alive(daemon.pid) && Date.now() < deadline) await delay(50);
    if (alive(daemon.pid)) {
      daemon.kill("SIGKILL");
      await delay(200);
    }
    if (alive(daemon.pid)) {
      console.error(`meetings-perf: daemon ${daemon.pid} survived teardown`);
      process.exitCode = 1;
    }
  }
  daemon = null;
  await rm(fixtureRoot, { recursive: true, force: true });
}
