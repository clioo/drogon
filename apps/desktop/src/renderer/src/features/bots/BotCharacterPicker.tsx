/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/BotCharacterPicker.tsx verbatim (adapter:
   none — DrogonBotAvatar renders initials on the source's frame instead of
   the character artwork, see DrogonBotAvatar.tsx). */

import { useState } from "react";
import { Button } from "../../components/ui/button";
import { PRESETS } from "./bots-page-model";
import type { BotCreateFormValues } from "./bots-page-model";
import { DrogonBotAvatar } from "./DrogonBotAvatar";

export function BotCharacterPicker({
  value,
  onChange,
}: {
  value: BotCreateFormValues["preset"];
  onChange: (value: BotCreateFormValues["preset"]) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const characters = expanded ? PRESETS : PRESETS.slice(0, 6);
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-medium">Character</legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {characters.map((character) => (
          <label key={character.value} className="cursor-pointer">
            <input
              type="radio"
              name="bot-character"
              value={character.value}
              checked={value === character.value}
              onChange={() => onChange(character.value)}
              className="peer sr-only"
            />
            <span className="flex h-full flex-col items-center gap-2 rounded-md border border-transparent px-1 py-2 text-center text-xs hover:bg-accent peer-checked:border-ring peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
              <DrogonBotAvatar
                preset={character.value}
                alt=""
                className="size-12"
              />
              {character.label}
            </span>
          </label>
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Fewer characters" : "All characters"}
      </Button>
    </fieldset>
  );
}

export default BotCharacterPicker;
