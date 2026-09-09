import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyThemeCaptures } from "./acceptance-theme.mjs";

// Validator inputs only; rendered proof comes from the real CDP acceptance run.
function captures() {
  return [
    { theme: "light", choice: "light", radioChecked: "true", dark: false, background: "rgb(250, 250, 250)", sha256: "a".repeat(64) },
    { theme: "dark", choice: "dark", radioChecked: "true", dark: true, background: "rgb(20, 20, 20)", sha256: "b".repeat(64) },
  ];
}

test("accepts two selected, persisted, effectively different theme captures", () => {
  verifyThemeCaptures(captures());
});

test("media labels alone cannot certify the effective theme", () => {
  const evidence = captures();
  evidence[0].dark = true;
  assert.throws(() => verifyThemeCaptures(evidence), /light root class is wrong/);
});

test("a root class change cannot conceal identical rendered screenshots", () => {
  const evidence = captures();
  evidence[1].sha256 = evidence[0].sha256;
  assert.throws(() => verifyThemeCaptures(evidence), /screenshots are identical/);
});

test("different screenshot pixels alone cannot conceal an unchanged theme background", () => {
  const evidence = captures();
  evidence[1].background = evidence[0].background;
  assert.throws(() => verifyThemeCaptures(evidence), /backgrounds are identical/);
});

test("requires the actual selected and persisted preference", () => {
  const evidence = captures();
  evidence[0].choice = "system";
  assert.throws(() => verifyThemeCaptures(evidence), /choice did not persist/);
  evidence[0].choice = "light";
  evidence[0].radioChecked = "false";
  assert.throws(() => verifyThemeCaptures(evidence), /radio was not selected/);
});

test("rejects missing, duplicate, or incomplete capture evidence", () => {
  assert.throws(() => verifyThemeCaptures(captures().slice(0, 1)), /both explicit themes/);
  const evidence = captures();
  evidence[1].theme = "light";
  assert.throws(() => verifyThemeCaptures(evidence), /dark capture missing/);
  const incomplete = captures();
  incomplete[0].sha256 = "";
  assert.throws(() => verifyThemeCaptures(incomplete), /screenshot hash missing/);
  incomplete[0].sha256 = "a".repeat(64);
  incomplete[0].background = "";
  assert.throws(() => verifyThemeCaptures(incomplete), /computed background missing/);
});
