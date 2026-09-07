/* MIT Copyright (c) 2026 Lovecast Inc. Ported from Orca's
   src/renderer/src/components/bots/DrogonBotAvatar.tsx (adapter: the
   source renders a preset character image, falling back to a generic Bot
   icon glyph. Rights to the character images under
   src/renderer/src/assets/bots are not verified for this repo, so this is a
   from-scratch replacement: initials derived from the display name, on a
   plain monochrome disc using only admitted main.css tokens -- no images,
   no per-character color coding.). */

function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

// Matches the source's DrogonBotAvatar wrapper span recipe exactly
// (`role="img" aria-label="" class="flex shrink-0 items-center
// justify-center overflow-hidden rounded-full border border-border
// bg-muted text-muted-foreground size-*"`), swapping the `<img>` for
// initials text -- the only two sizes the source actually uses.
const SIZE_CLASS: Record<number, string> = { 9: "size-9", 12: "size-12" };

export function BotAvatar({
  displayName,
  size = 12,
}: {
  displayName: string;
  size?: number;
}) {
  return (
    <span
      role="img"
      aria-label=""
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-muted-foreground ${
        SIZE_CLASS[size] ?? "size-12"
      }`}
    >
      <span className="text-xs font-semibold leading-none">
        {initialsOf(displayName)}
      </span>
    </span>
  );
}

export default BotAvatar;
