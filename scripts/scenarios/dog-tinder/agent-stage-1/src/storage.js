// Persistence for one deck. Written through a sibling temp file and renamed,
// so a reader never sees half a state.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const VERSION = 1;

export async function saveState(state, file) {
  await mkdir(path.dirname(file), { recursive: true });
  const staged = `${file}.tmp-${process.pid}`;
  await writeFile(staged, `${JSON.stringify({ version: VERSION, state }, null, 2)}\n`);
  await rename(staged, file);
  return file;
}

export async function loadState(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const parsed = JSON.parse(text);
  if (parsed.version !== VERSION) {
    throw new Error(`Unsupported saved deck version: ${parsed.version}`);
  }
  return parsed.state;
}
