/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/shared/drogon-bot-characters.ts (adapter: the preset list and
   `drogonBotDisplayName` are pure text data, reused verbatim; the source's
   `DrogonBotCharacterPreset` union is re-exported under its fork name from
   this repo's single definition site, BotCharacterPreset). */

export type BotCharacterPreset =
  | "none"
  | "arya"
  | "tyrion"
  | "jon-snow"
  | "daenerys"
  | "varys"
  | "ned-stark"
  | "samwell"
  | "cersei"
  | "jaime"
  | "sansa"
  | "bran"
  | "brienne"
  | "the-hound"
  | "melisandre"
  | "robb"
  | "oberyn"
  | "hodor";

/** The fork's name for the same union (shared/drogon-bot-contract.ts), so
 *  ports like drogon-bot-avatar-assets keep their source signatures. */
export type DrogonBotCharacterPreset = BotCharacterPreset;

export const BOT_CHARACTERS: readonly {
  value: Exclude<BotCharacterPreset, "none">;
  label: string;
}[] = [
  { value: "arya", label: "Arya Stark" },
  { value: "tyrion", label: "Tyrion Lannister" },
  { value: "jon-snow", label: "Jon Snow" },
  { value: "daenerys", label: "Daenerys Targaryen" },
  { value: "varys", label: "Varys" },
  { value: "ned-stark", label: "Ned Stark" },
  { value: "samwell", label: "Samwell Tarly" },
  { value: "cersei", label: "Cersei Lannister" },
  { value: "jaime", label: "Jaime Lannister" },
  { value: "sansa", label: "Sansa Stark" },
  { value: "bran", label: "Bran Stark" },
  { value: "brienne", label: "Brienne of Tarth" },
  { value: "the-hound", label: "The Hound" },
  { value: "melisandre", label: "Melisandre" },
  { value: "robb", label: "Robb Stark" },
  { value: "oberyn", label: "Oberyn Martell" },
  { value: "hodor", label: "Hodor" },
];

export function botCharacterLabel(preset: string): string | null {
  return BOT_CHARACTERS.find((entry) => entry.value === preset)?.label ?? null;
}

export function botDisplayName(name: string, preset: string): string {
  return name.trim() || botCharacterLabel(preset) || "";
}
