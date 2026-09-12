import { Checkbox, Input, Label } from "@drogon/desktop";

/** A plain text label, and one paired with a field via htmlFor. */
export function Default() {
  return (
    <div className="flex flex-col gap-4">
      <Label>Cache Timer</Label>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="Review incoming work" />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="agree" />
        <Label htmlFor="agree">I agree to the terms</Label>
      </div>
    </div>
  );
}
