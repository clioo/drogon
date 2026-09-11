// MIT Copyright (c) 2026 Lovecast Inc.
//
// Regression: the zod schema drifted from Rust's `ResponsibilityRunInvocation`
// (crates/drogon-core/src/bots/records.rs). Rust stamps `reactive` when the
// delegation drain releases a monitor-fired run, the desktop only accepted
// `scheduled | manual`, and native-client parses hard — so ONE reactive row
// blanked the entire Bots page with "The service response does not match the
// expected contract". Every variant Rust can serialise must parse here.
import { describe, expect, it } from "vitest";
import { botSnapshotResultSchema } from "./bot-validation";

const RUST_INVOCATIONS = ["scheduled", "manual", "reactive"] as const;

function historyPayload(invocation: string | null) {
  return {
    hostId: "host-1",
    workspaceId: "ws-1",
    bots: [],
    history: [
      {
        run: {
          id: "run-1",
          botId: "bot-1",
          responsibilityId: "resp-1",
          automationId: null,
          automationRunId: null,
          startedAt: 1,
          endedAt: null,
          recipe: null,
          hostObservation: null,
          invocation,
        },
        responsibilityName: null,
        automationName: null,
        automationRunNumber: null,
        automationRunStatus: null,
      },
    ],
  };
}

describe("responsibility run invocation", () => {
  it.each(RUST_INVOCATIONS)(
    "accepts %s, which Rust can serialise",
    (invocation) => {
      const parsed = botSnapshotResultSchema.safeParse(
        historyPayload(invocation),
      );
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    },
  );

  it("accepts a null invocation", () => {
    expect(botSnapshotResultSchema.safeParse(historyPayload(null)).success).toBe(
      true,
    );
  });

  it("still rejects a value Rust cannot produce", () => {
    expect(
      botSnapshotResultSchema.safeParse(historyPayload("telepathic")).success,
    ).toBe(false);
  });
});
