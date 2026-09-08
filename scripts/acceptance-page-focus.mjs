// Page focus emulation for CDP-driven checks. The harnesses launch Electron with
// DROGON_BACKGROUND_WINDOW=1 (window shown inactive so the user keeps focus);
// without emulation the page would report document.hasFocus() === false and
// skip :focus styling, which the probes rely on.
export async function emulatePageFocus(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  return cdp;
}
