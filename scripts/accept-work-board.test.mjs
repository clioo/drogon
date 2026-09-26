// The Work board acceptance drives selects by their accessible name; a
// renamed label in the renderer would only surface as a timeout deep into a
// packaged run. Every combobox name the acceptance uses must be one the Work
// renderer really gives a <select> (its aria-label).

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workDir = path.join(
  root,
  "apps",
  "desktop",
  "src",
  "renderer",
  "src",
  "features",
  "work",
);

function comboboxNames(source) {
  return [
    ...new Set(
      [
        ...source.matchAll(/getByRole\("combobox", \{ name: "([^"]+)" \}\)/g),
      ].map((m) => m[1]),
    ),
  ];
}

function rendererLabels() {
  const labels = new Set();
  for (const file of readdirSync(workDir)) {
    if (!/\.tsx$/.test(file) || /\.test\.tsx$/.test(file)) continue;
    for (const match of readFileSync(path.join(workDir, file), "utf8").matchAll(
      /aria-label="([^"]+)"/g,
    )) {
      labels.add(match[1]);
    }
  }
  return labels;
}

test("every combobox the Work acceptance selects is labelled that way in the renderer", () => {
  const names = comboboxNames(
    readFileSync(path.join(root, "scripts", "accept-work-board.mjs"), "utf8"),
  );
  assert.ok(
    names.includes("Agents work in"),
    `the acceptance picks where agents work: ${names.join(", ")}`,
  );
  const labels = rendererLabels();
  const missing = names.filter((name) => !labels.has(name));
  assert.deepEqual(
    missing,
    [],
    `acceptance names with no matching aria-label in ${workDir}`,
  );
});

test("the name scan finds combobox names and ignores other roles", () => {
  const source = `
    page.getByRole("combobox", { name: "One" });
    page.getByRole("combobox", { name: "One" });
    page.getByRole("button", { name: "Two" });
    page.getByRole("combobox", { name: "Three" }).selectOption("x");
  `;
  assert.deepEqual(comboboxNames(source), ["One", "Three"]);
});
