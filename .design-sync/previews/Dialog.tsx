import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@drogon/desktop";

/** A confirm-style dialog, opened by default so its content is visible. */
export function Default() {
  return (
    <Dialog defaultOpen>
      <DialogTrigger asChild>
        <Button variant="outline">Delete worktree</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete worktree?</DialogTitle>
          <DialogDescription>
            This removes the worktree and its uncommitted changes. This
            can't be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button variant="destructive">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
