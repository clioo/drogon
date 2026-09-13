// The deck: a cursor over the profiles plus the three lists a swipe can
// append to. Every function returns a new state; nothing mutates in place, so
// a caller can keep the previous state around.
//
// `lastSwipe` is the one level of undo. It is part of the state, so it
// survives a save/load round trip: a reload keeps exactly one undo available,
// and consuming it clears it.

export function newDeck(profiles) {
  return {
    profiles: profiles.map((profile) => ({ ...profile })),
    cursor: 0,
    likes: [],
    passes: [],
    matches: [],
    lastSwipe: null,
  };
}

export function currentProfile(state) {
  return state.cursor < state.profiles.length ? state.profiles[state.cursor] : null;
}

export function swipe(state, direction) {
  if (direction !== "left" && direction !== "right") {
    throw new Error(`Unknown swipe direction: ${direction}`);
  }
  const profile = currentProfile(state);
  if (!profile) throw new Error("Deck is empty");

  const liked = direction === "right";
  const matched = liked && profile.likesYou === true;
  return {
    ...state,
    cursor: state.cursor + 1,
    likes: liked ? [...state.likes, profile.id] : state.likes,
    passes: liked ? state.passes : [...state.passes, profile.id],
    matches: matched ? [...state.matches, profile.id] : state.matches,
    lastSwipe: { profileId: profile.id, direction, matched },
  };
}

/** True when `undo` would do something — the button's enabled state. */
export function canUndo(state) {
  return state.lastSwipe !== null;
}

export function undo(state) {
  const last = state.lastSwipe;
  if (!last) throw new Error("Nothing to undo");

  const withoutLast = (ids) => {
    const index = ids.lastIndexOf(last.profileId);
    if (index === -1) return ids;
    return [...ids.slice(0, index), ...ids.slice(index + 1)];
  };

  return {
    ...state,
    cursor: state.cursor - 1,
    likes: last.direction === "right" ? withoutLast(state.likes) : state.likes,
    passes: last.direction === "left" ? withoutLast(state.passes) : state.passes,
    matches: last.matched ? withoutLast(state.matches) : state.matches,
    lastSwipe: null,
  };
}
