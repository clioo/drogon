// Opens the existing HarnessLaunchMenu flow from the command palette: the
// menu trigger is the "New terminal" (+) button in the terminal tabs row, and
// a real click opens the actual menu (terminal + per-harness rows), so the
// palette never reimplements or bypasses the launch form and its recovery.
export function openHarnessLaunchMenu(doc: Document = document): boolean {
  const trigger = doc.querySelector('button[aria-label="New terminal"]');
  if (trigger instanceof HTMLElement && !trigger.hasAttribute("disabled")) {
    trigger.click();
    return true;
  }
  return false;
}
