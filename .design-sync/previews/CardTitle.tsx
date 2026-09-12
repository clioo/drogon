import { Card, CardHeader, CardTitle } from "@drogon/desktop";

/** CardTitle is a header slot - shown inside its parent Card/CardHeader. */
export function InCard() {
  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-sm">Add responsibility</CardTitle>
      </CardHeader>
    </Card>
  );
}
