// Adapted from Orca's shadcn Input; placeholder contrast uses the full inherited token.
import * as React from "react";
import { twMerge } from "tailwind-merge";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      data-slot="input"
      className={twMerge(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
});
