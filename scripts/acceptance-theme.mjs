import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export function verifyThemeCaptures(captures) {
  assert.equal(captures.length, 2, "both explicit themes must be captured");
  for (const theme of ["light", "dark"]) {
    const capture = captures.find((item) => item.theme === theme);
    assert.ok(capture, `${theme} capture missing`);
    assert.equal(capture.choice, theme, `${theme} choice did not persist`);
    assert.equal(capture.radioChecked, "true", `${theme} radio was not selected`);
    assert.equal(capture.dark, theme === "dark", `${theme} root class is wrong`);
    assert.ok(capture.background, `${theme} computed background missing`);
    assert.match(capture.sha256, /^[a-f0-9]{64}$/, `${theme} screenshot hash missing`);
  }
  const [first, second] = captures;
  assert.notEqual(first.background, second.background, "theme backgrounds are identical");
  assert.notEqual(first.sha256, second.sha256, "light/dark screenshots are identical");
}

export async function readRenderedTheme(page) {
  return page.evaluate(() => {
    if (!document.querySelector(".app-shell")) throw new Error("app shell missing");
    const raw = window.localStorage.getItem("drogon:settings:ui");
    return {
      choice: raw ? JSON.parse(raw).settings?.theme ?? "system" : "system",
      dark: document.documentElement.classList.contains("dark"),
      // The shell is transparent; main.css paints the theme on body.
      background: getComputedStyle(document.body).backgroundColor,
      foreground: getComputedStyle(document.body).color,
    };
  });
}

// Callers restore their target surface explicitly after this Settings detour.
export async function selectSettingsTheme(page, theme, { leaveSettingsOpen = false } = {}) {
  assert.ok(["light", "dark", "system"].includes(theme), "invalid theme choice");
  const settings = page.locator('section[aria-label="Settings"]');
  if (!(await settings.isVisible())) {
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+,`);
    await settings.waitFor({ timeout: 10000 });
  }
  await page.getByRole("button", { name: "Appearance", exact: true }).click({ timeout: 10000 });
  const radio = page.getByRole("radiogroup", { name: "Theme", exact: true })
    .getByRole("radio", { name: theme[0].toUpperCase() + theme.slice(1), exact: true });
  await radio.click({ timeout: 10000 });
  await radio.and(page.locator('[aria-checked="true"]')).waitFor({ timeout: 10000 });
  const radioChecked = await radio.getAttribute("aria-checked", { timeout: 10000 });
  await page.waitForFunction((wanted) => {
    const raw = window.localStorage.getItem("drogon:settings:ui");
    const dark = wanted === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : wanted === "dark";
    return raw && JSON.parse(raw).settings?.theme === wanted &&
      document.documentElement.classList.contains("dark") === dark;
  }, theme, { timeout: 10000, polling: 100 });
  if (!leaveSettingsOpen) {
    await page.getByRole("button", { name: "Back to app", exact: true }).click({ timeout: 10000 });
    await settings.waitFor({ state: "hidden", timeout: 10000 });
  }
  return { theme, radioChecked, ...await readRenderedTheme(page) };
}

export function verifyThemeSurface(capture, selection) {
  assert.ok(["light", "dark"].includes(selection.theme), "capture requires an explicit theme");
  assert.equal(selection.radioChecked, "true", "theme radio was not selected");
  assert.equal(selection.choice, selection.theme, "selected theme choice did not persist");
  assert.equal(selection.dark, selection.theme === "dark", "selected theme root class is wrong");
  assert.equal(capture.theme, selection.theme, "capture theme label changed");
  assert.equal(capture.choice, selection.theme, "capture theme choice did not persist");
  assert.equal(capture.dark, selection.dark, "capture root class changed");
  for (const field of ["background", "foreground"]) {
    assert.ok(selection[field], `selected computed ${field} missing`);
    assert.equal(capture[field], selection[field], `capture computed ${field} changed`);
  }
  assert.match(capture.sha256, /^[a-f0-9]{64}$/, "capture screenshot hash missing");
}

export async function captureThemeSurface(page, filename, selection) {
  const before = await readRenderedTheme(page);
  const png = await page.screenshot({ path: filename, animations: "disabled", timeout: 10000 });
  const capture = {
    theme: selection.theme,
    radioChecked: selection.radioChecked,
    ...await readRenderedTheme(page),
    sha256: createHash("sha256").update(png).digest("hex"),
  };
  // Keep failed capture evidence even when the caller cannot return its report.
  await writeFile(`${filename}.theme.json`, `${JSON.stringify({ selection, before, capture }, null, 2)}\n`, { mode: 0o600 });
  verifyThemeSurface({ ...capture, ...before }, selection);
  verifyThemeSurface(capture, selection);
  return capture;
}

export async function restoreThemeAndViewport(page, { theme, viewport, primaryError, restoreTarget }) {
  const failures = [];
  if (viewport) {
    try { await page.setViewportSize(viewport); } catch (error) { failures.push(error); }
  }
  try { await selectSettingsTheme(page, theme); } catch (error) { failures.push(error); }
  if (restoreTarget) {
    try { await restoreTarget(); } catch (error) { failures.push(error); }
  }
  if (failures.length) {
    throw new AggregateError(
      [...(primaryError ? [primaryError] : []), ...failures],
      "theme probe restoration failed",
    );
  }
}

export async function captureSettingsThemes(page, output) {
  const captures = [];
  for (const theme of ["light", "dark"]) {
    await page.getByRole("button", { name: "Reveal active workspace", exact: true }).click({ timeout: 10000 });
    const selection = await selectSettingsTheme(page, theme);
    await page.getByRole("button", { name: "New tab", exact: true }).waitFor({ timeout: 10000 });
    captures.push(await captureThemeSurface(page, path.join(output, `${theme}.png`), selection));
  }
  return captures;
}
