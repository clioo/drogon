import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@drogon/desktop";

/** Canonical composition: header (title + description) over form content. */
export function Default() {
  return (
    <Card className="w-full max-w-md" aria-label="Add responsibility">
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Add responsibility</CardTitle>
        <CardDescription>
          Scheduled work is persisted as a Bot-owned automation and uses the
          existing scheduler.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 pt-6">
        <label className="space-y-1.5 text-xs font-medium">
          Name
          <Input placeholder="Review incoming work" />
        </label>
        <label className="space-y-1.5 text-xs font-medium">
          Cron expression (UTC)
          <Input className="font-mono" placeholder="* * * * *" />
        </label>
        <Button className="w-fit">Save</Button>
      </CardContent>
    </Card>
  );
}

/** A plain, content-only card with no header. */
export function ContentOnly() {
  return (
    <Card className="w-full max-w-sm">
      <CardContent className="pt-6 text-sm text-muted-foreground">
        No automations yet. Create one to get started.
      </CardContent>
    </Card>
  );
}
