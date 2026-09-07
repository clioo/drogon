// Shared terminal-buffer reader for desktop acceptance (R11-C).
// Extracted from the inline readers in scripts/accept-desktop.mjs: the live
// xterm buffers are read from the `window.__drogonTerminals` debug registry
// (the WebGL renderer leaves no DOM text); when the registry is empty the
// `.xterm-screen` DOM text is the fallback.
//
// NOTE: the page closures below repeat the walk literally instead of calling
// `extractTerminalText` because the packaged renderer ships
// `script-src 'self'` and rejects `eval` (and string evaluation) inside the
// page. `extractTerminalText` is the pure, unit-tested projection of that
// exact walk for Node-side assertions.

/** Pure join of every live xterm buffer row; tolerates sparse registries. */
export function extractTerminalText(terminals) {
  const lines = [];
  for (const terminal of terminals ?? []) {
    const buffer = terminal?.buffer?.active;
    if (!buffer) continue;
    for (let row = 0; row < buffer.length; row += 1) {
      lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
    }
  }
  return lines.join("\n");
}

/** Full rendered terminal text for `page` (registry first, DOM fallback). */
export async function terminalBufferText(page) {
  return page.evaluate(() => {
    const registry = window.__drogonTerminals;
    if (registry && registry.size > 0) {
      const lines = [];
      for (const terminal of registry.values()) {
        const buffer = terminal.buffer.active;
        for (let row = 0; row < buffer.length; row += 1) {
          lines.push(buffer.getLine(row)?.translateToString(true) ?? "");
        }
      }
      return lines.join("\n");
    }
    return document.querySelector(".xterm-screen")?.textContent ?? "";
  });
}

/** Waits until the rendered terminal text contains `marker`. */
export async function waitForTerminalText(page, marker, options) {
  await page.waitForFunction(
    (value) => {
      const registry = window.__drogonTerminals;
      const rendered =
        registry && registry.size > 0
          ? (() => {
              const lines = [];
              for (const terminal of registry.values()) {
                const buffer = terminal.buffer.active;
                for (let row = 0; row < buffer.length; row += 1) {
                  lines.push(
                    buffer.getLine(row)?.translateToString(true) ?? "",
                  );
                }
              }
              return lines.join("\n");
            })()
          : (document.querySelector(".xterm-screen")?.textContent ?? "");
      return rendered.includes(value);
    },
    marker,
    options,
  );
}
