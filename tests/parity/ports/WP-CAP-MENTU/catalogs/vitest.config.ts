import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Binding seam for this bounded port tree, authorized by the coordinator
// (V4-B2R ask, 2026-09-07): pnpm's isolated layout links `zod` only under
// apps/desktop/node_modules, so a bare 'zod' import from tests/parity/ports/
// cannot resolve. This alias points the bare specifier at the exact
// worktree-installed copy (zod 4.5.4, the version the pinned source pins).
// Nothing is installed, substituted, vendored or mocked here, and no
// lockfile/manifest outside this directory is touched.
// Plain-object config on purpose: 'vitest/config' itself is not resolvable
// from this path, and defineConfig is only a typing helper.
const installedZod = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../../../apps/desktop/node_modules/zod",
);

export default {
  resolve: {
    alias: {
      zod: installedZod,
    },
  },
};
