// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { ServiceCapabilityNotice } from "./ServiceCapabilityNotice";

afterEach(cleanup);

test.each(["Bots", "Agent settings"] as const)("%s names the missing capability and the explicit destructive restart", (feature) => {
  render(<ServiceCapabilityNotice feature={feature} />);
  const text = screen.getByRole("status").textContent;
  expect(text).toContain(`does not support ${feature}`);
  expect(text).toContain("Nothing is restarted automatically");
  expect(text).toContain("Settings → Terminal");
  expect(text).toContain("stops every session");
  expect(screen.queryByRole("button")).toBeNull();
});

test("loss of contact is not misreported as an old or incapable service", () => {
  render(<ServiceCapabilityNotice feature="Bots" connected={false} />);
  expect(screen.getByRole("status").textContent).toContain("not connected");
  expect(screen.getByRole("status").textContent).not.toContain("does not support");
  expect(screen.getByRole("status").textContent).not.toContain("Restart daemon");
});
