// @vitest-environment node
// User-feature-closure item 3: the removal-confirmation copy must never
// tell the user a Chat (standalone quick session) "is still on your disk"
// -- cleanup_quick_session_scratch actually deletes it as part of the same
// project.remove call. A regular project's copy (files untouched) must
// stay exactly as before.
import { describe, expect, it } from "vitest";
import { getRemoveProjectDialogCopy } from "./remove-project-dialog-copy";

describe("getRemoveProjectDialogCopy", () => {
  it("keeps the registration-only copy for an ordinary project", () => {
    const copy = getRemoveProjectDialogCopy("drogon");
    expect(copy.title).toBe("Remove Project");
    expect(copy.confirmLabel).toBe("Remove");
    expect(copy.descriptionAfterName).toContain("still on your disk");
  });

  it("defaults to the registration-only copy when isQuickSession is omitted", () => {
    expect(getRemoveProjectDialogCopy("drogon").title).toBe("Remove Project");
  });

  it("warns about permanent file deletion for a quick session Chat", () => {
    const copy = getRemoveProjectDialogCopy("Chat", true);
    expect(copy.title).toBe("Delete Chat");
    expect(copy.confirmLabel).toBe("Delete");
    expect(copy.descriptionAfterName).not.toContain("still on your disk");
    expect(copy.descriptionAfterName).toMatch(/permanently|cannot be undone/i);
  });

  it("names the exact chat, never a generic placeholder", () => {
    expect(getRemoveProjectDialogCopy("Acceptance Chat", true).targetLabel).toBe(
      "Acceptance Chat",
    );
  });
});
