# Dog Tinder — the task the run dispatches

Build the swipe deck this repository already has tests for, and make
`node --test` pass.

- `src/deck.js` — the deck over `fixtures/dogs.json`: the profile on top,
  swipe left (pass) and swipe right (like), and a match when a right swipe
  lands on a dog whose `likesYou` is true. Swiping an empty deck is an error,
  not a no-op.
- `src/storage.js` — save and load one deck, written so a reader never sees
  half a state.
- `index.html` — a page to swipe on.
- **Undo of the last swipe.** One level, part of the saved state, so it
  survives a reload: it puts the dog back on top and takes back the like or
  the pass — and the match, if that swipe made one. A second undo with nothing
  to undo is refused with `Nothing to undo` and leaves the deck untouched. A
  mis-swipe on a dog you liked is otherwise unrecoverable, which is why this
  small feature is not optional.

The tests in `tests/deck.test.mjs` are the contract; do not edit them. Report
only what `node --test` actually says.
