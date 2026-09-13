# Dog Tinder

A swipe deck for adoptable dogs, used as the work product of Drogon's
reproducible adversarial run (`make repro`).

- `fixtures/dogs.json` — twelve fixed profiles. `likesYou` decides whether a
  right swipe becomes a match, so matches are deterministic.
- `tests/deck.test.mjs` — the contract. `node --test` is the only
  verdict that counts; an agent's own summary is not evidence.

What the task asks for: the deck (`src/deck.js`), its persistence
(`src/storage.js`), a page to swipe on (`index.html`), and **undo of the last
swipe** — one level, persisted, so a mis-swipe on a dog you liked is
recoverable.
