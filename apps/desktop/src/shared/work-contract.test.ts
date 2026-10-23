// The create form on an imported board reads its choices through
// `work.create_options`; the bridge op and its reply schema are the contract
// the dialog relies on.

import { describe, expect, it } from "vitest";
import { WORK_OPS, workCreateOptionsSchema } from "./work-contract";

describe("work delivery contract", () => {
  // Issue #679: a delivery the daemon could not complete is reported as an
  // action of its own. A schema that rejected it would throw away the whole
  // send payload, and the page would show nothing at all.
  it("accepts a failed and an uncertain delivery alongside the ones that landed", () => {
    const reply = {
      columnId: "review",
      sends: [
        {
          ticketId: "t1",
          ticketKey: "DRG-1",
          columnId: "review",
          trigger: "manual",
          message: "Review DRG-1",
          at: 1,
          results: [
            { sessionId: "live-1", action: "sent" },
            { sessionId: "live-2", action: "failed", error: "pty write failed: Broken pipe" },
            { sessionId: null, action: "unverifiable", error: "Interrupted; inspect the session before sending again" },
          ],
        },
      ],
    };
    expect(WORK_OPS.columnSend.schema.parse(reply)).toEqual(reply);
  });

  it("refuses an action the page has no notice for", () => {
    const parse = (action: string) =>
      WORK_OPS.columnSend.schema.safeParse({
        columnId: "review",
        sends: [
          {
            ticketId: "t1",
            ticketKey: "DRG-1",
            columnId: "review",
            trigger: "manual",
            message: "m",
            at: 1,
            results: [{ sessionId: null, action }],
          },
        ],
      }).success;
    expect(parse("failed")).toBe(true);
    expect(parse("half-sent")).toBe(false);
  });
});

describe("work.create_options contract", () => {
  it("is a bridge op whose reply is validated by its schema", () => {
    expect(WORK_OPS.createOptions.method).toBe("work.create_options");
    expect(WORK_OPS.createOptions.schema).toBe(workCreateOptionsSchema);
    const reply = {
      provider: "jira",
      boardId: "board-1",
      issueTypes: [
        { id: "10001", name: "Task" },
        { id: "10002", name: "Bug" },
      ],
      repos: [],
    };
    expect(WORK_OPS.createOptions.schema.parse(reply)).toEqual(reply);
  });

  it("refuses a reply the form could not render", () => {
    const parse = (value: unknown) => workCreateOptionsSchema.safeParse(value).success;
    expect(parse({ provider: "jira", boardId: "b", issueTypes: [{ id: 7 }], repos: [] })).toBe(false);
    expect(parse({ provider: "github", boardId: "b", issueTypes: [], repos: "owner/repo" })).toBe(false);
    expect(parse({ provider: "linear", issueTypes: [], repos: [] })).toBe(false);
  });
});
