import { describe, expect, it } from "vitest";
import {
  BOT_HARNESS_IDS,
  PRESETS,
  botReopenNotice,
  applyBotCharacterPreset,
  botInitials,
  botStatusPill,
  buildBotCreateBody,
  buildBotRunHarness,
  collapsedRowNote,
  countActiveBots,
  emptyBotCreateForm,
  emptyResponsibilityForm,
  filterBots,
  isBotCreateFormReady,
  isResponsibilityFormReady,
  monitorHealthPill,
  monitorLastCheck,
  monitorSourceLabel,
  monitorTitle,
  monitorTriggerLabel,
} from "./bots-page-model";

describe("bots-page-model", () => {
  it("defaults to a ready-to-submit form (preset carries a display name)", () => {
    const form = emptyBotCreateForm();
    expect(isBotCreateFormReady(form)).toBe(true);
    expect(BOT_HARNESS_IDS).toContain(form.harnessId);
  });

  it("is not ready when preset is none and no name is supplied", () => {
    expect(
      isBotCreateFormReady({
        ...emptyBotCreateForm(),
        preset: "none",
        displayName: "",
      }),
    ).toBe(false);
  });

  it("builds a born-empty body with trimmed memories and a null model when blank", () => {
    const body = buildBotCreateBody({
      preset: "arya",
      displayName: "",
      handle: "  watcher  ",
      title: "",
      harnessId: "claude",
      model: "",
      instructions: "Guard the realm.",
      memories: "One fact\n\n  Another fact  \n",
    });
    expect(body).toEqual({
      characterPreset: "arya",
      displayIdentity: {
        displayName: "Arya Stark",
        handle: "watcher",
        title: null,
      },
      harnessPolicy: { defaultHarness: "claude", explicitModel: null },
      instructions: "Guard the realm.",
      memories: ["One fact", "Another fact"],
    });
  });

  it("carries the Pi provider/model string into explicitModel (R16-S, fork controller parity)", () => {
    const body = buildBotCreateBody({
      ...emptyBotCreateForm(),
      harnessId: "pi",
      model: "  dgx-spark/qwen3.8-flash-next-nvidia-nvfp4  ",
    });
    expect(body.harnessPolicy).toEqual({
      defaultHarness: "pi",
      explicitModel: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
    });
    expect(
      buildBotCreateBody({ ...emptyBotCreateForm(), model: "   " })
        .harnessPolicy.explicitModel,
    ).toBeNull();
  });

  it("splits a provider/model string into unattended bot.run overrides for every harness", () => {
    expect(
      buildBotRunHarness("pi", "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4"),
    ).toEqual({
      harnessId: "pi",
      provider: "dgx-spark",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
      permissionMode: "unattended",
    });
    // Bare model id (no slash): Pi accepts it as --model.
    expect(buildBotRunHarness("pi", "qwen3.8-flash")).toEqual({
      harnessId: "pi",
      model: "qwen3.8-flash",
      permissionMode: "unattended",
    });
    // Null/blank: no model overrides, but Pi runs still go unattended.
    expect(buildBotRunHarness("pi", null)).toEqual({
      harnessId: "pi",
      permissionMode: "unattended",
    });
    for (const harnessId of ["claude", "opencode", "antigravity"] as const) {
      expect(buildBotRunHarness(harnessId, null)).toEqual({
        harnessId,
        permissionMode: "unattended",
      });
    }
    expect(buildBotRunHarness("claude", "sonnet")).toEqual({
      harnessId: "claude",
      model: "sonnet",
      permissionMode: "unattended",
    });
  });

  it("never includes responsibilities or a session in the create body (native's born-empty invariant)", () => {
    const body = buildBotCreateBody(emptyBotCreateForm());
    expect(body).not.toHaveProperty("responsibilities");
    expect(body).not.toHaveProperty("currentSession");
  });
});

describe("character presets (source PRESETS parity)", () => {
  it("lists every character once, starting with the default preset", () => {
    expect(PRESETS.length).toBeGreaterThan(6);
    expect(PRESETS[0]).toEqual({ value: "arya", label: "Arya Stark" });
    expect(new Set(PRESETS.map((entry) => entry.value)).size).toBe(
      PRESETS.length,
    );
  });

  it("applies the preset without touching the user's purpose", () => {
    const form = {
      ...emptyBotCreateForm(),
      instructions: "Guard the realm.",
    };
    expect(applyBotCharacterPreset(form, "tyrion")).toEqual({
      preset: "tyrion",
      instructions: "Guard the realm.",
    });
  });
});

describe("responsibility form model", () => {
  const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);

  it("defaults to the every-minute schedule the Automations page uses", () => {
    expect(emptyResponsibilityForm()).toEqual({
      name: "",
      cron: "* * * * *",
      prompt: "",
    });
  });

  it("is ready only with a name, a prompt and a previewable cron", () => {
    expect(
      isResponsibilityFormReady(
        { name: "Duty", cron: "* * * * *", prompt: "Do it." },
        NOW,
      ),
    ).toBe(true);
    expect(
      isResponsibilityFormReady(
        { name: "  ", cron: "* * * * *", prompt: "Do it." },
        NOW,
      ),
    ).toBe(false);
    expect(
      isResponsibilityFormReady(
        { name: "Duty", cron: "* * * * *", prompt: "  " },
        NOW,
      ),
    ).toBe(false);
    expect(
      isResponsibilityFormReady(
        { name: "Duty", cron: "FREQ=DAILY", prompt: "Do it." },
        NOW,
      ),
    ).toBe(false);
  });

  it("accepts yearly and leap-day schedules (#236: rare crons stay saveable)", () => {
    for (const cron of ["0 0 1 1 *", "0 0 29 2 *"]) {
      expect(
        isResponsibilityFormReady(
          { name: "Duty", cron, prompt: "Do it." },
          NOW,
        ),
      ).toBe(true);
    }
    // A valid-shaped cron that never fires stays unsaveable (the daemon's
    // croner check rejects it too).
    expect(
      isResponsibilityFormReady(
        { name: "Duty", cron: "0 0 31 2 *", prompt: "Do it." },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("owner-design page model (task_197f6a7eb370)", () => {
  const bot = (overrides = {}) =>
    ({
      id: "bot-1",
      characterPreset: "none",
      displayIdentity: { displayName: "Watcher", handle: null, title: null },
      harnessPolicy: { defaultHarness: "pi", explicitModel: null },
      instructions: "",
      memories: [],
      responsibilities: [],
      currentSession: null,
      createdAt: 1,
      updatedAt: 1,
      ...overrides,
    }) as never;

  const configuredBot = () =>
    bot({
      responsibilities: [
        {
          id: "resp-1",
          name: "Nightly review",
          instructions: "",
          kind: "scheduled",
          trigger: { kind: "scheduled", automationId: "auto-1" },
          enabled: true,
          recipe: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

  it("derives initials from the first letters of the first two words", () => {
    expect(botInitials("Arya Stark")).toBe("AS");
    expect(botInitials("arya")).toBe("A");
    expect(botInitials("  mad   dog ")).toBe("MD");
    expect(botInitials("Åsa Bergström")).toBe("ÅB");
    expect(botInitials("")).toBe("?");
  });

  it("renders Idle only for a bot with nothing configured at all", () => {
    expect(
      botStatusPill({ bot: bot(), monitorCount: 0 }).label,
    ).toBe("Idle");
    expect(
      botStatusPill({ bot: bot(), monitorCount: 0 }).tone,
    ).toBe("idle");
    // Any real configuration flips the pill to the design's green state.
    expect(
      botStatusPill({ bot: configuredBot(), monitorCount: 0 }).label,
    ).toBe("Ready for a purpose");
    expect(
      botStatusPill({ bot: bot(), monitorCount: 1 }).label,
    ).toBe("Ready for a purpose");
    expect(
      botStatusPill({
        bot: bot({
          currentSession: {
            sessionId: "s",
            harness: "pi",
            model: null,
            startedAt: 1,
            rotatedAt: null,
          },
        }),
        monitorCount: 0,
      }).label,
    ).toBe("Ready for a purpose");
  });

  it("claims In session only from an observed live verdict, never from storage", () => {
    const pill = botStatusPill({
      bot: configuredBot(),
      monitorCount: 0,
      observedLiveness: "live",
    });
    expect(pill).toEqual({ label: "In session", tone: "live" });
    // Loss of contact is never exit, and never a live claim either.
    expect(
      botStatusPill({
        bot: configuredBot(),
        monitorCount: 0,
        observedLiveness: "unverifiable",
      }).label,
    ).not.toBe("In session");
    expect(
      botStatusPill({
        bot: bot(),
        monitorCount: 0,
        observedLiveness: "exited",
      }).label,
    ).toBe("Idle");
  });

  it("counts active bots as everything beyond the muted Idle state", () => {
    const monitors = { "bot-2": [{}] } as unknown as Record<string, never[]>;
    const count = countActiveBots(
      [bot({ id: "bot-1" }), bot({ id: "bot-2" }), configuredBot()],
      monitors,
    );
    expect(count).toBe(2); // bot-2 (a monitor) + bot-3 (configured); bot-1 is Idle.
  });

  it("filters bots over real fields only, case-insensitively", () => {
    const list = [
      bot({
        id: "a",
        displayIdentity: { displayName: "Arya", handle: "arya", title: null },
      }),
      bot({ id: "b", instructions: "Guard the northern border" }),
    ];
    expect(filterBots(list, "ARYA").map((b) => b.id)).toEqual(["a"]);
    expect(filterBots(list, "northern").map((b) => b.id)).toEqual(["b"]);
    expect(filterBots(list, "")).toHaveLength(2);
    expect(filterBots(list, "   ")).toHaveLength(2);
    expect(filterBots(list, "zzz")).toEqual([]);
  });

  it("maps the daemon's durable health verdicts to chips", () => {
    expect(monitorHealthPill("healthy")).toEqual({
      label: "Watching",
      tone: "watching",
    });
    expect(monitorHealthPill("degraded").label).toBe("Degraded");
    expect(monitorHealthPill("failing").label).toBe("Failing");
    expect(monitorHealthPill("needs_approval").label).toBe("Needs approval");
    expect(monitorHealthPill("disabled").label).toBe("Paused");
    expect(monitorHealthPill("unsupported")).toEqual({
      label: "Not runnable",
      tone: "failing",
    });
  });

  it("titles monitors from the watched resource, never an invented name", () => {
    expect(monitorTitle({ resource: "notes/status.md" } as never)).toBe(
      "notes/status.md",
    );
    expect(
      monitorTitle({ scriptPath: "scripts/check.sh" } as never),
    ).toBe("scripts/check.sh");
    // A kind with neither (and the summary absent) shows the rule kind.
    expect(monitorTitle({ ruleKind: "http_poll.v1" } as never)).toBe(
      "http_poll.v1",
    );
  });

  it("titles a github_pr.v1 watch with the repository it watches, never the rule kind", () => {
    expect(
      monitorTitle({
        ruleKind: "github_pr.v1",
        repo: "clioo/drogon",
      } as never),
    ).toBe("clioo/drogon");
    // A record genuinely missing its repo stays fail-closed.
    expect(
      monitorTitle({ ruleKind: "github_pr.v1", repo: "" } as never),
    ).toBe("github_pr.v1");
  });

  it("renders the SOURCE cell per kind: repo + case, path, script, sealed URL", () => {
    expect(
      monitorSourceLabel({
        ruleKind: "github_pr.v1",
        repo: "clioo/drogon",
        filter: "assigned",
        login: "clioo",
      } as never),
    ).toBe("clioo/drogon · case: assigned (clioo)");
    expect(
      monitorSourceLabel({
        ruleKind: "github_pr.v1",
        repo: "clioo/drogon",
        filter: "opened",
      } as never),
    ).toBe("clioo/drogon · case: opened");
    expect(
      monitorSourceLabel({ ruleKind: "local_file_digest.v1", resource: "notes/a.md" } as never),
    ).toBe("notes/a.md");
    expect(
      monitorSourceLabel({ ruleKind: "script_command.v1", scriptPath: "s.sh" } as never),
    ).toBe("s.sh");
    // The http poll's URL is sealed daemon-side: honest words, never the
    // bare hash presented as a URL, never the bare rule kind.
    const poll = monitorSourceLabel({
      ruleKind: "http_poll.v1",
      urlHash: "cd3f9a11cd3f9a11cd3f9a11cd3f9a11",
    } as never);
    expect(poll).toContain("URL sealed by the daemon");
    expect(poll).toContain("cd3f9a11");
    expect(poll).not.toContain("http_poll.v1");
    // Unknown kinds stay the raw token (fail-closed).
    expect(
      monitorSourceLabel({ ruleKind: "future_kind.v9" } as never),
    ).toBe("future_kind.v9");
  });

  it("renders LAST CHECK only from a real check row, with honest age", () => {
    const now = 1_000_000_000;
    expect(monitorLastCheck({ lastCheckAtMs: null } as never, now)).toBeNull();
    const healthy = monitorLastCheck(
      { health: "healthy", lastCheckAtMs: now - 8 * 60_000 } as never,
      now,
    );
    expect(healthy).toEqual({ healthLabel: "Healthy", ageLabel: "8m ago" });
    expect(
      monitorLastCheck(
        { health: "failing", lastCheckAtMs: now - 2 * 3_600_000 } as never,
        now,
      ),
    ).toEqual({ healthLabel: "Failing", ageLabel: "2h ago" });
    // A needs-approval monitor with an old check still shows the row age
    // under the honest "Checked" word.
    expect(
      monitorLastCheck(
        { health: "needs_approval", lastCheckAtMs: now - 30_000 } as never,
        now,
      )?.healthLabel,
    ).toBe("Checked");
    expect(
      monitorLastCheck(
        { health: "unsupported", lastCheckAtMs: now - 30_000 } as never,
        now,
      )?.healthLabel,
    ).toBe("Not runnable");
  });

  it("labels monitor triggers Manual or with the real cron", () => {
    expect(monitorTriggerLabel({ kind: "manual" })).toBe("Manual");
    expect(
      monitorTriggerLabel({ kind: "scheduled", cron: "*/5 * * * *" }),
    ).toBe("*/5 * * * *");
  });

  it("claims the standby workspace note only when a home exists", () => {
    expect(collapsedRowNote({} as never)).toBe(
      "No automations or monitors yet",
    );
    expect(collapsedRowNote({ home: { path: "/x" } } as never)).toBe(
      "No automations or monitors yet · Standby workspace initialized",
    );
  });

  it("says nothing about a reopen that names the recorded conversation", () => {
    expect(
      botReopenNotice({ harnessId: "claude", resumeByIdentity: "bot-record" }),
    ).toBeNull();
    expect(
      botReopenNotice({ harnessId: "claude", resumeByIdentity: "session" }),
    ).toBeNull();
  });

  it("names what a reopen without a recorded conversation will actually do", () => {
    // Still a real continuation through the CLI's own entrypoint -- but not
    // the recorded session id, and the page says which one it asked for
    // rather than implying an exact restore.
    expect(botReopenNotice({ harnessId: "claude", resumeByIdentity: null })).toBe(
      "claude will reopen its most recent conversation in this Bot's home; no exact session id was recorded for it.",
    );
  });

  it("says a NEW session opened for a harness that cannot resume", () => {
    expect(
      botReopenNotice({ harnessId: "aider", resumeByIdentity: "bot-record" }),
    ).toBe(
      "aider cannot reopen its previous conversation; a NEW session was opened instead.",
    );
  });
});
