import { expect, test } from "vitest";
import type { Session } from "../../shared/session-contract";
import { updateSessionProjection } from "./session-projection";

const session: Session = {
  id: "a",
  incarnation: "original",
  workspaceId: "w",
  hostId: "h",
  command: "sh",
  args: [],
  cols: 80,
  rows: 24,
  verdict: "live",
  exitCode: null,
  createdAt: "2026-09-05T00:00:00Z",
};
test("unchanged reads do not trigger a rerender", () => {
  const items = [session];
  expect(updateSessionProjection(items, { ...session })).toBe(items);
});
test("observations from another incarnation cannot change state", () => {
  const items = [session];
  expect(
    updateSessionProjection(items, {
      ...session,
      incarnation: "stale",
      verdict: "exited",
    }),
  ).toBe(items);
});
test("observed resize or exit updates the exact session", () => {
  const items = [session];
  expect(updateSessionProjection(items, { ...session, cols: 90 })[0].cols).toBe(
    90,
  );
  expect(
    updateSessionProjection(items, {
      ...session,
      verdict: "exited",
      exitCode: 0,
    })[0].verdict,
  ).toBe("exited");
});
