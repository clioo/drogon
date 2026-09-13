// The deck: a cursor over the profiles plus the three lists a swipe can
// append to. Every function returns a new state; nothing mutates in place, so
// a caller can keep the previous state around.

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

export function undo() {
  throw new Error("Not implemented");
}
