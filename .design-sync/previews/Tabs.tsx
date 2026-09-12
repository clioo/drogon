import { Tabs, TabsContent, TabsList, TabsTrigger } from "@drogon/desktop";

/** Default variant with an active tab and its content visible. */
export function Default() {
  return (
    <Tabs defaultValue="overview" className="w-full max-w-md">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="text-sm text-muted-foreground">
        3 agents running across 2 worktrees.
      </TabsContent>
    </Tabs>
  );
}

/** The underline "line" variant. */
export function LineVariant() {
  return (
    <Tabs defaultValue="overview" className="w-full max-w-md">
      <TabsList variant="line">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="text-sm text-muted-foreground">
        3 agents running across 2 worktrees.
      </TabsContent>
    </Tabs>
  );
}
