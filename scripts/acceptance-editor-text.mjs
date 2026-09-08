// Shared Monaco editor reader for desktop acceptance (R12-A).
// The file editor is Monaco now, not a textarea: its content lives in a
// Monaco model, not a DOM input value. Acceptance reads/writes go through
// the `window.__drogonEditors` debug registry (mirroring
// `window.__drogonTerminals`), keyed by the workspace-relative path — this
// app never mounts more than one file editor at a time, so the path is the
// natural externally-visible identity.
//
// Each function below passes `page.evaluate`/`page.waitForFunction` a
// SELF-CONTAINED arrow function (only its own argument and the page-global
// `window`, no reference to anything imported here) — the same discipline
// scripts/acceptance-terminal-text.mjs documents: the packaged renderer's
// `script-src 'self'` CSP means a callback that closed over an import from
// this Node module would not resolve inside the page.

/** Waits until Monaco has mounted and registered the editor for `key`. */
export async function waitForEditorRegistered(page, key) {
  await page.waitForFunction(
    (k) => window.__drogonEditors?.get(k) !== undefined,
    key,
    { timeout: 10_000 },
  );
}

/** The live Monaco model's current text for `key`. */
export async function readEditorValue(page, key) {
  return page.evaluate((k) => window.__drogonEditors.get(k).getValue(), key);
}

/** Sets the live Monaco model's text for `key`, firing the same onChange path a real edit would. */
export async function setEditorValue(page, key, value) {
  await page.evaluate(
    ({ k, v }) => window.__drogonEditors.get(k).setValue(v),
    { k: key, v: value },
  );
}
