import { Input } from "@drogon/desktop";

/** Default, with a value, disabled, and invalid states. */
export function States() {
  return (
    <div className="flex w-72 flex-col gap-3">
      <Input placeholder="Review incoming work" />
      <Input defaultValue="* * * * *" className="font-mono" />
      <Input placeholder="Disabled" disabled />
      <Input defaultValue="not-an-email" aria-invalid />
    </div>
  );
}
