import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ResponsibilityFormCard } from "./BotsPageForms";
import type { ResponsibilityFormValues } from "./bots-page-model";

function render(
  form: ResponsibilityFormValues,
  busy = false,
): string {
  return renderToStaticMarkup(
    createElement(ResponsibilityFormCard, {
      form,
      busy,
      onChange: () => {},
      onCancel: () => {},
      onSubmit: () => {},
    }),
  );
}

describe("ResponsibilityFormCard", () => {
  it("renders name, cron and prompt fields with the scheduler copy", () => {
    const markup = render({ name: "", cron: "* * * * *", prompt: "" });
    expect(markup).toContain('aria-label="Add responsibility"');
    expect(markup).toContain("Name");
    expect(markup).toContain("Cron expression (UTC)");
    expect(markup).toContain("Standard 5-field cron in UTC");
    expect(markup).toContain("Prompt");
    expect(markup).toContain("Save responsibility");
    expect(markup).toContain("Cancel");
  });

  it("disables save until name, prompt and a previewable cron are present", () => {
    const empty = render({ name: "", cron: "* * * * *", prompt: "" });
    const saveStart = empty.lastIndexOf("<button", empty.indexOf("Save responsibility"));
    expect(empty.slice(saveStart, empty.indexOf(">", saveStart))).toContain(
      'disabled=""',
    );
    const badCron = render({ name: "Duty", cron: "not a cron", prompt: "Do it." });
    expect(badCron).toContain(
      "preview unavailable for this expression",
    );
    const badSaveStart = badCron.lastIndexOf(
      "<button",
      badCron.indexOf("Save responsibility"),
    );
    expect(
      badCron.slice(badSaveStart, badCron.indexOf(">", badSaveStart)),
    ).toContain('disabled=""');
  });

  it("enables save and previews next fires for a valid schedule", () => {
    const markup = render({
      name: "Nightly review",
      cron: "* * * * *",
      prompt: "Review incoming work.",
    });
    expect(markup).toContain("Next runs:");
    const saveStart = markup.lastIndexOf(
      "<button",
      markup.indexOf("Save responsibility"),
    );
    expect(
      markup.slice(saveStart, markup.indexOf(">", saveStart)),
    ).not.toContain('disabled=""');
  });

  it("shows the busy state while saving", () => {
    const markup = render(
      { name: "Duty", cron: "* * * * *", prompt: "Do it." },
      true,
    );
    expect(markup).toContain("Saving…");
  });
});
