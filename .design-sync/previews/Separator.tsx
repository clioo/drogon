import { Separator } from "@drogon/desktop";

/** Horizontal, between two lines of text, and vertical, between two inline labels. */
export function Default() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm">Drogon</p>
        <Separator className="my-2" />
        <p className="text-sm text-muted-foreground">A from-zero rewrite.</p>
      </div>
      <div className="flex h-5 items-center gap-3 text-sm">
        <span>Blog</span>
        <Separator orientation="vertical" />
        <span>Docs</span>
        <Separator orientation="vertical" />
        <span>Source</span>
      </div>
    </div>
  );
}
