import { Toggle } from "@drogon/desktop";
import { Bold, Italic } from "lucide-react";

/** Default variant, off and pressed, plus the outline variant and disabled. */
export function States() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Toggle aria-label="Bold">
        <Bold />
      </Toggle>
      <Toggle aria-label="Italic" pressed>
        <Italic />
      </Toggle>
      <Toggle variant="outline" aria-label="Bold">
        <Bold />
      </Toggle>
      <Toggle aria-label="Bold" disabled>
        <Bold />
      </Toggle>
    </div>
  );
}
