import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `zod` is bundled (not externalized) for main/preload: it is the only
// runtime dependency `shared/*-validation.ts` needs there, and bundling it
// is what lets the packaged `out/` tree run standalone with no `node_modules`
// alongside `resources/bin/drogond`/`drogon-cli`.
const nativeDepsPlugin = externalizeDepsPlugin({ exclude: ["zod"] });

export default defineConfig({
  main: { plugins: [nativeDepsPlugin] },
  preload: { plugins: [nativeDepsPlugin] },
  renderer: { plugins: [react(), tailwindcss()] },
});
