/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotCharacterPicker.tsx (adapter: avatar
   images replaced by BotAvatar's initials-on-a-disc -- rights to the
   character images under src/renderer/src/assets/bots are not verified for
   this repo -- everything else (grid, radio-card markup, expand toggle) is
   ported as-is). */

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { BOT_CHARACTERS } from "./bot-characters";
import { BotAvatar } from "./BotAvatar";
import type { BotCharacterPreset } from "./bot-characters";

export function BotCharacterPicker({
  value,
  onChange,
}: {
  value: BotCharacterPreset;
  onChange: (value: BotCharacterPreset) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const characters = expanded ? BOT_CHARACTERS : BOT_CHARACTERS.slice(0, 6);
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-medium">Character</legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {characters.map((character) => (
          <label key={character.value} className="cursor-pointer">
            <input
              className="peer sr-only"
              type="radio"
              name="bot-character"
              value={character.value}
              checked={value === character.value}
              onChange={() => onChange(character.value)}
            />
            <span className="flex h-full flex-col items-center gap-2 rounded-md border border-transparent px-1 py-2 text-center text-xs hover:bg-accent peer-checked:border-ring peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
              <BotAvatar displayName={character.label} size={12} />
              {character.label}
            </span>
          </label>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "Fewer characters" : "All characters"}
      </Button>
    </fieldset>
  );
}

export default BotCharacterPicker;
