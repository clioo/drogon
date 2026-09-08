/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/DrogonBotAvatar.tsx (adapter: the source
   renders per-preset character artwork through getDrogonBotAvatarSrc, with
   a Bot glyph fallback when no artwork resolves. Rights to the images under
   the source's src/renderer/src/assets/bots are not verified for this repo,
   so the artwork branch renders initials of the preset's character label on
   the same frame instead; the `none`/unknown fallback keeps the source's
   Bot glyph branch verbatim. Frame classes, sizes, and the role="img" +
   aria-label wiring are the source's verbatim.) */

import { Bot } from "lucide-react";
import { cn } from "../../lib/utils";
import { BOT_CHARACTERS } from "./bot-characters";

function initialsOf(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export function DrogonBotAvatar({
  preset,
  alt,
  className,
}: {
  // Free-form like the stored record (native owns preset validation): a
  // known preset renders its character initials, anything else — `none`
  // included — takes the source's Bot glyph fallback.
  preset: string;
  alt: string;
  className?: string;
}): React.JSX.Element {
  const label =
    BOT_CHARACTERS.find((entry) => entry.value === preset)?.label ?? null;

  return (
    <span
      role="img"
      aria-label={alt}
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {label ? (
        <span aria-hidden="true" className="text-xs font-semibold leading-none">
          {initialsOf(label)}
        </span>
      ) : (
        <Bot className="size-4" aria-hidden />
      )}
    </span>
  );
}

export default DrogonBotAvatar;
