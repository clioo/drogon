// Adapted from Orca's shadcn Button; see THIRD_PARTY_NOTICES.md.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const variants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md cursor-pointer text-sm font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        outline: "border border-border bg-background hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      },
      size: { default: "h-9 px-4 py-2", sm: "h-8 px-3", icon: "size-8" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> &
    VariantProps<typeof variants> & { asChild?: boolean }
>(function Button({ className, variant, size, asChild, ...props }, ref) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      data-slot="button"
      className={twMerge(clsx(variants({ variant, size }), className))}
      {...props}
    />
  );
});
