// MIT Copyright (c) 2026 Lovecast Inc.
// Curated, versioned known-model seeds per harness — option (b) of the
// model-catalog decision. These are NOT host-enumerated on this machine:
// every entry the daemon did not enumerate rides with an explicit
// "known catalog" / unverified label, and the UI only marks a model
// verified when `harness.models` returned it from this host.
//
// Sources (kept literal so the seed is auditable):
// - claude: the family aliases the read-only reference
//   (`src/shared/agent-session-option-catalog-claude-codex.ts`) uses
//   because pinned version ids "lie on part of the fleet"; the pinned ids
//   are the ones this repository already pins in its own dogfood/tests.
//   The reference ALSO has a supported non-interactive enumeration
//   (`claude -p --input-format stream-json ... {"subtype":"list_models"}`,
//   `src/shared/claude-model-list-probe.ts`); adopting it needs stdin
//   plumbing in the bounded probe and is called out as a follow-up, not
//   silently faked here.
// - codex: the short seed the reference explicitly keeps
//   (`CODEX_SESSION_OPTION_CATALOG.models`), whose own comment says model
//   access depends on auth so the list must not claim completeness.
// - pi / opencode: real host enumeration already exists, so the seed is
//   only the free local model the owner's constraint names.
// - antigravity: the CLI exposes no list and the reference publishes no
//   seed, so it honestly stays empty ("type the id").

export type KnownModelSeed = {
  id: string;
  /** Honest provenance note rendered beside the id. */
  note: string;
};

/** When this seed snapshot was last reviewed. Bump with the list so the UI
 *  can say the catalog is versioned, not timeless. */
export const KNOWN_MODEL_CATALOG_VERSION = "2026-09-10";

const KNOWN_MODELS: Record<string, KnownModelSeed[]> = {
  claude: [
    {
      id: "opus",
      note: "known catalog · Claude family alias (newest Opus) · unverified on this host",
    },
    {
      id: "sonnet",
      note: "known catalog · Claude family alias (newest Sonnet) · unverified on this host",
    },
    {
      id: "haiku",
      note: "known catalog · Claude family alias (newest Haiku) · unverified on this host",
    },
    {
      id: "claude-sonnet-5",
      note: "known catalog · pinned id used by this repo · unverified on this host",
    },
    {
      id: "claude-sonnet-4-5",
      note: "known catalog · pinned id used by this repo · unverified on this host",
    },
  ],
  codex: [
    {
      id: "gpt-5.6-sol",
      note: "known catalog · Codex seed · unverified on this host",
    },
    {
      id: "gpt-5.6-terra",
      note: "known catalog · Codex seed · unverified on this host",
    },
    {
      id: "gpt-5.6-luna",
      note: "known catalog · Codex seed · unverified on this host",
    },
    { id: "gpt-5.5", note: "known catalog · Codex seed · unverified on this host" },
    {
      id: "gpt-5.2-codex",
      note: "known catalog · Codex seed · unverified on this host",
    },
  ],
  pi: [
    {
      id: "qwen3.8-flash-next-nvidia-nvfp4",
      note: "known catalog · free local model · unverified on this host",
    },
  ],
  opencode: [],
  antigravity: [],
};

/** The curated seed for a harness (case-insensitive); empty for a harness
 *  with neither a host enumeration nor a defensible seed. */
export function knownModelsFor(harness: string): KnownModelSeed[] {
  return KNOWN_MODELS[harness.trim().toLowerCase()] ?? [];
}
