## Wrapping and setup

Most components need no wrapper. **`Tooltip`/`TooltipTrigger`/`TooltipContent` do**: wrap the app root (or at least the tree that uses them) in `TooltipProvider`, or Tooltip throws. It's a real exported component, not a context you construct yourself:

```tsx
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "<pkg>";

<TooltipProvider>
  <YourApp />
</TooltipProvider>
```

`Sheet` and `Dialog` need no separate provider - `Sheet` specifically has **no `SheetTrigger` export**; open it by controlling `open`/`onOpenChange` on `<Sheet>` directly (`Dialog` does have `DialogTrigger` if you want a declarative trigger instead).

## Styling idiom: Tailwind v4 utility classes + real design tokens

Every component is styled with Tailwind utility classes bound to CSS custom properties defined once in `styles.css`'s `@theme` block - never invent a new color, always reach for an existing token. The recurring family:

| Purpose | Classes |
|---|---|
| Primary action | `bg-primary text-primary-foreground` |
| Secondary surface | `bg-secondary text-secondary-foreground` |
| Muted/quiet text | `text-muted-foreground` |
| Card/elevated surface | `bg-card text-card-foreground` |
| Popover/menu surface | `bg-popover text-popover-foreground` |
| Destructive | `bg-destructive text-white` (light) / adjusts automatically in `.dark` |
| Borders | `border-border`, inputs use `border-input` |
| Focus ring | `focus-visible:ring-[3px] focus-visible:ring-ring/50` |
| Accent (hover/selected) | `bg-accent text-accent-foreground` |

Radius comes from `rounded-md`/`rounded-lg`/`rounded-full` (never a raw px value). Dark mode is automatic: every token above is redefined under `.dark` in `styles.css`, so plain token classes work in both themes with no `dark:` prefix needed for color - only use `dark:` for the rare non-token tweak (see `button.tsx`'s `dark:bg-input/30` on the outline variant).

Overlay surfaces (Dialog/Sheet/DropdownMenu/ContextMenu/Popover/HoverCard) use a translucent-blur recipe, not a flat token: `bg-background/96 backdrop-blur-2xl` plus a hairline border (`border-black/14 dark:border-white/14`) and a two-layer shadow. Reuse that pattern rather than a plain `bg-popover` for anything that floats above other content.

## Where the truth lives

Read `styles.css` (and its `@import`ed `_ds_bundle.css`) for the complete token list before styling anything - `--color-*` custom properties are the single source of truth for every color. Each component's `.d.ts` is its real prop contract; its `.prompt.md` shows real composition. `Button`'s variant/size enums and `Badge`'s variant enum are the canonical example of this DS's "variant prop, not raw classes" pattern for anything with visual states.

## Fonts

Body text uses `Geist` (variable weight, shipped in `fonts/`), falling back to system sans. Monospace text (`font-mono`, used for code/cron/paths) falls back through a system stack (`SF Mono`, `Menlo`, `Consolas`, etc.) with no custom font shipped for it - that's intentional, not missing.

## Build snippet

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Input, Button } from "<pkg>";

<Card className="w-full max-w-md">
  <CardHeader className="border-b">
    <CardTitle className="text-sm">Add responsibility</CardTitle>
    <CardDescription>Runs on the existing scheduler.</CardDescription>
  </CardHeader>
  <CardContent className="grid gap-4 pt-6">
    <Input placeholder="Review incoming work" />
    <Button className="w-fit">Save</Button>
  </CardContent>
</Card>
```
