// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Tests for the ported RecipeVerification and MentuRuntimeMessage: declared
// verify commands render with an honest not-recorded result, and the
// runtime message carries the reference's labels with the evidence
// affordance only on execution failures.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { beforeEach } from "vitest";
import { MentuRuntimeMessage } from "./MentuRuntimeMessage";
import { RecipeVerification } from "./RecipeVerification";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

describe("RecipeVerification", () => {
  it("reports not recorded when the run record carries no verification", () => {
    render(<RecipeVerification verification={null} />);
    expect(screen.getByText("Verification: not recorded")).toBeTruthy();
  });

  it("counts recorded errors and warnings with details", () => {
    render(
      <RecipeVerification
        verification={{
          errors: ["Verification command failed: test -f out.txt"],
          warnings: [{ message: "boundary drift is advisory" }],
        }}
      />,
    );
    expect(screen.getByText("Verification: 1 error, 1 warning")).toBeTruthy();
    fireEvent.click(screen.getByText("Verification details"));
    expect(screen.getByText("Verification command failed: test -f out.txt")).toBeTruthy();
    expect(screen.getByText("boundary drift is advisory")).toBeTruthy();
  });

  it("stays honest when the issue shape is unrecognized", () => {
    render(<RecipeVerification verification={{ errors: [42], warnings: [] }} />);
    expect(screen.getByText("Verification: 1 error, 0 warnings")).toBeTruthy();
    fireEvent.click(screen.getByText("Verification details"));
    expect(
      screen.getByText("Unrecognized verification issue; inspect the raw run record."),
    ).toBeTruthy();
  });
});

describe("MentuRuntimeMessage", () => {
  it("labels every runtime kind with the reference copy", () => {
    const { rerender } = render(
      <MentuRuntimeMessage kind="unavailable" message="down" onOpenEvidence={() => {}} />,
    );
    expect(screen.getByText("Mentu Recipes unavailable:")).toBeTruthy();
    rerender(<MentuRuntimeMessage kind="conflict" message="changed" onOpenEvidence={() => {}} />);
    expect(screen.getByText("Recipe changed on disk:")).toBeTruthy();
  });

  it("offers View evidence only for execution failures", () => {
    const onOpenEvidence = vi.fn();
    const { rerender } = render(
      <MentuRuntimeMessage kind="invalid" message="bad" onOpenEvidence={onOpenEvidence} />,
    );
    expect(screen.queryByText("View evidence")).toBe(null);
    rerender(
      <MentuRuntimeMessage kind="execution-failed" message="boom" onOpenEvidence={onOpenEvidence} />,
    );
    fireEvent.click(screen.getByText("View evidence"));
    expect(onOpenEvidence).toHaveBeenCalledTimes(1);
  });
});
