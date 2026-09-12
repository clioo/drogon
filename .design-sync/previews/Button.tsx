import { Button } from "@drogon/desktop";
import { Plus } from "lucide-react";

/** Every variant at the default size, side by side. */
export function Variants() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="default">Default</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="outline">Outline</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="destructive">Destructive</Button>
      <Button variant="link">Link</Button>
    </div>
  );
}

/** Every size, default variant. */
export function Sizes() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="xs">Extra small</Button>
      <Button size="sm">Small</Button>
      <Button size="default">Default</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

/** Button composed with a leading icon, and an icon-only button. */
export function WithIcon() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button>
        <Plus />
        New task
      </Button>
      <Button variant="outline" size="icon" aria-label="Add">
        <Plus />
      </Button>
    </div>
  );
}

/** Disabled state. */
export function Disabled() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled>Default</Button>
      <Button variant="outline" disabled>
        Outline
      </Button>
    </div>
  );
}
