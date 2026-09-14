// The Dog Tinder scenario, embedded so the in-app demo can seed its own
// disposable workspace through the files bridge (a packaged app has no
// access to this repository's `scripts/scenarios` tree).
//
// GENERATED FROM scripts/scenarios/dog-tinder — `repro-demo-scenario.test.ts`
// reads those files and fails if these constants drift from them, so there is
// one source of truth for what the demo builds and what the tests contract is.

export type ReproScenarioFile = { path: string; content: string };

/** Written before the bot exists: the repository the work happens in. */
export const REPRO_SCENARIO_SEED: readonly ReproScenarioFile[] = [
  {
    path: "package.json",
    content: `{
  "name": "dog-tinder",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "A swipe deck for adoptable dogs. The deck and its storage are the task; the tests are the contract.",
  "scripts": {
    "test": "node --test"
  }
}
`,
  },
  {
    path: "fixtures/dogs.json",
    content: `[
  { "id": "d01", "name": "Mochi", "breed": "Shiba Inu", "age": 2, "city": "Monterrey", "likesYou": true },
  { "id": "d02", "name": "Tostada", "breed": "Xoloitzcuintle", "age": 5, "city": "Oaxaca", "likesYou": false },
  { "id": "d03", "name": "Bruno", "breed": "Pastor Alemán", "age": 3, "city": "Guadalajara", "likesYou": true },
  { "id": "d04", "name": "Canela", "breed": "Criolla", "age": 1, "city": "Puebla", "likesYou": true },
  { "id": "d05", "name": "Sushi", "breed": "Corgi", "age": 4, "city": "CDMX", "likesYou": false },
  { "id": "d06", "name": "Pelusa", "breed": "Poodle", "age": 7, "city": "Mérida", "likesYou": false },
  { "id": "d07", "name": "Nube", "breed": "Samoyedo", "age": 2, "city": "Querétaro", "likesYou": true },
  { "id": "d08", "name": "Chamoy", "breed": "Chihuahua", "age": 6, "city": "Tijuana", "likesYou": false },
  { "id": "d09", "name": "Frida", "breed": "Beagle", "age": 3, "city": "León", "likesYou": true },
  { "id": "d10", "name": "Tamal", "breed": "Basset Hound", "age": 8, "city": "Toluca", "likesYou": false },
  { "id": "d11", "name": "Nieve", "breed": "Husky", "age": 2, "city": "Saltillo", "likesYou": true },
  { "id": "d12", "name": "Pulga", "breed": "Criolla", "age": 1, "city": "Veracruz", "likesYou": false }
]
`,
  },
  {
    path: "tests/deck.test.mjs",
    content: `// The contract for the deck. These tests ship with the task: an agent that
// claims the feature works has to make THESE pass, and the adversarial round
// reads their result instead of the agent's summary.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { currentProfile, newDeck, swipe, undo } from "../src/deck.js";
import { loadState, saveState } from "../src/storage.js";

const root = fileURLToPath(new URL("..", import.meta.url));

async function dogs() {
  return JSON.parse(await readFile(path.join(root, "fixtures/dogs.json"), "utf8"));
}

test("the deck runs out after every profile is swiped", async () => {
  let state = newDeck(await dogs());
  for (let index = 0; index < 12; index += 1) {
    state = swipe(state, index % 2 === 0 ? "right" : "left");
  }
  assert.equal(currentProfile(state), null);
  assert.throws(() => swipe(state, "right"), /Deck is empty/);
});

test("a right swipe on a dog that likes you back is a match", async () => {
  const profiles = await dogs();
  const state = swipe(newDeck(profiles), "right");
  assert.equal(profiles[0].likesYou, true);
  assert.deepEqual(state.matches, [profiles[0].id]);
  assert.deepEqual(state.likes, [profiles[0].id]);
});

test("a left swipe never matches", async () => {
  const profiles = await dogs();
  const state = swipe(newDeck(profiles), "left");
  assert.deepEqual(state.matches, []);
  assert.deepEqual(state.passes, [profiles[0].id]);
});

test("undo puts the dog back on top of the deck and takes back its match", async () => {
  const profiles = await dogs();
  const swiped = swipe(newDeck(profiles), "right");
  assert.deepEqual(swiped.matches, [profiles[0].id]);

  const restored = undo(swiped);
  assert.equal(currentProfile(restored).id, profiles[0].id);
  assert.deepEqual(restored.matches, []);
  assert.deepEqual(restored.likes, []);
});

test("undo is one level: twice in a row is refused, and the state survives the refusal", async () => {
  const profiles = await dogs();
  const restored = undo(swipe(newDeck(profiles), "right"));
  assert.throws(() => undo(restored), /Nothing to undo/);
  assert.equal(currentProfile(restored).id, profiles[0].id);
  assert.deepEqual(restored.matches, []);
});

test("a reloaded deck keeps its swipes and can still undo the last one", async () => {
  const profiles = await dogs();
  const directory = await mkdtemp(path.join(tmpdir(), "dog-tinder-state-"));
  const file = path.join(directory, "state.json");
  try {
    const swiped = swipe(swipe(newDeck(profiles), "left"), "right");
    await saveState(swiped, file);

    const reloaded = await loadState(file);
    assert.deepEqual(reloaded.passes, swiped.passes);
    assert.deepEqual(reloaded.matches, swiped.matches);
    assert.equal(currentProfile(reloaded).id, profiles[2].id);

    const undone = undo(reloaded);
    assert.equal(currentProfile(undone).id, profiles[1].id);
    assert.deepEqual(undone.matches, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
`,
  },
];

/** The spec the work is built against. Seeded with the repository, so the
 *  bot's session and every worker read the same file the tests contract. */
export const REPRO_SCENARIO_SPEC_PATH = "specs/dog-tinder.md";

export const REPRO_SCENARIO_SPEC = `# Spec: Dog Tinder

A swipe deck for adoptable dogs.

## Deck

- The deck is the twelve profiles in \`fixtures/dogs.json\`, in file order.
- Swipe left is a pass, swipe right is a like.
- A right swipe on a dog whose \`likesYou\` is true is a **match**.
- Swiping an empty deck is an error, not a silent no-op.

## Persistence

- One deck is saved and loaded whole, and a reader never sees half a state.

## Page

- \`index.html\` shows the profile on top, with a pass and a like control.

## Contract

\`tests/deck.test.mjs\` is the contract. Do not edit the tests; make
\`node --test\` pass.

## Undo of the last swipe

One level of undo, part of the saved state, so it survives a reload.

- Undo puts the dog back on top of the deck and takes back the like or the
  pass — and the match, if that swipe made one.
- A second undo with nothing to undo is refused with \`Nothing to undo\`, and
  the deck is left exactly as it was.
- A mis-swipe on a dog you liked is otherwise unrecoverable, which is why
  this is not optional.
`;

export const REPRO_SCENARIO_BRIEF = `# Dog Tinder — the task the run dispatches

Build the swipe deck this repository already has tests for, and make
\`node --test\` pass.

- \`src/deck.js\` — the deck over \`fixtures/dogs.json\`: the profile on top,
  swipe left (pass) and swipe right (like), and a match when a right swipe
  lands on a dog whose \`likesYou\` is true. Swiping an empty deck is an error,
  not a no-op.
- \`src/storage.js\` — save and load one deck, written so a reader never sees
  half a state.
- \`index.html\` — a page to swipe on.
- **Undo of the last swipe.** One level, part of the saved state, so it
  survives a reload: it puts the dog back on top and takes back the like or
  the pass — and the match, if that swipe made one. A second undo with nothing
  to undo is refused with \`Nothing to undo\` and leaves the deck untouched. A
  mis-swipe on a dog you liked is otherwise unrecoverable, which is why this
  small feature is not optional.

The tests in \`tests/deck.test.mjs\` are the contract; do not edit them. Report
only what \`node --test\` actually says.
`;
