# Drogon design-sync notes

## Repo shape

Drogon has no standalone design-system package. The only component library is
`apps/desktop/src/renderer/src/components/ui` — ~27 shadcn/Radix primitives
literally ported from the orca-drogon reference, styled with real Tailwind v4
tokens (`bg-primary`, `text-primary-foreground`, etc. defined via `@theme` in
`apps/desktop/src/renderer/src/assets/main.css`). No Storybook, no `*.stories.*`
files anywhere in the repo (confirmed by a full-tree search) — this syncs as
the **package (non-storybook) shape**.

## Why `cfg.entry` points at a file that doesn't exist

`apps/desktop` has no publishable `dist/` build for its UI components — the
package's `main` field points at the Electron main-process bundle
(`out/main/index.js`), not a component-library entry. `cfg.entry` is set to
`apps/desktop/dist/index.js` purely so the converter's directory walk-up finds
`apps/desktop/package.json` (giving `PKG_DIR = apps/desktop`) before falling
back to synth-entry mode from `cfg.srcDir`. This is the intended "no build"
path (`[NO_DIST]` fires as a soft warning, not a failure) — not a bug to fix.

## Why `cssEntry` points at a copied, stable-named file

The real compiled stylesheet is Vite's content-hashed output
(`apps/desktop/out/renderer/assets/index-<hash>.css`), which changes every
build. `cfg.buildCmd` copies it to a fixed name
(`apps/desktop/out/renderer/assets/ds-styles.css`) right after building, and
`cssEntry` points at that fixed name. **Re-sync risk:** always run the full
`cfg.buildCmd` (not just `electron-vite build`) before re-running the
converter, or `cssEntry` will point at a stale/missing file.

## Provider

`TooltipProvider` (from `tooltip.tsx`) is set as `cfg.provider` — Radix
Tooltip primitives throw outside it, and the app itself always wraps its root
in `Tooltip.Provider`. Wrapping every preview in it is a safe no-op for
every other component.

## Component surface

Discovery (via ts-morph PascalCase export scan, since there's no `.d.ts`
tree) finds ~107 exported names across the 27 files — most are compound-
component sub-parts (e.g. `DialogTrigger`, `DialogContent`, `SelectItem`)
that only make sense composed inside their parent. Rich previews are
authored for the ~27 top-level entry points; sub-parts ship fully functional
(bundle + `.d.ts` + synthesized `.prompt.md`) with the floor card, composed
into their parent's authored preview per the package-shape recipe.

## Fonts

Two real `@font-face` families ship in the compiled CSS: `Geist` (variable,
Geist-Variable.woff2) and `Orca Nerd Font Symbols` (SymbolsNerdFontMono-
Regular.woff2, used for terminal glyphs — likely irrelevant to most design
agent output but shipped for fidelity since it's a real brand asset).

## Known render warns (accepted exceptions)

- **Toaster / Default** — `[RENDER_BLANK]`, permanent, not authoring-fixable.
  Sonner's `<Toaster/>` renders a `position: fixed` portal container that is
  never DOM-empty (so it never gets the honest floor-card swap) but always
  measures zero layout height (so it always trips the <5KB blank check) -
  this reproduces identically whether the component is authored or left on
  the floor card. The authored preview's own `toast()` call additionally
  can't reach the bundled `<Toaster/>` instance: `.design-sync/previews/
  Toaster.tsx` is compiled as its own separate esbuild entry point, so its
  `import { toast } from "sonner"` inlines a SECOND, independent copy of the
  `sonner` module - pushing to a store the bundled `_ds_bundle.js` copy never
  subscribes to. Tried both an effect-timed and a module-scope-timed
  `toast()` call; both fail the same way. A real fix needs a
  `.design-sync/overrides/story-imports.mjs` fork that externalizes `sonner`
  to a shared `window` global across both bundles - not done here. The
  bundled `Toaster` component, its `.d.ts`, and `.prompt.md` are all correct
  and fully usable; only this one static preview screenshot can't show a
  live toast. Graded `needs-work` rather than a false `good`.

## Re-sync risks

- The content-hashed CSS filename (see above) — `cfg.buildCmd` handles this,
  but a manual rebuild that skips the `cp` step will break `cssEntry`.
- Component discovery is a live PascalCase export scan of `components/ui/`,
  not a frozen `.d.ts` contract — adding/removing/renaming exports in that
  folder changes the synced component list on the very next sync, with no
  build-time guard against a typo'd export name.
- No per-component `.md`/`.mdx` docs exist for these primitives — every
  `.prompt.md` is synthesized from the `.d.ts` props body, leading JSDoc
  (mostly a "Ported from orca-drogon" source comment, not real usage docs),
  and the authored preview. If real usage docs are added to the repo later,
  point `cfg.docsDir` at them for richer prompts.
- This repo is a live, multi-agent-developed monorepo (see `AGENTS.md`) — a
  re-sync should re-check that `apps/desktop/src/renderer/src/components/ui`
  is still the intended design-system surface before running, in case a
  separate design-system package is split out later.
