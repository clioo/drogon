# Spec: Dog Tinder

A swipe deck for adoptable dogs.

## Deck

- The deck is the twelve profiles in `fixtures/dogs.json`, in file order.
- Swipe left is a pass, swipe right is a like.
- A right swipe on a dog whose `likesYou` is true is a **match**.
- Swiping an empty deck is an error, not a silent no-op.

## Persistence

- One deck is saved and loaded whole, and a reader never sees half a state.

## Page

- `index.html` shows the profile on top, with a pass and a like control.

## Contract

`tests/deck.test.mjs` is the contract. Do not edit the tests; make
`node --test` pass.

## Undo of the last swipe

One level of undo, part of the saved state, so it survives a reload.

- Undo puts the dog back on top of the deck and takes back the like or the
  pass — and the match, if that swipe made one.
- A second undo with nothing to undo is refused with `Nothing to undo`, and
  the deck is left exactly as it was.
- A mis-swipe on a dog you liked is otherwise unrecoverable, which is why
  this is not optional.
