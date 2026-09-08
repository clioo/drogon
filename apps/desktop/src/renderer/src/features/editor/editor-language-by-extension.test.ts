import { describe, expect, it } from "vitest";
import { isCsvPath, monacoLanguageForPath } from "./editor-language-by-extension";

describe("monacoLanguageForPath", () => {
  it("maps common extensions to their Monaco language id", () => {
    expect(monacoLanguageForPath("src/index.ts")).toBe("typescript");
    expect(monacoLanguageForPath("src/App.tsx")).toBe("typescript");
    expect(monacoLanguageForPath("src/main.rs")).toBe("rust");
    expect(monacoLanguageForPath("docs/README.md")).toBe("markdown");
    expect(monacoLanguageForPath("package.json")).toBe("json");
    expect(monacoLanguageForPath("Cargo.toml")).toBe("toml");
  });

  it("is case-insensitive on the extension", () => {
    expect(monacoLanguageForPath("Notes.MD")).toBe("markdown");
  });

  it("recognizes an extension-less Dockerfile", () => {
    expect(monacoLanguageForPath("Dockerfile")).toBe("dockerfile");
    expect(monacoLanguageForPath("docker/Dockerfile")).toBe("dockerfile");
  });

  it("falls back to plaintext for unknown or missing extensions", () => {
    expect(monacoLanguageForPath("LICENSE")).toBe("plaintext");
    expect(monacoLanguageForPath("data.unknownext")).toBe("plaintext");
  });
});

describe("isCsvPath", () => {
  it("recognizes .csv and .tsv, case-insensitively", () => {
    expect(isCsvPath("data/report.csv")).toBe(true);
    expect(isCsvPath("data/report.CSV")).toBe(true);
    expect(isCsvPath("data/report.tsv")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isCsvPath("data/report.json")).toBe(false);
    expect(isCsvPath("csv")).toBe(false);
  });
});
