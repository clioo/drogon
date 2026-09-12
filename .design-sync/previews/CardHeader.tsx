import { Card, CardDescription, CardHeader, CardTitle } from "@drogon/desktop";

/** CardHeader only makes sense inside a Card - shown here with its usual siblings. */
export function InCard() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Add responsibility</CardTitle>
        <CardDescription>
          Scheduled work is persisted as a Bot-owned automation.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
