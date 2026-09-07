import { describe, expect, test } from "vitest";
import {
  normalizeBaseRef,
  validateProjectName,
  validateProjectPath,
  validateWorktreeName,
} from "./project-forms";

describe("validateProjectPath", () => {
  test("blank paths are rejected before any RPC", () => {
    expect(validateProjectPath("")).not.toBeNull();
    expect(validateProjectPath("   ")).not.toBeNull();
  });

  test("NUL is rejected; anything else is worth sending", () => {
    expect(validateProjectPath("/repo\0x")).not.toBeNull();
    expect(validateProjectPath("/tmp/repo")).toBeNull();
    expect(validateProjectPath("~/work")).toBeNull();
  });
});

describe("validateProjectName", () => {
  test("blank means derived-from-path, not an error", () => {
    expect(validateProjectName("")).toBeNull();
    expect(validateProjectName("  ")).toBeNull();
    expect(validateProjectName("my repo")).toBeNull();
  });

  test("NUL and overlong names are rejected", () => {
    expect(validateProjectName("a\0b")).not.toBeNull();
    expect(validateProjectName("x".repeat(257))).not.toBeNull();
  });
});

describe("validateWorktreeName", () => {
  test("blank names are rejected", () => {
    expect(validateWorktreeName("")).not.toBeNull();
    expect(validateWorktreeName("  ")).not.toBeNull();
  });

  test("plain branch names pass", () => {
    expect(validateWorktreeName("demo-a")).toBeNull();
    expect(validateWorktreeName("feat/x")).toBeNull();
  });

  test("daemon-rule subset is caught client-side", () => {
    expect(validateWorktreeName("has space")).not.toBeNull();
    expect(validateWorktreeName("a..b")).not.toBeNull();
    expect(validateWorktreeName("/lead")).not.toBeNull();
    expect(validateWorktreeName("-flag")).not.toBeNull();
    expect(validateWorktreeName("@")).not.toBeNull();
  });
});

describe("normalizeBaseRef", () => {
  test("blank means daemon default", () => {
    expect(normalizeBaseRef("")).toBeUndefined();
    expect(normalizeBaseRef("   ")).toBeUndefined();
  });

  test("non-blank refs are trimmed, never rejected", () => {
    expect(normalizeBaseRef("  main  ")).toBe("main");
    expect(normalizeBaseRef("origin/main")).toBe("origin/main");
  });
});
