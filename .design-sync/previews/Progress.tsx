import { Progress } from "@drogon/desktop";

/** A few fill levels. */
export function Levels() {
  return (
    <div className="flex w-72 flex-col gap-4">
      <Progress value={13} />
      <Progress value={62} />
      <Progress value={100} />
    </div>
  );
}
