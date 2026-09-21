// The terminal restart handler's resume input is the SAME projection the
// pane's exit overlay rendered (`projectTerminalRestartResume`), so the
// button the user clicked and the launch App performs cannot disagree: an
// exited harness session whose overlay offered "Resume session" must reach
// `harness.start` with `resume`/`resumeSessionId`, and every other restart
// keeps the plain relaunch.
//
// jsdom cannot mount the whole App (bridges, polls, xterm), so the wiring is
// pinned at the source level, like `TerminalPane.test.ts` does for the grid
// ownership rule. The policy itself is covered by
// `features/terminal/terminal-restart-launch.test.ts`, and the overlay's copy
// by `features/terminal/terminal-process-exit.test.tsx`.
import { describe, expect, it } from "vitest";
import fs from "node:fs";

const appSource = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App terminal restart resume wiring", () => {
  it("imports the pane's own resume projection", () => {
    expect(appSource).toMatch(
      /import\s*\{[\s\S]*?projectTerminalRestartResume[\s\S]*?\}\s*from\s*"\.\/features\/terminal\/terminal-restart-launch";/,
    );
  });

  it("computes the restart's resume input from that projection", () => {
    expect(appSource).toMatch(
      /const resumeInput = projectTerminalRestartResume\(prior\);/,
    );
  });

  it("spreads the resume input into every harness launch branch", () => {
    // Both the remembered-launch retry and the fresh harness launch carry it;
    // dropping either one silently relaunches a conversation instead.
    expect(appSource.match(/\.\.\.resumeInput,/g) ?? []).toHaveLength(2);
  });

  it("no longer resumes only a sleeping session", () => {
    // The old shape passed the resume flag for `unverifiable` sessions alone,
    // so a positively exited pane's "Restart" always opened a new
    // conversation -- the defect this wiring replaces.
    expect(appSource).not.toContain(
      "const sleeping = prior ? sleepingSessionFor(prior) : null;",
    );
  });
});
