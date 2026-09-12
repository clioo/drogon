import { Textarea } from "@drogon/desktop";

/** Empty (with placeholder), with a value, and disabled. */
export function States() {
  return (
    <div className="flex w-72 flex-col gap-3">
      <Textarea placeholder="Describe the responsibility..." />
      <Textarea defaultValue="Scheduled work is persisted as a Bot-owned automation." />
      <Textarea placeholder="Disabled" disabled />
    </div>
  );
}
