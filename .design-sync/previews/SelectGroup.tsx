import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@drogon/desktop";

/** SelectGroup only appears inside an open Select's content, grouping related items under a label. */
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
          <SelectItem value="claude-sonnet">Claude Sonnet</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
