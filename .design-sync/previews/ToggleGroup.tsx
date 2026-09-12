import { ToggleGroup, ToggleGroupItem } from "@drogon/desktop";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";

/** Single-select group with one item pressed, outline variant. */
export function Default() {
  return (
    <ToggleGroup type="single" defaultValue="left" variant="outline">
      <ToggleGroupItem value="left" aria-label="Align left">
        <AlignLeft />
      </ToggleGroupItem>
      <ToggleGroupItem value="center" aria-label="Align center">
        <AlignCenter />
      </ToggleGroupItem>
      <ToggleGroupItem value="right" aria-label="Align right">
        <AlignRight />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
