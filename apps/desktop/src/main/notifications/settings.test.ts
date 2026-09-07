import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NotificationsSettings } from "./settings";

const tempFile = (): string =>
  path.join(mkdtempSync(path.join(tmpdir(), "drogon-notif-")), "notifications.json");

describe("NotificationsSettings", () => {
  it("defaults on when no file exists", () => {
    expect(new NotificationsSettings(tempFile()).getEnabled()).toBe(true);
  });

  it("defaults on for corrupt content, never toward silence", () => {
    const file = tempFile();
    writeFileSync(file, "not json{{{", "utf8");
    expect(new NotificationsSettings(file).getEnabled()).toBe(true);
  });

  it("persists an explicit false across instances", () => {
    const file = tempFile();
    expect(new NotificationsSettings(file).setEnabled(false)).toBe(false);
    expect(new NotificationsSettings(file).getEnabled()).toBe(false);
  });

  it("round-trips back to true", () => {
    const file = tempFile();
    const settings = new NotificationsSettings(file);
    settings.setEnabled(false);
    expect(settings.setEnabled(true)).toBe(true);
    expect(new NotificationsSettings(file).getEnabled()).toBe(true);
  });

  it("works memory-only without a file", () => {
    const settings = new NotificationsSettings(null);
    expect(settings.getEnabled()).toBe(true);
    settings.setEnabled(false);
    expect(settings.getEnabled()).toBe(false);
  });
});
