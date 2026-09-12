import { Badge } from "@drogon/desktop";

/** Every variant, side by side. */
export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="default">Default</Badge>
      <Badge variant="secondary">Secondary</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="destructive">Destructive</Badge>
      <Badge variant="dot">Dot</Badge>
      <Badge variant="ghost">Ghost</Badge>
    </div>
  );
}
