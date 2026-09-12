import { Button, Dialog, DialogContent, DialogFooter, DialogTitle } from "@drogon/desktop";

/** DialogFooter only makes sense inside an open Dialog's content. */
export function InDialog() {
  return (
    <Dialog defaultOpen>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="sr-only">Delete worktree?</DialogTitle>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
