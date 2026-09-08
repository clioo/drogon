// @vitest-environment jsdom
// MIT Copyright (c) 2026 Lovecast Inc.
// Evidence-content tests for the ported recipe-pane views: the evidence
// view renders loaded per-step stdout/stderr CONTENT (not just paths),
// spells the daemon's truncation and read-failure reasons, and falls back
// to path-only rows while evidence loads or when the bridge has no
// evidence method.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type {
  MentuRecipeDetail,
  MentuRun,
  MentuStepEvidence,
} from "../../../../shared/mentu-contract";
import { installRadixJsdomStubs } from "../../components/ui/radix-jsdom-stubs";
import { EvidenceView } from "./recipe-pane-views";

beforeEach(installRadixJsdomStubs);
afterEach(cleanup);

const HASH = "a".repeat(64);

function recipe(): MentuRecipeDetail {
  return {
    id: "demo",
    path: ".mentu/recipes/demo.json",
    name: "demo",
    description: null,
    contentHash: HASH,
    steps: [
      {
        label: "build",
        backend: "shell",
        description: null,
        dependsOn: [],
        timeoutSeconds: null,
        verifyCommands: [],
      },
    ],
    source: "{}",
  };
}

function run(): MentuRun {
  return {
    id: "run-1",
    workspaceId: "ws",
    recipeId: "demo",
    approvalId: "approval-1",
    mentuRunId: "run_fixture_1",
    status: "succeeded",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:00:05Z",
    steps: [
      {
        label: "build",
        backend: "shell",
        status: "succeeded",
        exitCode: 0,
        durationSeconds: 1,
        attempts: 1,
        outputPath: ".mentu/runs/run_fixture_1/build.stdout",
        errorPath: ".mentu/runs/run_fixture_1/build.stderr",
        error: null,
        verification: null,
      },
    ],
    error: null,
    retryOf: null,
  };
}

function stream(
  reference: string,
  content: string | null,
  extra: { path?: string | null; error?: string | null } = {},
) {
  return {
    reference,
    path: extra.path === undefined ? `/ws/.mentu/runs/run_fixture_1/${reference}` : extra.path,
    content,
    error: extra.error ?? null,
  };
}

function evidence(): MentuStepEvidence[] {
  return [
    {
      label: "build",
      stdout: stream("build.stdout", "hello from the fixture\n"),
      stderr: stream("build.stderr", ""),
    },
  ];
}

describe("EvidenceView with loaded evidence", () => {
  it("renders stdout content and marks both streams captured", () => {
    render(<EvidenceView run={run()} recipe={recipe()} evidence={evidence()} />);
    expect(screen.getByText("stdout captured · stderr captured")).toBeTruthy();
    expect(screen.getByLabelText("stdout output")).toBeTruthy();
    expect(screen.getByText("hello from the fixture")).toBeTruthy();
    // An empty-but-captured stderr needs no content block.
    expect(screen.queryByLabelText("stderr output")).toBeNull();
    // The recorded paths stay visible alongside the content.
    expect(
      screen.getByText("stdout: .mentu/runs/run_fixture_1/build.stdout"),
    ).toBeTruthy();
  });

  it("renders a failed step's stderr content with its error text", () => {
    const failed = run();
    failed.status = "failed";
    failed.error = "build failed";
    failed.steps[0]!.status = "failed";
    failed.steps[0]!.exitCode = 3;
    failed.steps[0]!.error = "step exited with code 3";
    render(
      <EvidenceView
        run={failed}
        recipe={recipe()}
        evidence={[
          {
            label: "build",
            stdout: stream("build.stdout", null, {
              path: null,
              error: "reference_outside_run_directory",
            }),
            stderr: stream("build.stderr", "boom: missing input\n"),
          },
        ]}
      />,
    );
    expect(screen.getByText("stdout unavailable · stderr captured")).toBeTruthy();
    expect(screen.getByText("boom: missing input")).toBeTruthy();
    expect(screen.getByText("step exited with code 3")).toBeTruthy();
    expect(
      screen.getByText("stdout unavailable: reference_outside_run_directory"),
    ).toBeTruthy();
  });

  it("spells truncation with the full path to the complete file", () => {
    render(
      <EvidenceView
        run={run()}
        recipe={recipe()}
        evidence={[
          {
            label: "build",
            stdout: stream("build.stdout", "head bytes…", { error: "content_truncated" }),
            stderr: stream("build.stderr", ""),
          },
        ]}
      />,
    );
    expect(screen.getByText("stdout (truncated to the first 512 KiB)")).toBeTruthy();
    expect(
      screen.getByText("Full output at /ws/.mentu/runs/run_fixture_1/build.stdout"),
    ).toBeTruthy();
  });

  it("surfaces an evidence-load failure without hiding the run record", () => {
    render(
      <EvidenceView run={run()} recipe={recipe()} evidence={null} evidenceError="boom" />,
    );
    expect(screen.getByText("Evidence content unavailable: boom")).toBeTruthy();
    // The run record still renders from its own projection.
    expect(screen.getByText("run_fixture_1")).toBeTruthy();
  });
});

describe("EvidenceView before evidence arrives", () => {
  it("shows a loading row per step while the daemon reads the files", () => {
    render(
      <EvidenceView run={run()} recipe={recipe()} evidence={null} evidenceLoading />,
    );
    expect(screen.getByText("Loading stdout and stderr…")).toBeTruthy();
    // Path presence is the honest fallback for the availability line.
    expect(screen.getByText("stdout captured · stderr captured")).toBeTruthy();
  });

  it("marks streams unavailable when the record carries no paths", () => {
    const bare = run();
    bare.steps[0]!.outputPath = null;
    bare.steps[0]!.errorPath = null;
    render(<EvidenceView run={bare} recipe={recipe()} evidence={null} />);
    expect(screen.getByText("stdout unavailable · stderr unavailable")).toBeTruthy();
  });
});
