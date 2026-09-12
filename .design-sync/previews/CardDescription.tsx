import { Card, CardDescription, CardHeader, CardTitle } from "@drogon/desktop";

/** CardDescription is a header slot - shown inside its parent Card/CardHeader. */
export function InCard() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-sm">Add responsibility</CardTitle>
        <CardDescription>
          Scheduled work is persisted as a Bot-owned automation and uses the
          existing scheduler.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
