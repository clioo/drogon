// The contract for the deck. These tests ship with the task: an agent that
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
