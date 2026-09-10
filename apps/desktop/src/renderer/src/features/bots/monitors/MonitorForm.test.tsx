/* C10 monitor form: editor controls render and gate on valid input. */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MonitorForm } from "./MonitorForm";
import { emptyMonitorForm } from "./monitor-model";

describe("MonitorForm", () => {
  it("renders the editor with scope copy and disabled submit when empty", () => {
    const markup = renderToStaticMarkup(
      createElement(MonitorForm, {
        form: emptyMonitorForm(),
        busy: false,
        scopeLabel: "Host h · project p.",
        onChange: () => {},
        onCancel: () => {},
        onSubmit: () => {},
      }),
    );
    expect(markup).toContain('aria-label="Monitor editor"');
    expect(markup).toContain("Host h");
    expect(markup).toContain('aria-label="Project file"');
    expect(markup).toContain("disabled");
  });

  it("enables submit for a scoped relative file", () => {
    const markup = renderToStaticMarkup(
      createElement(MonitorForm, {
        form: { ...emptyMonitorForm(), name: "Watcher", resource: "notes/status.md" },
        busy: false,
        scopeLabel: "Host h · project p.",
        onChange: () => {},
        onCancel: () => {},
        onSubmit: () => {},
      }),
    );
    expect(markup).toContain("Save monitor");
  });

  it("shows the cron field for scheduled triggers", () => {
    const markup = renderToStaticMarkup(
      createElement(MonitorForm, {
        form: {
          ...emptyMonitorForm(),
          name: "Watcher",
          resource: "notes/status.md",
          trigger: { kind: "scheduled", cron: "* * * * *" },
        },
        busy: false,
        scopeLabel: "Host h · project p.",
        onChange: () => {},
        onCancel: () => {},
        onSubmit: () => {},
      }),
    );
    expect(markup).toContain('aria-label="Cron expression"');
  });
});
