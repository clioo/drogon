// Opens the tab strip's "+" create menu from the command palette: the menu
// trigger is the "New tab" (+) button in the tab strip, and a real click
// opens the actual menu (New Terminal, per-harness rows with the launch
// form, New Browser Tab), so the palette never reimplements or bypasses
// the launch form and its recovery.
export function openTabCreateMenu(doc: Document = document): boolean {
  const trigger = doc.querySelector('button[aria-label="New tab"]');
  if (trigger instanceof HTMLElement && !trigger.hasAttribute("disabled")) {
    trigger.click();
    return true;
  }
  return false;
}
