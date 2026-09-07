import { describe, expect, test } from "vitest";
import {
  CHANGES_ROUTE_ID,
  CHANGES_TITLE,
  createChangesPanelDescriptor,
  isChangesAvailable,
} from "./ChangesPanel";
import { GIT_CAPABILITY, type GitBridge } from "../../../../shared/git-contract";

const bridge = {} as GitBridge;

describe("changes panel contract", () => {
  test("keeps the source-control route identity and capability gate", () => {
    expect(CHANGES_ROUTE_ID).toBe("changes");
    expect(CHANGES_TITLE).toBe("Changes");
    expect(isChangesAvailable([GIT_CAPABILITY])).toBe(true);
    expect(isChangesAvailable([])).toBe(false);
  });

  test("descriptor carries the git capability", () => {
    const descriptor = createChangesPanelDescriptor({ bridge });
    expect(descriptor.id).toBe(CHANGES_ROUTE_ID);
    expect(descriptor.capability).toBe(GIT_CAPABILITY);
  });
});
