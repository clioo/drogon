import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@drogon/desktop";

/** SelectSeparator divides groups inside an open Select's content. */
export function InSelect() {
  return (
    <Select defaultValue="claude-opus" open>
      <SelectTrigger className="w-[220px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Claude</SelectLabel>
          <SelectItem value="claude-opus">Claude Opus</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Local</SelectLabel>
          <SelectItem value="local-model">dgx-spark</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
