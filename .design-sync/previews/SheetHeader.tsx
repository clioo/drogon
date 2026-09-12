import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@drogon/desktop";

/** SheetHeader only makes sense inside an open Sheet's content. */
export function InSheet() {
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
