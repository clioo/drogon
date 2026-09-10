/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/DrogonBotAvatar.tsx verbatim (adapters:
   import paths only — `cn` from this repo's lib/utils, the preset type from
   bot-characters, the artwork map from lib/drogon-bot-avatar-assets; the
   artwork PNGs are byte-for-byte copies of the source's
   src/renderer/src/assets/bots). Unknown presets fall to the Bot glyph
   exactly like the source's `none`. */

import { Bot } from "lucide-react";
import { cn } from "../../lib/utils";
import type { DrogonBotCharacterPreset } from "./bot-characters";
import { getDrogonBotAvatarSrc } from "../../lib/drogon-bot-avatar-assets";

export function DrogonBotAvatar({
  preset,
  alt,
  className,
  initials,
}: {
  preset: DrogonBotCharacterPreset;
  alt: string;
  className?: string;
  /** Fallback tile text when the preset has no artwork (the owner design's
   *  initials tile — e.g. "AS"). Without it the Bot glyph renders, exactly
   *  like the source's `none` fallback. */
  initials?: string;
}): React.JSX.Element {
  const src = getDrogonBotAvatarSrc(preset);

  return (
    <span
      role="img"
      aria-label={alt}
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      ) : initials ? (
        <span
          aria-hidden
          className="text-xs font-semibold text-foreground"
        >
          {initials}
        </span>
      ) : (
        <Bot className="size-4" aria-hidden />
      )}
    </span>
  );
}
