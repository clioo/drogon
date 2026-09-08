import { describe, expect, test } from "vitest";
import {
  createUntitledMarkdown,
  untitledMarkdownName,
} from "./untitled-markdown";

describe("untitledMarkdownName", () => {
  test("follows the fork's untitled.md, untitled-2.md sequence", () => {
    expect(untitledMarkdownName(1)).toBe("untitled.md");
    expect(untitledMarkdownName(2)).toBe("untitled-2.md");
    expect(untitledMarkdownName(10)).toBe("untitled-10.md");
  });
});

describe("createUntitledMarkdown", () => {
  test("returns the first free name", async () => {
    const seen: string[] = [];
    const name = await createUntitledMarkdown(async (candidate) => {
      seen.push(candidate);
      return { ok: true };
    });
    expect(name).toBe("untitled.md");
    expect(seen).toEqual(["untitled.md"]);
  });

  test("advances past collisions instead of failing", async () => {
    const name = await createUntitledMarkdown(async (candidate) =>
      candidate === "untitled.md" || candidate === "untitled-2.md"
        ? { ok: false, message: "workspace path already exists" }
        : { ok: true },
    );
    expect(name).toBe("untitled-3.md");
  });

  test("a real failure throws instead of opening a phantom tab", async () => {
    await expect(
      createUntitledMarkdown(async () => ({
        ok: false,
        message: "files.v1 capability is not advertised by the service",
      })),
    ).rejects.toThrow("files.v1 capability is not advertised");
  });

  test("exhaustion throws instead of looping forever", async () => {
    await expect(
      createUntitledMarkdown(
        async () => ({ ok: false, message: "workspace path already exists" }),
        3,
      ),
    ).rejects.toThrow(/after 3 attempts/);
  });
});
