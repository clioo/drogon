/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/lib/drogon-bot-avatar-assets.ts (adapter: the preset
   type is imported from features/bots/bot-characters, this repo's single
   definition site for DrogonBotCharacterPreset; everything else — the 17
   ?url imports, the map shape and the getter — is the source's verbatim). */

import type { DrogonBotCharacterPreset } from "../features/bots/bot-characters";
import aryaAvatarUrl from "../assets/bots/arya.png?url";
import branAvatarUrl from "../assets/bots/bran.png?url";
import brienneAvatarUrl from "../assets/bots/brienne.png?url";
import cerseiAvatarUrl from "../assets/bots/cersei.png?url";
import daenerysAvatarUrl from "../assets/bots/daenerys.png?url";
import hodorAvatarUrl from "../assets/bots/hodor.png?url";
import jaimeAvatarUrl from "../assets/bots/jaime.png?url";
import jonSnowAvatarUrl from "../assets/bots/jon-snow.png?url";
import melisandreAvatarUrl from "../assets/bots/melisandre.png?url";
import nedStarkAvatarUrl from "../assets/bots/ned-stark.png?url";
import oberynAvatarUrl from "../assets/bots/oberyn.png?url";
import robbAvatarUrl from "../assets/bots/robb.png?url";
import samwellAvatarUrl from "../assets/bots/samwell.png?url";
import sansaAvatarUrl from "../assets/bots/sansa.png?url";
import theHoundAvatarUrl from "../assets/bots/the-hound.png?url";
import tyrionAvatarUrl from "../assets/bots/tyrion.png?url";
import varysAvatarUrl from "../assets/bots/varys.png?url";

export const DROGON_BOT_AVATAR_ASSETS: Partial<
  Record<DrogonBotCharacterPreset, string>
> = {
  arya: aryaAvatarUrl,
  cersei: cerseiAvatarUrl,
  jaime: jaimeAvatarUrl,
  sansa: sansaAvatarUrl,
  bran: branAvatarUrl,
  brienne: brienneAvatarUrl,
  "the-hound": theHoundAvatarUrl,
  melisandre: melisandreAvatarUrl,
  robb: robbAvatarUrl,
  oberyn: oberynAvatarUrl,
  hodor: hodorAvatarUrl,
  tyrion: tyrionAvatarUrl,
  "jon-snow": jonSnowAvatarUrl,
  daenerys: daenerysAvatarUrl,
  varys: varysAvatarUrl,
  "ned-stark": nedStarkAvatarUrl,
  samwell: samwellAvatarUrl,
};

export function getDrogonBotAvatarSrc(
  preset: DrogonBotCharacterPreset,
): string | null {
  return DROGON_BOT_AVATAR_ASSETS[preset] ?? null;
}
