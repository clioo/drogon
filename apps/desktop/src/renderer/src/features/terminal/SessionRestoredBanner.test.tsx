// MIT Copyright (c) 2026 Lovecast Inc. Tests for the ported
// SessionRestoredBanner.tsx (rendered with renderToString: no DOM harness
// exists in this repo). The copy is the reference's, verbatim, and the
// `resume-unavailable` reason is the whole point: a requested resume that the
// daemon declined must say so instead of passing a fresh conversation off as
// the older one.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  SESSION_RESTORED_BANNER_TEXT,
  SESSION_RESUME_UNAVAILABLE_BANNER_TEXT,
  SessionRestoredBanner,
} from "./SessionRestoredBanner";

function render(reason?: "restored" | "resume-unavailable"): string {
  return renderToString(
    createElement(SessionRestoredBanner, {
      visible: true,
      ...(reason ? { reason } : {}),
    }),
  );
}

describe("SessionRestoredBanner", () => {
  it("takes the reference's copy and class verbatim", () => {
    expect(SESSION_RESTORED_BANNER_TEXT).toBe("--- session restored ---");
    expect(SESSION_RESUME_UNAVAILABLE_BANNER_TEXT).toBe(
      "--- previous session unavailable, started fresh ---",
    );
    const html = render();
    expect(html).toContain('class="session-restored-banner"');
    expect(html).toContain(SESSION_RESTORED_BANNER_TEXT);
  });

  it("renders nothing when not visible", () => {
    expect(
      renderToString(
        createElement(SessionRestoredBanner, {
          visible: false,
          reason: "resume-unavailable",
        }),
      ),
    ).toBe("");
  });

  it("says a declined resume started fresh", () => {
    const html = render("resume-unavailable");
    expect(html).toContain(SESSION_RESUME_UNAVAILABLE_BANNER_TEXT);
    expect(html).not.toContain(SESSION_RESTORED_BANNER_TEXT);
    // The reason is addressable for oracles and for dismissal tests.
    expect(html).toContain('data-session-restored-banner="resume-unavailable"');
  });
});
