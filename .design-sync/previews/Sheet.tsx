import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@drogon/desktop";

/**
 * Sheet has no local trigger export - the app opens it via the `open` prop
 * directly, so this preview does the same to show the panel.
 */
export function Default() {
  return (
    <Sheet open>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>Manage agent and workspace preferences.</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
