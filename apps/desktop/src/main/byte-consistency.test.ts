import { describe, expect, test } from "vitest";
import {
  readCursorMismatches,
  writeByteCountMismatches,
} from "./byte-consistency";

describe("write byte-count consistency", () => {
  test("matches for plain ASCII", () => {
    expect(writeByteCountMismatches("hello", 5)).toBe(false);
  });
  test("uses UTF-8 byte length, not JS string length, for multi-byte text", () => {
    // "é" is 1 UTF-16 code unit but 2 UTF-8 bytes.
    expect(writeByteCountMismatches("é", 2)).toBe(false);
    expect(writeByteCountMismatches("é", 1)).toBe(true);
  });
  test("flags a service that silently accepted fewer bytes than sent", () => {
    expect(writeByteCountMismatches("hello world", 5)).toBe(true);
  });
});

describe("read cursor consistency", () => {
  test("matches when the cursor advance equals the decoded byte length", () => {
    const dataBase64 = Buffer.from("hello", "utf8").toString("base64");
    expect(readCursorMismatches(dataBase64, 0, 5)).toBe(false);
    expect(readCursorMismatches(dataBase64, 100, 105)).toBe(false);
  });
  test("flags a cursor advance inconsistent with the decoded bytes", () => {
    const dataBase64 = Buffer.from("hello", "utf8").toString("base64");
    expect(readCursorMismatches(dataBase64, 0, 4)).toBe(true);
    expect(readCursorMismatches(dataBase64, 0, 6)).toBe(true);
  });
  test("an empty read is consistent only with a zero advance", () => {
    expect(readCursorMismatches("", 10, 10)).toBe(false);
    expect(readCursorMismatches("", 10, 11)).toBe(true);
  });
});
