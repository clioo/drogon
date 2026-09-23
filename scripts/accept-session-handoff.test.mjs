// MIT Copyright (c) 2026 Lovecast Inc.
// The pure half of the packaged handoff acceptance: the terminal marker a
// shell prints and the pid read back from it are what prove the SAME shell
// answered before and after the install, so both must round-trip exactly.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { markedShellPid, markerCommand, parseArgs } from "./accept-session-handoff.mjs";

test("the marker command prints label, nonce and the shell's own pid", () => {
  const command = markerCommand("HANDOFF_BEFORE", "abc123");
  assert.equal(command, "printf 'HANDOFF_BEFORE_%s_%s\\n' abc123 $$");
  const printed = execFileSync("/bin/sh", ["-c", `${command}; echo "pid=$$"`], { encoding: "utf8" });
  const pid = Number(/pid=(\d+)/.exec(printed)[1]);
  assert.equal(markedShellPid(printed, "HANDOFF_BEFORE", "abc123"), pid);
});

test("a marker from another label or nonce is never read as this shell", () => {
  const text = "HANDOFF_BEFORE_abc123_41\nHANDOFF_AFTER_zzz_42\n";
  assert.equal(markedShellPid(text, "HANDOFF_AFTER", "abc123"), null);
  assert.equal(markedShellPid(text, "HANDOFF_BEFORE", "abc123"), 41);
});

test("--bundle is required and resolved", () => {
  assert.throws(() => parseArgs([]), /usage/);
  assert.equal(parseArgs(["--bundle", "/x/Drogon.app"]).bundle, "/x/Drogon.app");
});
