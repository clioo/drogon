/* MIT Copyright (c) 2026 Lovecast Inc. Recipe ported from the
   IconButton in Orca-derived App.tsx (ghost icon button with tooltip). */
import { forwardRef } from "react";
import { Tooltip } from "radix-ui";
import { Button } from "../../components/ui/button";

export const ShellIconButton = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof Button> & { label: string }
>(function ShellIconButton({ label, children, ...props }, ref) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={4}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});
