// The create form on an imported board reads its choices through
// `work.create_options`; the bridge op and its reply schema are the contract
// the dialog relies on.

import { describe, expect, it } from "vitest";
import { WORK_OPS, workCreateOptionsSchema } from "./work-contract";

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
  it("accepts an interrupted delivery as unverifiable with its stable event identity", () => {
    const reply = { sends: [{ id: 1, columnId: "review", ticketId: "ticket", ticketKey: "DRG-1", trigger: "schedule", message: "Check DRG-1", at: 1, eventId: "schedule:review:1:ticket", results: [{ sessionId: null, action: "unverifiable", error: "Interrupted; inspect the session before sending again" }] }] };
    expect(WORK_OPS.sends.schema.parse(reply)).toEqual(reply);
  });

});
