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

/** Canonical usage: a labeled trigger with a short option list, open so the
 * popover content is visible in the card. */
export function Open() {
  return (
    <Select defaultValue="300000" open>
      <SelectTrigger aria-label="Timer Duration" size="sm" className="h-7 text-xs w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="300000">5 minutes</SelectItem>
        <SelectItem value="3600000">1 hour</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Closed trigger, default size. */
export function Closed() {
  return (
    <Select defaultValue="apple">
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Pick a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
        <SelectItem value="grape">Grape</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Grouped options with a label and a separator between groups. */
export function Grouped() {
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
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Local</SelectLabel>
          <SelectItem value="local-model">dgx-spark</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
