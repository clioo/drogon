import { describe, expect, test } from "vitest";
import {
  COMMAND_DEFS,
  commandTokenScore,
  rankCommands,
  type CommandContext,
} from "./command-registry";

const onlineWorkspace: CommandContext = {
  connected: true,
  busy: false,
  hasWorkspace: true,
  filesAvailable: true,
  botsAvailable: true,
  harnessAvailable: true,
  worktreesAvailable: true,
  canCreateWorktree: true,
};

describe("commandTokenScore", () => {
  test("exact token beats prefix beats substring", () => {
    const exact = commandTokenScore(["terminal"], ["New terminal"]);
    const prefix = commandTokenScore(["term"], ["New terminal"]);
    const substring = commandTokenScore(["erm"], ["New terminal"]);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(0);
  });

  test("multi-word queries must cover most of what was typed", () => {
    expect(commandTokenScore(["linear", "triage"], ["Linear"])).toBe(0);
    expect(commandTokenScore(["new", "terminal"], ["New terminal"])).toBeGreaterThan(0);
  });

  test("filler words do not count against coverage", () => {
    expect(
      commandTokenScore(["open", "files"], ["Open Files panel"]),
    ).toBeGreaterThan(0);
  });

  test("no shared token scores zero", () => {
    expect(commandTokenScore(["xyzzy"], ["New terminal"])).toBe(0);
  });
});

describe("rankCommands", () => {
  test("empty query returns every command in definition order", () => {
    const ranked = rankCommands({
      defs: COMMAND_DEFS,
      query: "",
      context: onlineWorkspace,
    });
    expect(ranked).toHaveLength(COMMAND_DEFS.length);
    expect(ranked.map((row) => row.def.id)).toEqual(
      COMMAND_DEFS.map((def) => def.id),
    );
  });

  test("query ranks the exact command first", () => {
    const ranked = rankCommands({
      defs: COMMAND_DEFS,
      query: "theme dark",
      context: onlineWorkspace,
    });
    expect(ranked[0].def.id).toBe("theme.dark");
  });

  test("disabled commands are kept with their reason, never dropped", () => {
    const ranked = rankCommands({
      defs: COMMAND_DEFS,
      query: "",
      context: { ...onlineWorkspace, filesAvailable: false },
    });
    const files = ranked.find((row) => row.def.id === "panel.files");
    expect(files?.enabled).toBe(false);
    expect(files?.disabledReason).toBe(
      "Files unavailable: service does not advertise files.v1",
    );
  });

  test("offline context disables service commands with a connection reason", () => {
    const ranked = rankCommands({
      defs: COMMAND_DEFS,
      query: "",
      context: { ...onlineWorkspace, connected: false },
    });
    const terminal = ranked.find((row) => row.def.id === "terminal.new");
    expect(terminal?.enabled).toBe(false);
    expect(terminal?.disabledReason).toMatch(/Service unavailable/);
    // Local-only commands stay enabled offline.
    expect(
      ranked.find((row) => row.def.id === "settings.open")?.enabled,
    ).toBe(true);
  });

  test("missing harness capability disables launch with its reason", () => {
    const ranked = rankCommands({
      defs: COMMAND_DEFS,
      query: "",
      context: { ...onlineWorkspace, harnessAvailable: false },
    });
    const launch = ranked.find((row) => row.def.id === "harness.launch");
    expect(launch?.enabled).toBe(false);
    expect(launch?.disabledReason).toBe(
      "Harness launch is not advertised by the service",
    );
  });

  test("new worktree is enabled only with a capability and a git target", () => {
    const base = rankCommands({
      defs: COMMAND_DEFS,
      query: "",
      context: onlineWorkspace,
    });
    expect(base.find((row) => row.def.id === "worktree.new")?.enabled).toBe(
      true,
    );
    const noCapability = rankCommands({
      defs: COMMAND_DEFS,
      query: "",
      context: { ...onlineWorkspace, worktreesAvailable: false },
    });
    const capped = noCapability.find((row) => row.def.id === "worktree.new");
    expect(capped?.enabled).toBe(false);
    expect(capped?.disabledReason).toBe(
      "Worktrees unavailable: service does not advertise worktree.v1",
    );
    const noTarget = rankCommands({
      defs: COMMAND_DEFS,
      query: "",
      context: { ...onlineWorkspace, canCreateWorktree: false },
    });
    const untargeted = noTarget.find((row) => row.def.id === "worktree.new");
    expect(untargeted?.enabled).toBe(false);
    expect(untargeted?.disabledReason).toBe(
      "No git project selected: add a repository project first",
    );
  });

  test("recent commands lead on an empty query, most recent first", () => {
    const ranked = rankCommands({
      defs: COMMAND_DEFS,
      query: "   ",
      context: onlineWorkspace,
      recentIds: ["theme.dark", "terminal.new"],
    });
    expect(ranked[0].def.id).toBe("theme.dark");
    expect(ranked[1].def.id).toBe("terminal.new");
  });

  test("every def carries an id, label and at least one keyword", () => {
    for (const def of COMMAND_DEFS) {
      expect(def.id.length).toBeGreaterThan(0);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.keywords.length).toBeGreaterThan(0);
    }
  });
});
