import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreThemeAndViewport, selectSettingsTheme, verifyThemeCaptures, verifyThemeSurface } from "./acceptance-theme.mjs";

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

test("a surface capture must match the real selection and painted body", () => {
  const selection = { ...captures()[0], foreground: "rgb(10, 10, 10)" };
  verifyThemeSurface({ ...selection }, selection);
  for (const [field, value] of [["choice", "dark"], ["dark", true], ["background", "transparent"], ["foreground", "transparent"]]) {
    assert.throws(() => verifyThemeSurface({ ...selection, [field]: value }, selection));
  }
});

test("surface evidence rejects missing hashes and inconsistent selection evidence", () => {
  const selection = { ...captures()[1], foreground: "rgb(250, 250, 250)" };
  assert.throws(() => verifyThemeSurface({ ...selection, sha256: "" }, selection), /hash missing/);
  assert.throws(() => verifyThemeSurface(selection, { ...selection, radioChecked: "false" }), /radio/);
  assert.throws(() => verifyThemeSurface(selection, { ...selection, dark: false }), /root class/);
  assert.throws(() => verifyThemeSurface(selection, { ...selection, theme: "system" }), /explicit theme/);
});

test("invalid theme choices fail before touching a page", async () => {
  await assert.rejects(selectSettingsTheme(null, "sepia"), /invalid theme choice/);
});

// Failure bookkeeping only, not simulated evidence of rendered product behavior.
test("restoration preserves the original error and attempts every restoration", async () => {
  const primary = new Error("geometry failure");
  const viewport = new Error("viewport failure");
  const theme = new Error("theme failure");
  const target = new Error("target failure");
  const calls = [];
  await assert.rejects(restoreThemeAndViewport({
    setViewportSize: async () => { calls.push("viewport"); throw viewport; },
    locator: () => { calls.push("theme"); throw theme; },
  }, {
    theme: "dark", viewport: { width: 760, height: 600 }, primaryError: primary,
    restoreTarget: async () => { calls.push("target"); throw target; },
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, viewport, theme, target]);
    return true;
  });
  assert.deepEqual(calls, ["viewport", "theme", "target"]);
});

test("restoration failure cannot turn a successful probe into PASS", async () => {
  const failure = new Error("disconnected renderer");
  await assert.rejects(restoreThemeAndViewport({ locator: () => { throw failure; } }, {
    theme: "light", viewport: null,
  }), (error) => {
    assert.deepEqual(error.errors, [failure]);
    return true;
  });
});
