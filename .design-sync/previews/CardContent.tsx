import { Card, CardContent } from "@drogon/desktop";

/** CardContent is a body slot - shown inside its parent Card. */
export function InCard() {
  return (
    <Card className="w-full max-w-sm">
      <CardContent className="pt-6 text-sm text-muted-foreground">
        No automations yet. Create one to get started.
      </CardContent>
    </Card>
  );
}
